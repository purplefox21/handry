// Handry · © 2026 Berat Olekli (purplefox) · github.com/purplefox21/handry
// Eye tracking. This page covers one screen in a see-through panel of Handry.app (app/macos/Gaze.swift). It
// opens the camera and, with MediaPipe's face model (on this Mac; no picture leaves it), finds the head's place
// and turn (its transformation matrix, in cm), where each iris sits in its eye, and the eye blendshapes (blink,
// look in/out/up/down). Where the user looks follows the geometry: the gaze leaves the head at its place and
// goes in the head's direction plus the eye's own turn; how far it lands sideways grows with the distance to the
// screen. So the model's features are the head's place, and the head and eye angles times the distance, which
// keeps working when the head moves, turns, comes closer or goes back.
//   calibrate: nine points looked at with the head still, then three looked at while the head moves slowly
//              (so moving and turning the head are learned too); a ridge regression; four points measure how
//              far off it is. Saved in ~/.jevis/gaze/calibration.json.
//   track:     a soft dot with a short trail where the user looks (One Euro filter); "eyes closed" and "not
//              looking at the screen" (no face, a turned-away head, or a gaze off the screen) hide it.
// Webcam gaze is good to about a button's size (1-1.5°), worse near the edges.
import { FaceLandmarker, FilesetResolver } from '/vendor/mediapipe/vision_bundle.mjs';

const mode = new URLSearchParams(location.search).get('mode') || 'track';
const native = msg => { try { window.webkit?.messageHandlers?.gaze?.postMessage(msg); } catch {} };
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const say = document.getElementById('say');
const W = () => window.innerWidth, H = () => window.innerHeight;
function fit() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = W() * dpr;
  canvas.height = H() * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
fit();
window.addEventListener('resize', fit);
const tell = (main, small = '') => { say.innerHTML = main ? `${main}${small ? `<small>${small}</small>` : ''}` : ''; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
window.addEventListener('keydown', e => { if (e.key === 'Escape') native({ type: 'cancel' }); });

// ---------------------------------------------------------------------------
// Camera and face
// ---------------------------------------------------------------------------

let landmarker = null;
let stream = null;
let latest = null; // { features, at }
window.stopGaze = () => { stream?.getTracks().forEach(t => t.stop()); stream = null; };

async function open() {
  tell(T('Kamera açılıyor…', 'Opening the camera…'), T('macOS izin sorarsa İzin Ver.', 'If macOS asks, allow it.'));
  stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, frameRate: 30, facingMode: 'user' }, audio: false });
  video.srcObject = stream;
  await video.play();
  tell(T('Yüz modeli yükleniyor…', 'Loading the face model…'), T('İlk seferde bir kez indirilir (3,7 MB).', 'It is downloaded once, the first time (3.7 MB).'));
  const files = await FilesetResolver.forVisionTasks('/vendor/mediapipe/wasm');
  const options = gpu => ({
    baseOptions: { modelAssetPath: '/vendor/models/face_landmarker.task', delegate: gpu ? 'GPU' : 'CPU' },
    runningMode: 'VIDEO', numFaces: 1, outputFacialTransformationMatrixes: true, outputFaceBlendshapes: true
  });
  try { landmarker = await FaceLandmarker.createFromOptions(files, options(true)); } catch { landmarker = await FaceLandmarker.createFromOptions(files, options(false)); }
  tell('');
  loop();
}

const P = (lm, i) => lm[i];
/** One eye: where the iris sits between the corners (along the eye) and above or below its middle, and how open it is. */
function eye(lm, iris, a, b, top, bottom) {
  const A = P(lm, a), B = P(lm, b), I = P(lm, iris), Tp = P(lm, top), Bt = P(lm, bottom);
  const w = Math.hypot(B.x - A.x, B.y - A.y) || 1e-6;
  const ux = (B.x - A.x) / w, uy = (B.y - A.y) / w;
  const along = ((I.x - A.x) * ux + (I.y - A.y) * uy) / w;
  const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
  const across = ((I.x - mx) * -uy + (I.y - my) * ux) / w;
  const open = Math.hypot(Tp.x - Bt.x, Tp.y - Bt.y) / w;
  return [along, across, open];
}

/**
 * What the gaze is told from, for one camera frame: the head's place (cm) and turn (radians), each iris in its
 * eye, and the eye blendshapes. null without a face.
 */
