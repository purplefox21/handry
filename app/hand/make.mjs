// Handry · © 2026 Berat Olekli (purplefox) · github.com/purplefox21/handry
// Draws Handry, the hand that walks on its fingers, as pixel art: a little 3D
// hand (rounded cones for the fingers, ellipsoids for the palm, a purple cuff)
// is posed for every frame and ray-cast straight from the side into a small
// grid (toon shading in four tones, a dark outline), then each pixel is
// doubled. The result is the same kind of sprite set as the fox's
// (app/foxie/TARIF.md: manifest.json + <anim>/0001.png, same animation names),
// so the app's pet code plays either one. Also draws the icon art and the
// menu bar glyph.
//
// Units: world units are "hand units"; ZOOM art pixels each; an art pixel is
// CHUNK×CHUNK sprite pixels. x forward (where the fingers point), y up, z
// towards the viewer. The fingertips stand on y = 0.
//
// Usage: node app/hand/make.mjs [--sheet out.png] [anim …]
//   writes app/hand/sprites/ (all animations, or the ones named) and app/hand/icon/
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const SPRITES = path.join(HERE, 'sprites');
const ICONS = path.join(HERE, 'icon');
const CHUNK = 2;          // sprite pixels per art pixel
const ZOOM = 1.6;         // art pixels per world unit
const FPS = 24;
const W = 110, H = 88;    // art frame (sprite 220 × 176)
const FOOT = 55;          // art column under the middle of the hand (sprite 110)
const GROUND = 80;        // art row just under the fingertips (sprite 160)
const LIFT = 1 / ZOOM;    // the outline under the fingertips takes one art pixel

// MARK: Vectors

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const rad = d => d * Math.PI / 180;
const deg = r => r * 180 / Math.PI;
/** Rotates a around the unit axis k by t radians. */
const rot = (a, k, t) => { const c = Math.cos(t), s = Math.sin(t); return add(add(mul(a, c), mul(cross(k, a), s)), mul(k, dot(k, a) * (1 - c))); };
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = t => Math.max(0, Math.min(1, t));
const ease = t => { t = clamp01(t); return t * t * (3 - 2 * t); };
const easeOut = t => { t = clamp01(t); return 1 - (1 - t) * (1 - t); };
const easeIn = t => { t = clamp01(t); return t * t; };
const back = t => { t = clamp01(t); const s = 1.7; return 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2; }; // ease out with a small overshoot
/** 0 → 1 → 0 bump centred at c, half width w. */
const bump = (t, c, w) => { const x = Math.abs(t - c) / w; return x >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * x); };
/** Where t is inside [a, b], 0..1. */
const span = (t, a, b) => clamp01((t - a) / (b - a));

// MARK: Colours

const hex = s => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const MAT = {
  skin:   { tones: ['#a75c49', '#d4866a', '#f0b28e', '#ffd8b9'], line: '#4f2424' },
  nail:   { tones: ['#c17f70', '#e3ada0', '#f9d8cd', '#fff4ee'], line: '#4f2424' },
  cuff:   { tones: ['#35196a', '#55308f', '#7a4bbd', '#a47ad6'], line: '#1a0b38' },
  trim:   { tones: ['#9b8bc0', '#c6b7e2', '#ebe3f7', '#ffffff'], line: '#1a0b38' },
  gold:   { tones: ['#8a641a', '#c7982d', '#f1c84c', '#fff0a2'], line: '#3a2806' },
  hole:   { tones: ['#170a2c', '#170a2c', '#23123d', '#23123d'], line: '#0e0620' },
  metal:  { tones: ['#666d7c', '#959caa', '#c6cbd5', '#eceef3'], line: '#262a34' },
  keys:   { tones: ['#2c313c', '#3a404c', '#484f5e', '#575e70'], line: '#171a20' },
  screen: { tones: ['#43a6da', '#62c5ee', '#94e2fd', '#c9f3ff'], line: '#262a34' },
  code:   { tones: ['#2a6f9e', '#2a6f9e', '#3a86b8', '#3a86b8'], line: '#262a34' },
  white:  { tones: ['#ebe3f7', '#ebe3f7', '#ebe3f7', '#ebe3f7'], line: '#55308f' },
  heart:  { tones: ['#ff5d8f', '#ff5d8f', '#ff5d8f', '#ff5d8f'], line: '#5c1030' }
};
for (const m of Object.values(MAT)) { m.tones = m.tones.map(hex); m.line = hex(m.line); }

// MARK: The model (hand units; the wrist's centre is the origin)

// Local axes: x towards the knuckles, y out of the back of the hand, z the thumb side.
const FINGERS = {
  index:  { k: [16.0, 0.3, 5.2],  len: [7.2, 4.8, 3.6], r: [2.15, 1.95, 1.75], c: 0.65 },
  middle: { k: [16.6, 0.5, 1.75], len: [7.8, 5.2, 3.8], r: [2.2, 2.0, 1.8],   c: 0.65 },
  ring:   { k: [16.2, 0.4, -1.75], len: [7.4, 5.0, 3.6], r: [2.1, 1.9, 1.7],   c: 0.65 },
  pinky:  { k: [15.0, 0.1, -5.1], len: [5.8, 3.9, 3.1], r: [1.9, 1.7, 1.55],  c: 0.65 }
};
const NAMES = Object.keys(FINGERS);
const THUMB = { base: [3.2, -1.3, 4.8], dir: norm([0.62, -0.42, 0.66]), up: [0, 0.75, 0.66], len: [5.6, 4.4, 3.6], r: [2.5, 2.25, 2.0], c: 0.8 };
const tipR = name => (name === 'thumb' ? THUMB.r[2] : FINGERS[name].r[2]) * 0.95;
const CUFF = { back: -9, front: -1, ry: 5.0, rz: 7.8 };

/** The hand's axes in the world: roll about x, then pitch about z, then yaw about y (degrees). */
function frameOf(pose) {
  const R = e => rot(rot(rot(e, [1, 0, 0], rad(pose.roll || 0)), [0, 0, 1], rad(pose.pitch || 0)), [0, 1, 0], rad(pose.yaw || 0));
  const F = { o: pose.root, X: R([1, 0, 0]), Y: R([0, 1, 0]), Z: R([0, 0, 1]) };
  F.at = l => add(add(add(F.o, mul(F.X, l[0])), mul(F.Y, l[1])), mul(F.Z, l[2]));
  F.dir = l => add(add(mul(F.X, l[0]), mul(F.Y, l[1])), mul(F.Z, l[2]));
  return F;
}

