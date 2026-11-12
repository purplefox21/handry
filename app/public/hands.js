// Handry · © 2026 Berat Olekli (purplefox) · github.com/purplefox21/handry
// Hand gestures. This page is the small window in the screen's corner (app/macos/Hands.swift). It opens the
// Mac's camera, finds the hand with MediaPipe's gesture model (on this Mac; no picture leaves it), shows the
// hand's skeleton over the camera picture, and sends what the hand does (hands-gestures.js) to Handry.app,
// which moves the mouse. The camera is on only while this window is.
import { GestureRecognizer, FilesetResolver } from '/vendor/mediapipe/vision_bundle.mjs';
import { createHands, CONNECTIONS, ANCHOR } from './hands-gestures.js?v=1';

const q = new URLSearchParams(location.search);
const screenSize = { w: Number(q.get('w')) || 1512, h: Number(q.get('h')) || 982 };
const native = msg => { try { window.webkit?.messageHandlers?.hands?.postMessage(msg); } catch {} };
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');
const LIME = '#C6FF00';

function fit() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
fit();
window.addEventListener('resize', fit);

let note = '';
let shown = '';
function show(icon, text, small = '', warn = false) {
  const key = `${icon}|${text}|${small}|${warn}`;
  if (key === shown) return;
  shown = key;
  statusEl.className = warn ? 'status warn' : 'status';
  statusEl.innerHTML = `<span>${icon}</span><span>${text}</span>${small ? `<small>${small}</small>` : ''}`;
}
/** Handry.app says something the user must know (e.g. the Accessibility permission is missing). */
window.handsNote = text => { note = text || ''; shown = ''; };

function showPose(pose, dragging, inside) {
  if (note) return show('⚠️', note, '', true);
  if (pose === 'none') return show('✋', T('Elini kaldır', 'Raise your hand'), T('işaret parmağını uzat', 'point your index finger'));
  if (!inside && pose !== 'pinch') return show('↔️', T('Elini çerçeveye getir', 'Bring your hand into the frame'));
  const labels = {
    point: ['☝️', T('İmleç', 'Pointer'), T('🤏 tıkla · ✌️ kaydır', '🤏 click · ✌️ scroll')],
    pinch: dragging ? ['🤏', T('Sürükleme', 'Dragging')] : ['🤏', T('Tıklama', 'Click')],
    scroll: ['✌️', T('Kaydırma', 'Scrolling'), T('yukarı · aşağı', 'up · down')],
    palm: ['✋', T('Dur', 'Stopped')],
    fist: ['✊', T('Bekliyor', 'Waiting')],
    idle: ['·', T('Bekliyor', 'Waiting'), T('☝️ ile başla', 'start with ☝️')]
  };
  show(...(labels[pose] || labels.idle));
}

// ---------------------------------------------------------------------------
// Camera and hand
// ---------------------------------------------------------------------------

let recognizer = null;
let stream = null;
let hands = null;
window.stopHands = () => {
  // let go of the mouse button before the camera goes
  if (hands) for (const e of hands.reset()) native(e);
  stream?.getTracks().forEach(t => t.stop());
  stream = null;
};

async function open() {
  show('📷', T('Kamera açılıyor…', 'Opening the camera…'));
  const size = { width: 1280, height: 720, frameRate: 30 };
  stream = await navigator.mediaDevices.getUserMedia({ video: { ...size, facingMode: 'user' }, audio: false });
  // The Mac's own camera, not an iPhone nearby (Continuity Camera can be the default): pick it by name.
  const cams = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
  const own = cams.find(d => /MacBook|FaceTime|Built-in|Dahili/i.test(d.label) && !/Masa|Desk/i.test(d.label));
  if (own && stream.getVideoTracks()[0]?.getSettings().deviceId !== own.deviceId) {
    stream.getTracks().forEach(t => t.stop());
    stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: own.deviceId }, ...size }, audio: false });
  }
  video.srcObject = stream;
  await video.play();
  show('⏳', T('El modeli yükleniyor…', 'Loading the hand model…'), T('ilk seferde bir kez iner (8 MB)', 'downloaded once (8 MB)'));
  const files = await FilesetResolver.forVisionTasks('/vendor/mediapipe/wasm');
  const options = gpu => ({
    baseOptions: { modelAssetPath: '/vendor/models/gesture_recognizer.task', delegate: gpu ? 'GPU' : 'CPU' },
    runningMode: 'VIDEO', numHands: 2,
    minHandDetectionConfidence: 0.6, minHandPresenceConfidence: 0.6, minTrackingConfidence: 0.5
  });
  try { recognizer = await GestureRecognizer.createFromOptions(files, options(true)); } catch { recognizer = await GestureRecognizer.createFromOptions(files, options(false)); }
  hands = createHands({ screen: screenSize, video: (video.videoWidth / video.videoHeight) || 16 / 9 });
  native({ type: 'ready' });
  schedule();
}