function features(result) {
  const lm = result.faceLandmarks?.[0];
  if (!lm) return null;
  const L = eye(lm, 468, 33, 133, 159, 145);
  const R = eye(lm, 473, 362, 263, 386, 374);
  const m = result.facialTransformationMatrixes?.[0]?.data;
  const shapes = Object.fromEntries((result.faceBlendshapes?.[0]?.categories || []).map(c => [c.categoryName, c.score]));
  const b = name => shapes[name] || 0;
  let yaw = 0, pitch = 0, roll = 0, tx = 0, ty = 0, tz = -50;
  if (m) {
    // column-major 4×4: the rotation in m[0..10], the place in m[12..14]
    yaw = Math.atan2(m[8], m[10]);
    pitch = Math.asin(Math.max(-1, Math.min(1, -m[9])));
    roll = Math.atan2(m[1], m[5]);
    tx = m[12]; ty = m[13]; tz = m[14];
  }
  return {
    tx, ty, d: Math.max(15, Math.abs(tz)), yaw, pitch, roll,
    // the irises: along the eye (centred on 0) and across it
    ex: (L[0] + R[0]) / 2 - 0.5, ey: (L[1] + R[1]) / 2, open: (L[2] + R[2]) / 2,
    // the model's own reading of the eyes' turn
    lookH: (b('eyeLookOutLeft') - b('eyeLookInLeft') + b('eyeLookInRight') - b('eyeLookOutRight')) / 2,
    lookV: (b('eyeLookUpLeft') + b('eyeLookUpRight') - b('eyeLookDownLeft') - b('eyeLookDownRight')) / 2,
    blink: (b('eyeBlinkLeft') + b('eyeBlinkRight')) / 2
  };
}

let lastVideoTime = -1;
function loop() {
  if (!stream) return;
  if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const result = landmarker.detectForVideo(video, performance.now());
    const f = features(result);
    const now = performance.now();
    if (f) latest = { features: f, at: now };
    else if (latest && now - latest.at > 400) latest = { features: null, at: now }; // the face is gone
  }
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------------
// The model: ridge regression from the features (and a few squares) to x and y on this screen
// ---------------------------------------------------------------------------

const VERSION = 2;
/**
 * The features, as the geometry has them: the head's place, and every angle (the head's, the eye's) times the
 * distance to the screen (an angle moves the point on the screen the more, the farther the head is).
 */
function expand(f) {
  const { tx, ty, d, yaw, pitch, roll, ex, ey, open, lookH, lookV } = f;
  return [tx, ty, d, d * Math.tan(yaw), d * Math.tan(pitch), d * ex, d * ey, d * lookH, d * lookV, d * (open - 0.3), d * roll,
    d * ex * Math.abs(ex), d * lookV * Math.abs(lookV)];
}

function solve(A, b) {
  // Gaussian elimination with partial pivoting
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const k = M[r][c] / d;
      for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j];
    }
  }
  return M.map((row, i) => row[n] / (row[i] || 1e-12));
}

function fitModel(samples, lambda = 0.01) {
  const X = samples.map(s => expand(s.features));
  const d = X[0].length;
  const mean = Array.from({ length: d }, (_, j) => X.reduce((a, x) => a + x[j], 0) / X.length);
  const std = Array.from({ length: d }, (_, j) => Math.sqrt(X.reduce((a, x) => a + (x[j] - mean[j]) ** 2, 0) / X.length) || 1);
  const Z = X.map(x => [1, ...x.map((v, j) => (v - mean[j]) / std[j])]);
  const k = d + 1;
  const XtX = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => Z.reduce((a, z) => a + z[i] * z[j], 0) + (i === j && i > 0 ? lambda * Z.length : 0)));
  const weights = ['x', 'y'].map(axis => solve(XtX, Array.from({ length: k }, (_, i) => Z.reduce((a, z, n) => a + z[i] * samples[n][axis], 0))));
  return { version: VERSION, mean, std, weights, width: W(), height: H() };
}

function predict(model, f) {
  const x = expand(f);
  const z = [1, ...x.map((v, j) => (v - model.mean[j]) / model.std[j])];
  const [wx, wy] = model.weights;
  // the calibration was made at one size of the screen; scale to the page now (the same screen, so ~1)
  return { x: (z.reduce((a, v, i) => a + v * wx[i], 0) * W()) / model.width, y: (z.reduce((a, v, i) => a + v * wy[i], 0) * H()) / model.height };
}