/** A finger's knuckle, its forward direction and the back of the hand, in the world. */
function fingerBase(F, name, spread) {
  if (name === 'thumb') {
    const f = THUMB.dir;
    const up = norm(sub(THUMB.up, mul(f, dot(THUMB.up, f))));
    const fs = rot(f, up, rad(spread || 0));
    return { K: F.at(THUMB.base), f: F.dir(fs), n: F.dir(up), spec: THUMB };
  }
  const s = rad(spread || 0);
  return { K: F.at(FINGERS[name].k), f: F.dir([Math.cos(s), 0, Math.sin(s)]), n: F.Y, spec: FINGERS[name] };
}

/** The joints of a finger bent by [a1, a2, a3] degrees (each relative to the last; + curls towards the palm). */
function fingerJoints(F, name, angles) {
  const { K, f, n, spec } = fingerBase(F, name, angles[3]);
  const dirAt = a => sub(mul(f, Math.cos(a)), mul(n, Math.sin(a)));
  const backAt = a => add(mul(f, Math.sin(a)), mul(n, Math.cos(a)));
  const pts = [K];
  const dirs = [];
  let a = 0;
  for (let i = 0; i < 3; i++) {
    a += rad(angles[i]);
    dirs.push([dirAt(a), backAt(a)]);
    pts.push(add(pts[i], mul(dirAt(a), spec.len[i])));
  }
  return { pts, dirs, spec };
}

/**
 * Bends a finger so its tip's centre reaches T (world; only the part in the
 * finger's own plane counts): the middle joint is found by bisection (the
 * last joint follows it, c × as much), the knuckle then aims the whole finger.
 */
function reach(F, name, T, spread = 0) {
  const { K, f, n, spec } = fingerBase(F, name, spread);
  const D = sub(T, K);
  const u = dot(D, f), w = -dot(D, n);
  const dist = Math.hypot(u, w);
  const [L1, L2, L3] = spec.len;
  const V = p => [L1 + L2 * Math.cos(p) + L3 * Math.cos(p * (1 + spec.c)), L2 * Math.sin(p) + L3 * Math.sin(p * (1 + spec.c))];
  const vlen = p => Math.hypot(...V(p));
  let lo = 0, hi = rad(100), pip;
  if (dist >= vlen(lo)) pip = lo;
  else if (dist <= vlen(hi)) pip = hi;
  else { for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (vlen(m) > dist) lo = m; else hi = m; } pip = (lo + hi) / 2; }
  const v = V(pip);
  return [deg(Math.atan2(w, u) - Math.atan2(v[1], v[0])), deg(pip), deg(pip * spec.c), spread];
}

// MARK: Primitives and ray casting

const cone = (a, b, ra, rb, mat, group) => ({ type: 'cone', a, b, ra, rb, mat, group });
const solid = (type, c, U, V, Wv, r, mat, group) => ({ type, c, U, V, W: Wv, r, mat, group });

function hitCone(ro, rd, p) {
  let { a: pa, b: pb, ra, rb } = p;
  if (rb > ra) { [pa, pb, ra, rb] = [pb, pa, rb, ra]; }
  const ba = sub(pb, pa), oa = sub(ro, pa), ob = sub(ro, pb);
  const rr = ra - rb;
  const m0 = dot(ba, ba), m1 = dot(ba, oa), m2 = dot(ba, rd), m3 = dot(rd, oa), m5 = dot(oa, oa), m6 = dot(ob, rd), m7 = dot(ob, ob);
  const d2 = m0 - rr * rr;
  const k2 = d2 - m2 * m2;
  const k1 = d2 * m3 - m1 * m2 + m2 * rr * ra;
  const k0 = d2 * m5 - m1 * m1 + m1 * rr * ra * 2 - m0 * ra * ra;
  const h = k1 * k1 - k0 * k2;
  if (h < 0) return null;
  let t = (-Math.sqrt(h) - k1) / k2;
  const y = m1 - ra * rr + t * m2;
  if (y > 0 && y < d2) return [t, norm(sub(mul(add(oa, mul(rd, t)), d2), mul(ba, y)))];
  const h1 = m3 * m3 - m5 + ra * ra, h2 = m6 * m6 - m7 + rb * rb;
  if (Math.max(h1, h2) < 0) return null;
  let best = null;
  if (h1 > 0) { t = -m3 - Math.sqrt(h1); best = [t, mul(add(oa, mul(rd, t)), 1 / ra)]; }
  if (h2 > 0) { t = -m6 - Math.sqrt(h2); if (!best || t < best[0]) best = [t, mul(add(ob, mul(rd, t)), 1 / rb)]; }
  return best;
}

/** Ellipsoids ('ell'), elliptic cylinders along W ('cyl') and boxes ('box'), through their own unit shape. */
function hitSolid(ro, rd, p) {
  const { c, U, V, W: Wv, r } = p;
  const oc = sub(ro, c);
  const o = [dot(oc, U) / r[0], dot(oc, V) / r[1], dot(oc, Wv) / r[2]];
  const d = [dot(rd, U) / r[0], dot(rd, V) / r[1], dot(rd, Wv) / r[2]];
  let t = Infinity, nl = null;
  if (p.type === 'ell') {
    const a = dot(d, d), b = dot(o, d), cc = dot(o, o) - 1, h = b * b - a * cc;
    if (h < 0) return null;
    t = (-b - Math.sqrt(h)) / a;
    nl = add(o, mul(d, t));
  } else if (p.type === 'cyl') {
    const a = d[0] * d[0] + d[1] * d[1];
    if (a > 1e-12) {
      const b = o[0] * d[0] + o[1] * d[1], cc = o[0] * o[0] + o[1] * o[1] - 1, h = b * b - a * cc;
      if (h >= 0) {
        const t1 = (-b - Math.sqrt(h)) / a, z = o[2] + t1 * d[2];
        if (Math.abs(z) <= 1) { t = t1; nl = [o[0] + t1 * d[0], o[1] + t1 * d[1], 0]; }
      }
    }
    if (Math.abs(d[2]) > 1e-12) {
      for (const s of [-1, 1]) {
        const t2 = (s - o[2]) / d[2], x = o[0] + t2 * d[0], y = o[1] + t2 * d[1];
        if (x * x + y * y <= 1 && t2 < t) { t = t2; nl = [0, 0, s]; }
      }
    }
    if (!nl) return null;
  } else {
    let tmin = -Infinity, tmax = Infinity;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-12) { if (Math.abs(o[i]) > 1) return null; continue; }
      const t1 = (-1 - o[i]) / d[i], t2 = (1 - o[i]) / d[i];
      const tn = Math.min(t1, t2), tf = Math.max(t1, t2);
      if (tn > tmin) { tmin = tn; nl = [0, 0, 0]; nl[i] = d[i] > 0 ? -1 : 1; }
      tmax = Math.min(tmax, tf);
    }
    if (tmin > tmax || !nl) return null;
    t = tmin;
  }
  return [t, norm(add(add(mul(U, nl[0] / r[0]), mul(V, nl[1] / r[1])), mul(Wv, nl[2] / r[2])))];
}