/** The hand that is moving the pointer: the one nearest the last one, so a second hand doesn't take over. */
let lastAnchor = null;
function pick(r) {
  const n = r.landmarks?.length || 0;
  if (!n) { lastAnchor = null; return null; }
  let best = 0;
  if (lastAnchor && n > 1) {
    let bestDist = Infinity;
    r.landmarks.forEach((lm, i) => {
      const d = Math.hypot(lm[ANCHOR].x - lastAnchor.x, lm[ANCHOR].y - lastAnchor.y);
      if (d < bestDist) { bestDist = d; best = i; }
    });
  }
  const image = r.landmarks[best];
  lastAnchor = image[ANCHOR];
  const g = r.gestures?.[best]?.[0];
  return { image, world: r.worldLandmarks?.[best] || image, gesture: g ? { name: g.categoryName, score: g.score } : null };
}

function schedule() {
  if (!stream) return;
  if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(tick); else requestAnimationFrame(tick);
}

let lastVideoTime = -1;
let lastHold = 0;
function tick() {
  if (!stream) return;
  if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const t = performance.now();
    let hand = null;
    try { hand = pick(recognizer.recognizeForVideo(video, t)); } catch {}
    for (const e of hands.step(hand, t)) native(e);
    // holding a pinch still: Handry.app lets go of the button if it hears nothing for a while
    if (hands.pose === 'pinch' && t - lastHold > 300) { lastHold = t; native({ type: 'hold' }); }
    const R = hands.region;
    const a = hand?.image[ANCHOR];
    const inside = !a || (a.x > R.x0 - 0.1 && a.x < R.x1 + 0.1 && a.y > R.y0 - 0.1 && a.y < R.y1 + 0.1);
    showPose(hands.pose, hands.dragging, inside);
    draw(hand);
  }
  schedule();
}

// ---------------------------------------------------------------------------
// The preview: the camera picture as in a mirror, the screen's part of it, the hand's skeleton
// ---------------------------------------------------------------------------

function draw(hand) {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  ctx.translate(w, 0);
  ctx.scale(-1, 1);
  ctx.globalAlpha = 0.5;
  ctx.drawImage(video, 0, 0, w, h);
  ctx.globalAlpha = 1;
  const R = hands.region;
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(R.x0 * w, R.y0 * h, (R.x1 - R.x0) * w, (R.y1 - R.y0) * h);
  ctx.setLineDash([]);
  if (hand) {
    const pose = hands.pose;
    const color = pose === 'pinch' ? LIME : pose === 'point' ? '#ffffff' : pose === 'scroll' ? '#7dd3fc' : 'rgba(255, 255, 255, 0.55)';
    const p = hand.image.map(l => ({ x: l.x * w, y: l.y * h }));
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const [a, b] of CONNECTIONS) { ctx.moveTo(p[a].x, p[a].y); ctx.lineTo(p[b].x, p[b].y); }
    ctx.stroke();
    ctx.fillStyle = color;
    for (const q of p) { ctx.beginPath(); ctx.arc(q.x, q.y, 2.2, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = LIME;
    ctx.beginPath();
    ctx.arc(p[ANCHOR].x, p[ANCHOR].y, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

open().catch(err => {
  const message = err?.name === 'NotAllowedError'
    ? T(`Kamera izni yok: Sistem Ayarları › Gizlilik › Kamera › ${APP_NAME}`, `No camera permission: System Settings › Privacy › Camera › ${APP_NAME}`)
    : `${T('Açılamadı', 'Could not start')}: ${err?.message || err}`;
  note = message;
  shown = '';
  showPose('none', false, true);
  native({ type: 'error', message });
});