// ---------------------------------------------------------------------------
// Calibration
// ---------------------------------------------------------------------------

function target(x, y, t) {
  ctx.clearRect(0, 0, W(), H());
  const r = 26 - 18 * Math.min(1, t);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 2 * Math.PI);
  ctx.fillStyle = 'rgba(198, 255, 0, 0.9)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, 3, 0, 2 * Math.PI);
  ctx.fillStyle = '#0b0b10';
  ctx.fill();
}

/** Shows a point, waits until the eyes are on it, then collects what the camera sees (open eyes only). */
async function collect(x, y, { settle = 650, hold = 900, shrink = true } = {}) {
  const got = [];
  const started = performance.now();
  let lastAt = 0;
  while (performance.now() - started < settle + hold) {
    const t = (performance.now() - started) / (settle + hold);
    target(x, y, shrink ? t : 0.55 + 0.1 * Math.sin(t * 20));
    const f = latest?.features;
    if (performance.now() - started > settle && f && latest.at !== lastAt && f.blink < 0.45) { lastAt = latest.at; got.push({ features: f, x, y }); }
    await new Promise(r => requestAnimationFrame(r));
  }
  return got;
}

async function countdown(main, seconds = 3) {
  for (let i = seconds; i > 0; i--) { tell(main, T(`${i}…  (Esc: vazgeç)`, `${i}…  (Esc: cancel)`)); await sleep(900); }
  tell('');
}

async function calibrate() {
  document.body.classList.add('calibrating');
  await countdown(T('Başını rahat tut, sadece gözlerinle yeşil noktaya bak.', 'Keep your head still and follow the green dot with your eyes only.'));
  const m = 0.08;
  const xs = [m, 0.5, 1 - m], ys = [m, 0.5, 1 - m];
  const points = ys.flatMap(y => xs.map(x => [x * W(), y * H()]));
  points.sort(() => Math.random() - 0.5);
  let samples = [];
  for (const [x, y] of points) samples = samples.concat(await collect(x, y));
  // the same points from other places of the head: this is what makes moving the head work
  await countdown(T('Şimdi gözünü noktadan ayırma ve başını yavaşça oynat: sağa sola, aşağı yukarı, biraz öne ve geriye.', 'Now keep your eyes on the dot and move your head slowly: left and right, up and down, a little closer and back.'), 3);
  for (const [x, y] of [[0.5, 0.5], [0.2, 0.3], [0.8, 0.7]]) {
    tell(T('Gözün noktada, başın yavaşça hareket ediyor…', 'Eyes on the dot, head moving slowly…'));
    samples = samples.concat(await collect(x * W(), y * H(), { settle: 500, hold: 4200, shrink: false }));
  }
  tell('');
  if (samples.length < 120) throw new Error(T('Yüzün yeterince görülemedi. Işığı ve kameranın açısını kontrol et.', "Your face wasn't seen well enough. Check the light and the camera's angle."));
  const model = fitModel(samples);
  // four points it wasn't fitted on: how far off is it?
  await countdown(T('Son dört nokta: başını rahat bırak, noktalara bak.', 'Four last points: relax your head and look at the dots.'), 2);
  const checks = [[0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]].map(([x, y]) => [x * W(), y * H()]);
  const errors = [];
  for (const [x, y] of checks) {
    const got = await collect(x, y, { settle: 600, hold: 700 });
    const ps = got.map(s => predict(model, s.features));
    if (ps.length) {
      const px = ps.reduce((a, p) => a + p.x, 0) / ps.length, py = ps.reduce((a, p) => a + p.y, 0) / ps.length;
      errors.push(Math.hypot(px - x, py - y));
    }
  }
  model.error = Math.round(errors.reduce((a, e) => a + e, 0) / (errors.length || 1));
  await api('/api/gaze/calibration', { method: 'POST', body: JSON.stringify(model) });
  ctx.clearRect(0, 0, W(), H());
  document.body.classList.remove('calibrating');
  native({ type: 'calibrated', error: model.error });
  return model;
}

// ---------------------------------------------------------------------------
// Following the gaze
// ---------------------------------------------------------------------------