/** A rough bounding sphere, to skip most primitives for most rays. */
function bound(p) {
  if (p.type === 'cone') return { c: mul(add(p.a, p.b), 0.5), r: len(sub(p.a, p.b)) / 2 + Math.max(p.ra, p.rb) };
  return { c: p.c, r: Math.hypot(...p.r) };
}

/** Moves every primitive: points through f, directions through g. */
function transform(prims, f, g) {
  return prims.map(p => p.type === 'cone'
    ? { ...p, a: f(p.a), b: f(p.b) }
    : { ...p, c: f(p.c), U: g(p.U), V: g(p.V), W: g(p.W) });
}
/** Turns everything about the vertical axis through (x0, ·, z0). */
const yawAbout = (prims, degrees, x0 = 0, z0 = 0) => {
  const k = [0, 1, 0], t = rad(degrees), o = [x0, 0, z0];
  return transform(prims, p => add(rot(sub(p, o), k, t), o), d => rot(d, k, t));
};
/** Swings everything about the axis towards the viewer through (x0, y0). */
const swingAbout = (prims, degrees, x0 = 0, y0 = 0) => {
  const k = [0, 0, 1], t = rad(degrees), o = [x0, y0, 0];
  return transform(prims, p => add(rot(sub(p, o), k, t), o), d => rot(d, k, t));
};

// MARK: The hand's primitives

function handPrims(pose) {
  const F = frameOf(pose);
  const out = [];
  const { X, Y, Z } = F;
  // Palm: a flattened ellipsoid, the wrist, the ridges to the knuckles, the pad under the thumb.
  out.push(solid('ell', F.at([8.2, 0.2, 0]), X, Y, Z, [9.2, 3.3, 7.3], 'skin', 'palm'));
  out.push(solid('ell', F.at([0.4, 0, 0]), X, Y, Z, [3.4, 3.5, 5.6], 'skin', 'palm'));
  for (const name of NAMES) {
    const k = FINGERS[name].k;
    out.push(cone(F.at([3, 0.5, k[2] * 0.55]), F.at([k[0] - 0.4, k[1], k[2]]), 2.4, FINGERS[name].r[0] + 0.1, 'skin', 'palm'));
  }
  out.push(solid('ell', F.at([5.6, -1.4, 4.4]), X, Y, Z, [5.0, 2.4, 2.8], 'skin', 'palm'));
  // The cuff (a purple sleeve end), its white trim, a gold button, the dark opening at the back.
  const mid = (CUFF.back + CUFF.front) / 2, half = (CUFF.front - CUFF.back) / 2;
  out.push(solid('cyl', F.at([mid, 0, 0]), Y, Z, X, [CUFF.ry, CUFF.rz, half], 'cuff', 'cuff'));
  out.push(solid('cyl', F.at([CUFF.front - 0.55, 0, 0]), Y, Z, X, [CUFF.ry + 0.35, CUFF.rz + 0.35, 0.55], 'trim', 'cuff'));
  out.push(solid('cyl', F.at([CUFF.back - 0.05, 0, 0]), Y, Z, X, [CUFF.ry - 0.9, CUFF.rz - 1.1, 0.08], 'hole', 'cuff'));
  out.push(solid('ell', F.at([mid - 0.6, -0.8, CUFF.rz + 0.1]), X, Y, Z, [1.05, 1.05, 0.7], 'gold', 'cuff'));
  // Fingers and thumb: three rounded cones each, and a nail on the last one.
  for (const name of [...NAMES, 'thumb']) {
    const angles = name === 'thumb' ? pose.thumb : pose.fingers[name];
    const { pts, dirs, spec } = fingerJoints(F, name, angles);
    const r = spec.r;
    out.push(cone(pts[0], pts[1], r[0], r[1], 'skin', name));
    out.push(cone(pts[1], pts[2], r[1], r[2], 'skin', name));
    out.push(cone(pts[2], pts[3], r[2], r[2] * 0.95, 'skin', name));
    const [s3, b3] = dirs[2];
    const side = norm(cross(s3, b3));
    out.push(solid('ell', add(add(pts[2], mul(s3, spec.len[2] * 0.62)), mul(b3, r[2] * 0.62)), s3, b3, side, [1.55, 0.6, r[2] * 0.72], 'nail', name));
  }
  return out;
}

// MARK: Rendering

/**
 * The side camera: art pixel (px, py) looks along -z at world
 * ((px + 0.5 - ox) / ZOOM, (oy - py - 0.5) / ZOOM).
 */
const sideCamera = (w, h, ox, oy, zoom = ZOOM) => ({
  w, h,
  ray: (px, py) => [[(px + 0.5 - ox) / zoom, (oy - py - 0.5) / zoom, 500], [0, 0, -1]],
  light: norm([-0.45, 0.75, 0.55]),
  back: [0, 0, 1],
  center: [0, 0, 0]
});

/** A camera looking at `center` along `fwd` (orthographic), `size` world units across. */
function viewCamera(w, h, center, fwd, size) {
  fwd = norm(fwd);
  const right = norm(cross(fwd, [0, 1, 0])), up = cross(right, fwd), backDir = mul(fwd, -1);
  const k = size / w;
  return {
    w, h, right, up,
    ray: (px, py) => [add(add(add(center, mul(right, (px + 0.5 - w / 2) * k)), mul(up, (h / 2 - py - 0.5) * k)), mul(fwd, -500)), fwd],
    light: norm(add(add(mul(right, -0.45), mul(up, 0.75)), mul(backDir, 0.55))),
    back: backDir,
    center
  };
}

/** Casts every ray; returns per pixel: material, tone (0-3), depth, group. */
function cast(prims, cam) {
  const n = cam.w * cam.h;
  const out = { w: cam.w, h: cam.h, mat: new Array(n).fill(null), tone: new Uint8Array(n), depth: new Float64Array(n).fill(Infinity), group: new Array(n).fill(null) };
  const items = prims.map(p => ({ p, b: bound(p) }));
  for (let py = 0; py < cam.h; py++) {
    for (let px = 0; px < cam.w; px++) {
      const [o, d] = cam.ray(px, py);
      let best = null, bp = null;
      for (const { p, b } of items) {
        const oc = sub(b.c, o), along = dot(oc, d);
        if (dot(oc, oc) - along * along > b.r * b.r) continue;
        const hit = p.type === 'cone' ? hitCone(o, d, p) : hitSolid(o, d, p);
        if (hit && hit[0] > 0 && (!best || hit[0] < best[0])) { best = hit; bp = p; }
      }
      if (!best) continue;
      const i = py * cam.w + px;
      const lit = dot(best[1], cam.light);
      let tone = lit > 0.7 ? 3 : lit > 0.3 ? 2 : lit > -0.08 ? 1 : 0;
      // The far side of the hand (the ring finger and the pinky from the side) a shade darker.
      const point = add(o, mul(d, best[0]));
      if (dot(sub(point, cam.center), cam.back) < -4.2 && tone > 0) tone--;
      out.mat[i] = bp.mat;
      out.tone[i] = tone;
      out.depth[i] = best[0];
      out.group[i] = bp.group;
    }
  }
  return out;
}

/** Colours the cast: an outline around everything and between overlapping parts. */
function paint(c) {
  const { w, h } = c;
  const rgba = Buffer.alloc(w * h * 4);
  const set = (i, col) => { rgba[i * 4] = col[0]; rgba[i * 4 + 1] = col[1]; rgba[i * 4 + 2] = col[2]; rgba[i * 4 + 3] = 255; };
  const near = (x, y) => [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].filter(([a, b]) => a >= 0 && b >= 0 && a < w && b < h).map(([a, b]) => b * w + a);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (c.mat[i]) {
        const m = MAT[c.mat[i]];
        // A part behind another one gets a line where they meet.
        const behind = near(x, y).some(j => c.mat[j] && c.group[j] !== c.group[i] && c.depth[i] - c.depth[j] > 1.6);
        set(i, behind ? m.line : m.tones[c.tone[i]]);
      } else {
        let nearest = null;
        for (const j of near(x, y)) if (c.mat[j] && (nearest === null || c.depth[j] < c.depth[nearest])) nearest = j;
        if (nearest !== null) set(i, MAT[c.mat[nearest]].line);
      }
    }
  }
  return { w, h, rgba };
}

// Small pixel pictures drawn over the frame (Z's while asleep, hearts when petted).
const GLYPHS = {
  Z: ['XXXXXXX', '.....X.', '....X..', '...X...', '..X....', '.X.....', 'XXXXXXX'],
  z: ['XXXXX', '...X.', '..X..', '.X...', 'XXXXX'],
  heart: ['.X.X.', 'XXXXX', 'XXXXX', '.XXX.', '..X..']
};
function stamp(img, glyph, x0, y0, mat) {
  const rows = GLYPHS[glyph], m = MAT[mat];
  const on = (x, y) => rows[y]?.[x] === 'X';
  const put = (x, y, col) => {
    if (x < 0 || y < 0 || x >= img.w || y >= img.h) return;
    const i = (y * img.w + x) * 4;
    img.rgba[i] = col[0]; img.rgba[i + 1] = col[1]; img.rgba[i + 2] = col[2]; img.rgba[i + 3] = 255;
  };
  for (let y = -1; y <= rows.length; y++) {
    for (let x = -1; x <= rows[0].length; x++) {
      if (on(x, y)) put(x0 + x, y0 + y, m.tones[2]);
      else if (on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1)) put(x0 + x, y0 + y, m.line);
    }
  }
}

function upscale(img, k = CHUNK) {
  const w = img.w * k, h = img.h * k, rgba = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) img.rgba.copy(rgba, (y * w + x) * 4, ((Math.floor(y / k) * img.w) + Math.floor(x / k)) * 4, ((Math.floor(y / k) * img.w) + Math.floor(x / k)) * 4 + 4);
  return { w, h, rgba };
}
const mirror = img => {
  const rgba = Buffer.alloc(img.rgba.length);
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) img.rgba.copy(rgba, (y * img.w + x) * 4, (y * img.w + (img.w - 1 - x)) * 4, (y * img.w + (img.w - 1 - x)) * 4 + 4);
  return { ...img, rgba };
};