// One Euro filter: steady when the eyes rest, quick when they jump.
function oneEuro({ minCutoff = 1.2, beta = 0.004, dCutoff = 1 } = {}) {
  let x = null, dx = 0, t = null;
  const alpha = (cutoff, dt) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
  return (value, now) => {
    if (x === null) { x = value; t = now; return value; }
    const dt = Math.max(1e-3, (now - t) / 1000);
    t = now;
    const d = (value - x) / dt;
    dx += alpha(dCutoff, dt) * (d - dx);
    x += alpha(minCutoff + beta * Math.abs(dx), dt) * (value - x);
    return x;
  };
}

/** Where the user is: looking at a point, eyes closed, or not looking at the screen. */
function stateOf(f, p) {
  if (!f) return 'away';
  if (f.blink > 0.5) return 'closed';
  const margin = 0.15;
  if (Math.abs(f.yaw) > 0.75 || Math.abs(f.pitch) > 0.6) return 'away';
  if (p.x < -margin * W() || p.x > (1 + margin) * W() || p.y < -margin * H() || p.y > (1 + margin) * H()) return 'away';
  return 'looking';
}

function follow(model) {
  const fx = oneEuro(), fy = oneEuro();
  const trail = [];
  let lastAt = 0, state = 'looking', stateSince = performance.now(), told = '';
  const shown = performance.now();
  const draw = () => {
    if (!stream) return;
    const now = performance.now();
    if (latest && latest.at !== lastAt) {
      lastAt = latest.at;
      const f = latest.features;
      const p = f ? predict(model, f) : null;
      const next = stateOf(f, p);
      if (next !== state) { state = next; stateSince = now; native({ type: 'state', state }); }
      if (state === 'looking') {
        const x = Math.max(0, Math.min(W(), fx(p.x, now))), y = Math.max(0, Math.min(H(), fy(p.y, now)));
        trail.push({ x, y, at: now });
      }
    }
    while (trail.length && now - trail[0].at > 700) trail.shift();
    ctx.clearRect(0, 0, W(), H());
    // a short gap (a blink) keeps the last place; a longer one hides the dot
    const hidden = state !== 'looking' && now - stateSince > 250;
    if (!hidden) {
      trail.forEach((p, i) => {
        const k = (i + 1) / trail.length;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6 + 10 * k, 0, 2 * Math.PI);
        ctx.fillStyle = `rgba(90, 200, 255, ${0.1 * k})`;
        ctx.fill();
      });
      const head = trail[trail.length - 1];
      if (head) {
        ctx.beginPath();
        ctx.arc(head.x, head.y, 30, 0, 2 * Math.PI);
        ctx.fillStyle = 'rgba(90, 200, 255, 0.18)';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(160, 225, 255, 0.55)';
        ctx.stroke();
      }
    } else {
      trail.length = 0;
    }
    const message = hidden && now - stateSince > 400
      ? (state === 'closed' ? T('👁 Gözler kapalı', '👁 Eyes closed') : T('👁 Ekrana bakmıyorsun', "👁 You aren't looking at the screen"))
      : now - shown < 5000 ? `${T('Göz takibi açık', 'Eye tracking is on')}|${T(`Ortalama sapma ~${model.error} nokta · kapatmak için menü › Göz Takibi`, `Off by ~${model.error} points on average · menu › Eye Tracking to turn it off`)}` : '';
    if (message !== told) { told = message; const [a, b2 = ''] = message.split('|'); tell(a, b2); }
    requestAnimationFrame(draw);
  };
  draw();
}

(async () => {
  try {
    await open();
    let model = null;
    if (mode !== 'calibrate') {
      model = (await (await api('/api/gaze/calibration')).json()).calibration;
      // made on another screen, or by the earlier model that didn't follow the head
      if (model && (model.version !== VERSION || Math.abs(model.width - W()) > 4 || Math.abs(model.height - H()) > 4)) model = null;
    }
    if (!model) {
      native({ type: 'calibrating' });
      model = await calibrate();
    }
    native({ type: 'tracking', error: model.error });
    follow(model);
  } catch (err) {
    ctx.clearRect(0, 0, W(), H());
    tell(T('Göz takibi başlamadı.', "Eye tracking didn't start."), err.message || String(err));
    native({ type: 'error', message: err.message || String(err) });
  }
})();