function png({ w, h, rgba }) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const chunk = (type, data) => {
    const head = Buffer.alloc(4); head.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([head, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// MARK: Poses

// Standing on its fingertips (the base pose: every one-shot animation starts and ends here).
const STAND = { root: [-8.5, 13.4, 0], pitch: -3, tips: { index: 11.5, middle: 13.5, ring: 12, pinky: 9.5 }, thumb: [0, 9], spread: { index: 4, middle: 1, ring: -2, pinky: -6 } };

/**
 * A pose standing on the ground: the fingertips go where they are told (x, and
 * how high above the ground), the rest of the hand where `o` puts it.
 */
function stand(o = {}) {
  const pose = { root: add(STAND.root, [o.dx || 0, o.dy || 0, 0]), yaw: o.yaw || 0, pitch: STAND.pitch + (o.pitch || 0), roll: o.roll || 0, fingers: {}, thumb: null };
  const F = frameOf(pose);
  for (const name of NAMES) {
    const [x, up = 0] = o.tips?.[name] ?? [STAND.tips[name] + (o.tipShift || 0)];
    const spread = STAND.spread[name] + (o.spread?.[name] || 0) + (o.splay || 0) * Math.sign(STAND.spread[name] + 0.5);
    pose.fingers[name] = reach(F, name, [x, LIFT + tipR(name) + up, 0], spread);
  }
  const [tx, tz, up = 0] = o.thumb ?? [STAND.thumb[0] + (o.tipShift || 0), STAND.thumb[1]];
  pose.thumb = reach(F, 'thumb', [tx, LIFT + tipR('thumb') + up, tz], o.thumbSpread || 0);
  return pose;
}

/** Bends given directly (degrees): [knuckle, middle, last, spread] per finger, thumb the same. */
function bent(o) {
  const pose = { root: o.root, yaw: o.yaw || 0, pitch: o.pitch || 0, roll: o.roll || 0, fingers: {}, thumb: o.thumb };
  for (const name of NAMES) pose.fingers[name] = o.fingers[name] ?? o.fingers.all;
  return pose;
}

/** Blends two poses (every number). */
function mix(a, b, t) {
  if (typeof a === 'number') return lerp(a, b, t);
  if (Array.isArray(a)) return a.map((v, i) => mix(v, b[i], t));
  const out = {};
  for (const k of Object.keys(a)) out[k] = mix(a[k], b[k], t);
  return out;
}

/** Puts a pose back on the ground: its lowest point (fingertips, or the cuff) at y = LIFT. */
function grounded(pose) {
  const prims = handPrims(pose);
  let low = Infinity;
  for (const p of prims) {
    if (p.type === 'cone') low = Math.min(low, p.a[1] - p.ra, p.b[1] - p.rb);
    else if (p.type === 'ell' || p.type === 'cyl') {
      // The lowest point of an ellipsoid/cylinder: its centre minus its extent along y.
      const ext = Math.hypot(p.U[1] * p.r[0], p.V[1] * p.r[1]) + (p.type === 'cyl' ? Math.abs(p.W[1]) * p.r[2] : Math.abs(p.W[1] * p.r[2]));
      const e = p.type === 'ell' ? Math.hypot(p.U[1] * p.r[0], p.V[1] * p.r[1], p.W[1] * p.r[2]) : ext;
      low = Math.min(low, p.c[1] - e);
    }
  }
  return { ...pose, root: [pose.root[0], pose.root[1] + LIFT - low, pose.root[2]] };
}

// Lying flat on the palm, fingers stretched forward (bored).
const flat = (o = {}) => stand({ dy: -7.4 + (o.dy || 0), pitch: -6 + (o.pitch || 0), tips: Object.fromEntries(NAMES.map(n => [n, [{ index: 23, middle: 25.5, ring: 23.5, pinky: 19.5 }[n] + (o.shift || 0), o.lift?.[n] || 0]])), thumb: [5, 11, 0], splay: 3 });
// On its back, fingers loosely curled up (asleep).
const asleep = (breath = 0) => bent({ root: [-8.5, 0, 0], pitch: -7, roll: 180,
  fingers: Object.fromEntries(NAMES.map((n, i) => [n, [20 + 5 * breath + i * 3, 38 + 7 * breath, 28 + 5 * breath, STAND.spread[n] * 1.5]])),
  thumb: [-14, 12 + 4 * breath, 10, -10] });
// The raised hand: standing on the cuff, palm to the viewer, fingers up (listening).
const RAISED = (o = {}) => ({
  root: [0, -CUFF.back + LIFT + 0.25 + (o.dy || 0), 0], yaw: -90, pitch: 90, roll: o.roll || 0,
  fingers: Object.fromEntries(NAMES.map((n, i) => [n, [6 + (o.curl?.[n] || 0), 8 + (o.curl?.[n] || 0) * 0.6, 5, STAND.spread[n] * 1.8 * (o.spread || 1)]])),
  thumb: [8, 6 + (o.thumbCurl || 0), 4, -10]
});
// In the air: fingers spread and loose.
const airborne = (t = 0, wild = 1) => grounded(bent({ root: [-8.5, 10, 0], pitch: -2,
  fingers: Object.fromEntries(NAMES.map((n, i) => [n, [22 + wild * 14 * Math.sin(2 * Math.PI * (t + i * 0.23)), 14 + wild * 10 * Math.sin(2 * Math.PI * (t + i * 0.23 + 0.25)), 10, STAND.spread[n] * 2.4]])),
  thumb: [10 + wild * 10 * Math.sin(2 * Math.PI * (t + 0.6)), 10, 8, 12] }));

/** Walking gait for one fingertip: on the ground it slides back (the app moves the sprite forward), in the air it swings forward. */
function gait(phase, x0, stride, duty, height) {
  if (phase < duty) return [x0 + stride / 2 - stride * phase / duty, 0];
  const q = (phase - duty) / (1 - duty);
  return [x0 - stride / 2 + stride * ease(q), height * Math.sin(Math.PI * q)];
}

// MARK: Animations

const WALK = { T: 1, stride: 8, duty: 0.6, height: 3.2, phase: { index: 0, ring: 0.02, middle: 0.5, pinky: 0.52, thumb: 0.5 } };
const RUN = { T: 0.5, stride: 12, duty: 0.4, height: 4.5, phase: { index: 0, middle: 0.14, ring: 0.5, pinky: 0.64, thumb: 0.3 } };
const speedOf = g => g.stride / (g.duty * g.T) * ZOOM * CHUNK;   // sprite pixels per second

function locomotion(g, t, extra = {}) {
  const tips = {};
  for (const n of NAMES) tips[n] = gait((t + g.phase[n]) % 1, STAND.tips[n], g.stride, g.duty, g.height);
  const th = gait((t + g.phase.thumb) % 1, STAND.thumb[0], g.stride * 0.85, g.duty, g.height * 0.8);
  return stand({ tips, thumb: [th[0], STAND.thumb[1], th[1]], ...extra });
}

// A laptop on the floor in front of the hand (desk), turned a little towards the viewer.
function laptop(i) {
  const c = [7, 0, 0], yaw = 34;
  const parts = [];
  const box = (center, half, mat) => parts.push(solid('box', add(c, center), [1, 0, 0], [0, 1, 0], [0, 0, 1], half, mat, 'laptop'));
  box([0, LIFT + 0.75, 0], [8, 0.75, 6.8], 'metal');
  box([-0.6, LIFT + 1.55, 0], [6, 0.12, 5.6], 'keys');
  // The screen: hinged at the far end, leaning back a little, its face towards the hand.
  const hinge = [7.7, LIFT + 1.4, 0], lean = rad(14);
  const up = [Math.sin(lean), Math.cos(lean), 0], face = [-Math.cos(lean), Math.sin(lean), 0];
  const at = (h, d, z = 0) => add(add(add(c, hinge), add(mul(up, h), mul(face, d))), [0, 0, z]);
  parts.push(solid('box', at(7, 0), norm(face), norm(up), [0, 0, 1], [0.55, 7, 6.8], 'metal', 'laptop'));
  parts.push(solid('box', at(7.3, 0.5), norm(face), norm(up), [0, 0, 1], [0.08, 6.0, 5.8], 'screen', 'laptop'));
  for (let k = 0; k < 5; k++) {
    const w = [3.4, 2.2, 4.0, 1.6, 2.8][(k + Math.floor(i / 12)) % 5];
    parts.push(solid('box', at(11.6 - k * 2.1, 0.62, -4.8 + w), norm(face), norm(up), [0, 0, 1], [0.05, 0.42, w], 'code', 'laptop'));
  }
  return yawAbout(parts, yaw, c[0], c[2]);
}

/**
 * Every animation: frames, how it loops, and the picture for frame i of n.
 * A frame is { pose, extra?: primitives, glyphs?: [[name, x, y, mat]], yaw?, swing?: [deg, x, y], flip? }.
 */
const ANIMS = {
  idle: { frames: 96, loop: true, frame: (i, n) => {
    const t = i / n;
    const breath = Math.sin(2 * Math.PI * 2 * t);
    // Feels the air with the index finger, later taps with the middle one, then wiggles the thumb.
    const feel = bump(t, 0.28, 0.12);
    const tap = bump(t, 0.6, 0.035) + bump(t, 0.68, 0.035);
    const wig = bump(t, 0.86, 0.05);
    return { pose: stand({ dy: 0.35 * breath + 1.2 * feel, pitch: 5 * feel,
      tips: { index: [STAND.tips.index + 4 * feel, 7 * feel], middle: [STAND.tips.middle, 2.6 * tap] },
      thumb: [STAND.thumb[0] + 1.5 * wig, STAND.thumb[1] + 1 * wig, 2.5 * wig] }) };
  } },

  walk: { frames: 24, loop: true, speed: speedOf(WALK), frame: (i, n) => {
    const t = i / n;
    return { pose: locomotion(WALK, t, { dy: 0.55 * Math.cos(4 * Math.PI * t), pitch: 1.5 * Math.sin(4 * Math.PI * t) }) };
  } },

  run: { frames: 12, loop: true, speed: speedOf(RUN), frame: (i, n) => {
    const t = i / n;
    return { pose: locomotion(RUN, t, { dy: 1.2 * Math.cos(4 * Math.PI * t) - 0.5, pitch: 3 * Math.sin(4 * Math.PI * t) - 2 }) };
  } },

  stop: { frames: 18, loop: false, next: 'idle', frame: (i, n) => {
    const t = i / (n - 1);
    const brace = stand({ dy: -1.8, pitch: 5, tipShift: 4.5 });
    return { pose: t < 0.45 ? mix(locomotion(RUN, 0.1), brace, back(t / 0.45)) : mix(brace, stand(), ease((t - 0.45) / 0.55)) };
  } },

  // Turns to face the viewer, then (drawn mirrored) on round to the other side.
  turn: { frames: 12, loop: false, next: 'idle', mirrorAfter: true, frame: (i, n) => {
    const hop = 2.2 * Math.sin(Math.PI * (i + 1) / n);
    const yaw = i < n / 2 ? -90 * (i + 1) / (n / 2) : -90 * (n - 1 - i) / (n / 2);
    return { pose: stand({ dy: hop }), yaw, flip: i >= n / 2 };
  } },

  // "Hey Handry": rises onto its cuff, palm towards you.
  ears_up: { frames: 14, loop: false, next: 'listen', frame: (i, n) => {
    const t = i / (n - 1);
    const crouch = stand({ dy: -1.6, pitch: -2 });
    if (t < 0.25) return { pose: mix(stand(), crouch, ease(t / 0.25)) };
    const s = (t - 0.25) / 0.75;
    const p = mix(crouch, RAISED(), back(s));
    p.root = add(p.root, [0, 4 * Math.sin(Math.PI * clamp01(s)), 0]);
    return { pose: p };
  } },

  listen: { frames: 72, loop: true, frame: (i, n) => {
    const t = i / n;
    const curl = {};
    NAMES.forEach((name, k) => { curl[name] = 26 * bump(t, 0.36 + (3 - k) * 0.06, 0.07); });
    return { pose: RAISED({ curl, dy: 0.3 * Math.sin(2 * Math.PI * 2 * t), thumbCurl: 18 * bump(t, 0.82, 0.06) }), swing: [5 * Math.sin(2 * Math.PI * t), 0, 0] };
  } },

  listen_out: { frames: 10, loop: false, next: 'idle', frame: (i, n) => {
    const s = ease(i / (n - 1));
    const p = mix(RAISED(), stand(), s);
    p.root = add(p.root, [0, 3 * Math.sin(Math.PI * s), 0]);
    return { pose: p };
  } },

  // Typing on its little laptop while Claude thinks.
  desk: { frames: 48, loop: true, frame: (i, n) => {
    const t = i / n;
    const keyTop = 1.7;   // the keys' top above the floor
    const presses = { index: [0.05, 0.3, 0.55, 0.62, 0.85], middle: [0.17, 0.43, 0.72, 0.93], ring: [0.1, 0.36, 0.66], pinky: [0.24, 0.5, 0.78] };
    const tips = {};
    for (const [k, name] of NAMES.entries()) {
      const up = Math.max(...presses[name].map(c => bump((t + 1 - c) % 1, 0.045, 0.045)));
      tips[name] = [[4.5, 7, 5, 2][k], keyTop + 2.2 * (1 - up) - 0.05];
    }
    const space = bump(t, 0.48, 0.04) + bump(t, 0.98, 0.04);
    return { pose: stand({ dx: -5, dy: 1 + 0.25 * Math.sin(2 * Math.PI * 4 * t), pitch: -2, tips, thumb: [1.5, 8, keyTop + 1.6 * (1 - space)] }), extra: laptop(i) };
  } },

  // Petted: a happy ripple through the fingers, hearts.
  petted: { frames: 36, loop: false, next: 'idle', frame: (i, n) => {
    const t = i / (n - 1);
    const up = ease(span(t, 0, 0.15)) * (1 - ease(span(t, 0.8, 1)));
    const tips = {};
    NAMES.forEach((name, k) => {
      const lift = bump(t, 0.25 + (3 - k) * 0.07, 0.07) + bump(t, 0.52 + (3 - k) * 0.07, 0.07);
      tips[name] = [STAND.tips[name] + 1.5 * lift, 3.2 * lift];
    });
    const glyphs = [];
    if (t > 0.18 && t < 0.85) glyphs.push(['heart', FOOT + 2, GROUND - 44 - Math.round(12 * span(t, 0.18, 0.85)), 'heart']);
    if (t > 0.38 && t < 0.92) glyphs.push(['heart', FOOT + 14, GROUND - 40 - Math.round(11 * span(t, 0.38, 0.92)), 'heart']);
    return { pose: stand({ dy: 1.6 * up, pitch: 3 * up, tips }), glyphs };
  } },

  // Happy: crouch, a jump with jazz hands, land.
  happy: { frames: 32, loop: false, next: 'idle', frame: (i, n) => {
    const t = i / (n - 1);
    const crouch = stand({ dy: -2.6, pitch: -3 });
    // At the top it turns towards you, fingers spread wide and wiggling (jazz hands).
    const wiggle = Math.sin(2 * Math.PI * 3 * t) * bump(t, 0.47, 0.12);
    const jazz = RAISED({ dy: 3, spread: 2.2, curl: Object.fromEntries(NAMES.map((nm, k) => [nm, 14 * wiggle * (k % 2 ? 1 : -1)])) });
    let pose;
    if (t < 0.2) pose = mix(stand(), crouch, ease(t / 0.2));
    else if (t < 0.4) pose = mix(crouch, jazz, easeOut((t - 0.2) / 0.2));
    else if (t < 0.55) pose = jazz;
    else if (t < 0.7) pose = mix(jazz, crouch, easeIn((t - 0.55) / 0.15));
    else pose = mix(crouch, stand(), back((t - 0.7) / 0.3));
    return { pose };
  } },

  // Sad: sinks, fingers splay, a sigh, then picks itself up.
  sad: { frames: 48, loop: false, next: 'idle', frame: (i, n) => {
    const t = i / (n - 1);
    const sigh = bump(t, 0.5, 0.1);
    const low = stand({ dy: -5.5 + 1.2 * sigh, pitch: -9, tips: { index: [20], middle: [22.5], ring: [20.5], pinky: [17] }, thumb: [5, 10.5], splay: 5 });
    return { pose: t < 0.3 ? mix(stand(), low, ease(t / 0.3)) : t < 0.72 ? low : mix(low, stand(), ease((t - 0.72) / 0.28)) };
  } },

  bored_in: { frames: 12, loop: false, next: 'bored', frame: (i, n) => ({ pose: mix(stand(), flat(), ease(i / (n - 1))) }) },
  // Bored: lies flat and drums its fingers, pinky to index.
  bored: { frames: 96, loop: true, frame: (i, n) => {
    const t = i / n;
    const lift = {};
    NAMES.forEach((name, k) => { lift[name] = 3.2 * (bump(t, 0.12 + (3 - k) * 0.05, 0.035) + bump(t, 0.55 + (3 - k) * 0.05, 0.035)); });
    return { pose: flat({ lift, dy: 0.5 * bump(t, 0.9, 0.06) }) };
  } },
  bored_out: { frames: 12, loop: false, next: 'idle', frame: (i, n) => ({ pose: mix(flat(), stand(), ease(i / (n - 1))) }) },

  // Lies down, rolls onto its back, curls up.
  lie_down: { frames: 30, loop: false, next: 'sleep', frame: (i, n) => {
    const t = i / (n - 1);
    if (t < 0.35) return { pose: mix(stand(), flat(), ease(t / 0.35)) };
    const s = ease((t - 0.35) / 0.65);
    const p = mix(flat(), grounded(asleep()), s);
    p.roll = 180 * s;
    p.root = add(p.root, [0, 3 * Math.sin(Math.PI * s), 0]);
    return { pose: p };
  } },

  sleep: { frames: 96, loop: true, frame: (i, n) => {
    const t = i / n;
    const breath = Math.sin(2 * Math.PI * 2 * t);
    const glyphs = [];
    for (const [k, start] of [[0, 0], [1, 0.33], [2, 0.66]]) {
      const life = (t - start + 1) % 1;
      if (life < 0.6) glyphs.push([k === 1 ? 'Z' : 'z', FOOT + 2 + Math.round(16 * life), GROUND - 30 - Math.round(34 * life), 'white']);
    }
    const p = grounded(asleep(breath));
    return { pose: { ...p, root: add(p.root, [0, 0.25 * breath, 0]) }, glyphs };
  } },

  // Rolls back over, gets up, stretches.
  wake_up: { frames: 40, loop: false, next: 'idle', frame: (i, n) => {
    const t = i / (n - 1);
    if (t < 0.35) {
      const s = ease(t / 0.35);
      const p = mix(grounded(asleep()), flat(), s);
      p.roll = 180 * (1 - s);
      p.root = add(p.root, [0, 3 * Math.sin(Math.PI * s), 0]);
      return { pose: p };
    }
    const stretch = stand({ dy: 3.5, pitch: 7, splay: 8, tipShift: 1, thumb: [-1, 12] });
    if (t < 0.55) return { pose: mix(flat(), stand({ dy: -1 }), ease((t - 0.35) / 0.2)) };
    if (t < 0.8) return { pose: mix(stand({ dy: -1 }), stretch, ease((t - 0.55) / 0.25)) };
    return { pose: mix(stretch, stand(), ease((t - 0.8) / 0.2)) };
  } },

  // Crouch, push off (the app lifts it from frame 11).
  jump: { frames: 16, loop: false, next: 'fall', liftoff: 11, frame: (i, n) => {
    const crouch = stand({ dy: -3.8, pitch: -7 });
    const push = stand({ dy: 3.2, pitch: 3, tipShift: -2.5 });
    if (i < 10) return { pose: mix(stand(), crouch, ease(i / 9)) };
    return { pose: mix(crouch, push, easeOut((i - 9) / 3)) };
  } },

  fall: { frames: 12, loop: true, frame: (i, n) => ({ pose: airborne(i / n) }) },

  land: { frames: 14, loop: false, next: 'idle', frame: (i, n) => {
    const t = i / (n - 1);
    const crouch = stand({ dy: -3.5, pitch: -5 });
    if (t < 0.25) return { pose: mix(airborne(0, 0.4), crouch, easeOut(t / 0.25)) };
    return { pose: mix(crouch, stand(), back((t - 0.25) / 0.75)) };
  } },

  // Carried by the cuff: hangs fingers down, struggling.
  held_tail: { frames: 24, loop: true, size: [110, 110], origin: [55, 8], anchor: [110, 16], frame: (i, n) => {
    const t = i / n;
    const w = k => Math.sin(2 * Math.PI * (2 * t + k));
    const pose = bent({ root: [0, CUFF.back, 0], pitch: -90, roll: 0,
      fingers: Object.fromEntries(NAMES.map((nm, k) => [nm, [18 + 30 * w(k * 0.21), 22 + 18 * w(k * 0.21 + 0.25), 14, STAND.spread[nm] * 2 + 5 * w(k * 0.3)]])),
      thumb: [14 + 18 * w(0.55), 16, 10, 8] });
    return { pose, swing: [8 * Math.sin(2 * Math.PI * t), 0, 0], yaw: 14 * Math.sin(2 * Math.PI * t + 1) };
  } },

  // Carried by the back of the hand: fingers dangle.
  held_scruff: { frames: 48, loop: true, size: [110, 110], origin: [55, 14], anchor: [110, 28], frame: (i, n) => {
    const t = i / n;
    const pose = bent({ root: [0, 0, 0], pitch: -6,
      fingers: Object.fromEntries(NAMES.map((nm, k) => [nm, [72 + 6 * Math.sin(2 * Math.PI * (t + k * 0.12)), 22, 12, STAND.spread[nm] * 1.5]])),
      thumb: [34, 28, 18, -6] });
    // The grabbed point (the middle of the back of the hand) goes to the origin.
    const F = frameOf(pose);
    pose.root = mul(sub(F.at([8.2, 3.5, 0]), pose.root), -1);
    return { pose, swing: [4 * Math.sin(2 * Math.PI * t), 0, 0] };
  } },

  // Lying on a window's top edge, fingers over the corner.
  edge_hang: { frames: 48, loop: true, origin: [66, 40], anchor: [132, 80], frame: (i, n) => {
    const t = i / n;
    const tap = k => bump(t, 0.55 + k * 0.06, 0.04) + bump(t, 0.75 + k * 0.06, 0.04);
    const pose = bent({ root: [0.6 - 16.6, 5.4, 0], pitch: -4,
      fingers: Object.fromEntries(NAMES.map((nm, k) => [nm, [84 + 5 * Math.sin(2 * Math.PI * (t + k * 0.17)), 8 + 30 * tap(3 - k), 6, STAND.spread[nm]]])),
      thumb: [26, 18, 10, -8] });
    return { pose };
  } }
};

// MARK: Frames

function draw(anim, i) {
  const a = ANIMS[anim];
  const [w, h] = a.size ?? [W, H];
  const [ox, oy] = a.origin ?? [FOOT, GROUND];
  const f = a.frame(i, a.frames);
  let prims = handPrims(f.pose);
  if (f.extra) prims = prims.concat(f.extra);
  if (f.yaw) prims = yawAbout(prims, f.yaw, a.origin ? 0 : -1.5, 0);
  if (f.swing) prims = swingAbout(prims, f.swing[0], f.swing[1], f.swing[2]);
  let img = paint(cast(prims, sideCamera(w, h, ox, oy)));
  if (f.flip) img = mirror(img);
  for (const [g, x, y, mat] of f.glyphs ?? []) stamp(img, g, x, y, mat);
  return upscale(img);
}

function manifest() {
  const animations = {};
  for (const [name, a] of Object.entries(ANIMS)) {
    const m = { fps: FPS, loop: a.loop, frames: a.frames };
    if (a.next) m.next = a.next;
    if (a.speed) m.speed = Math.round(a.speed * 10) / 10;
    if (a.mirrorAfter) m.mirror_after = true;
    if (a.liftoff) m.liftoff_frame = a.liftoff;
    if (a.size) m.frame = a.size.map(v => v * CHUNK);
    if (a.anchor) { m.anchor = a.anchor; m.anchor_type = name === 'edge_hang' ? 'edge_corner' : 'grab'; }
    animations[name] = m;
  }
  return { frame: [W * CHUNK, H * CHUNK], ground: GROUND * CHUNK, facing: 'right', animations,
    note: 'app/hand/make.mjs çiziyor (elle düzenleme; yeniden üretince silinir). Değerler 1× sprite pikseli.' };
}

// MARK: Icons

/** A camera along `fwd` framed so the primitives fill `fill` of a w × w picture (two passes: look, then fit). */
function fitView(prims, fwd, w, fill) {
  let center = [0, 10, 0], size = 90;
  for (let pass = 0; pass < 2; pass++) {
    const cam = viewCamera(w, w, center, fwd, size);
    const c = cast(prims, cam);
    let x0 = w, x1 = -1, y0 = w, y1 = -1;
    c.mat.forEach((m, i) => { if (m) { const x = i % w, y = Math.floor(i / w); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } });
    const k = size / w;
    center = add(add(center, mul(cam.right, ((x0 + x1 + 1) / 2 - w / 2) * k)), mul(cam.up, (w / 2 - (y0 + y1 + 1) / 2) * k));
    size = Math.max(x1 - x0 + 1, y1 - y0 + 1) * k / fill;
  }
  return viewCamera(w, w, center, fwd, size);
}

/** The app icon's art (64 × 64 art pixels): standing on its fingertips, seen from the side and a little above. */
function iconArt(pose = stand(), fwd = [-0.35, -0.35, -1]) {
  const prims = handPrims(pose);
  return paint(cast(prims, fitView(prims, fwd, 64, 0.9)));
}

/** The menu bar glyph (36 × 36, a template: only the shape counts): the raised hand, fingers apart. */
function menubarGlyph() {
  const prims = handPrims(RAISED({ spread: 2.6 }));
  const c = cast(prims, fitView(prims, [0, 0, -1], 36, 0.94));
  const rgba = Buffer.alloc(36 * 36 * 4);
  for (let i = 0; i < 36 * 36; i++) {
    if (!c.mat[i]) continue;
    const x = i % 36, y = Math.floor(i / 36);
    // Lines between parts stay open, so the fingers read apart; so does the cuff's top edge.
    const nb = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].filter(([a, b]) => a >= 0 && b >= 0 && a < 36 && b < 36).map(([a, b]) => b * 36 + a);
    if (nb.some(j => c.mat[j] && c.group[j] !== c.group[i] && (c.depth[i] - c.depth[j] > 1.6 || (c.group[i] === 'cuff' && c.group[j] === 'palm' && j < i)))) continue;
    rgba[i * 4 + 3] = 255;
  }
  return { w: 36, h: 36, rgba };
}

// MARK: Main

const args = process.argv.slice(2);
const sheetAt = args.indexOf('--sheet');
const sheetPath = sheetAt >= 0 ? args.splice(sheetAt, 2)[1] : null;
const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? Number(args.splice(i, 2)[1]) : fallback; };
const COLS = option('--cols', 8), SHEET_ZOOM = option('--zoom', 1);
const wanted = args.length ? args : Object.keys(ANIMS);

fs.mkdirSync(SPRITES, { recursive: true });
const sheetRows = [];
for (const name of wanted) {
  const a = ANIMS[name];
  if (!a) throw new Error(`Bilinmeyen animasyon: ${name}`);
  const dir = path.join(SPRITES, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const row = [];
  for (let i = 0; i < a.frames; i++) {
    const img = draw(name, i);
    fs.writeFileSync(path.join(dir, `${String(i + 1).padStart(4, '0')}.png`), png(img));
    row.push(img);
  }
  sheetRows.push(row);
}
fs.writeFileSync(path.join(SPRITES, 'manifest.json'), JSON.stringify(manifest(), null, 2) + '\n');
fs.mkdirSync(ICONS, { recursive: true });
fs.writeFileSync(path.join(ICONS, 'art.png'), png(iconArt()));
fs.writeFileSync(path.join(ICONS, 'menubar.png'), png(menubarGlyph()));

// A contact sheet for looking at it: each animation one row, up to 8 frames, on a checker.
if (sheetPath) {
  const cols = COLS, cw = W * CHUNK, chh = 110 * CHUNK;
  const sw = cols * cw, sh = sheetRows.length * chh;
  const rgba = Buffer.alloc(sw * sh * 4);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const v = ((x >> 4) + (y >> 4)) % 2 ? 236 : 250;
    rgba.set([v, v, Math.min(255, v + 4), 255], (y * sw + x) * 4);
  }
  sheetRows.forEach((row, r) => {
    for (let c = 0; c < cols && c < row.length; c++) {
      const img = row[Math.floor(c * row.length / Math.min(cols, row.length))];
      for (let y = 0; y < img.h && y < chh; y++) for (let x = 0; x < img.w; x++) {
        const s = (y * img.w + x) * 4;
        if (img.rgba[s + 3]) img.rgba.copy(rgba, ((r * chh + y) * sw + c * cw + x) * 4, s, s + 4);
      }
      // The ground line.
      for (let x = 0; x < cw; x++) rgba.set([200, 120, 120, 255], ((r * chh + GROUND * CHUNK) * sw + c * cw + x) * 4);
    }
  });
  fs.writeFileSync(sheetPath, png(SHEET_ZOOM > 1 ? upscale({ w: sw, h: sh, rgba }, SHEET_ZOOM) : { w: sw, h: sh, rgba }));
}
console.log(`${wanted.length} animasyon çizildi → ${path.relative(process.cwd(), SPRITES)}`);
