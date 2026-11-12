// Handry · © 2026 Berat Olekli (purplefox) · github.com/purplefox21/handry
// Hand gestures, the logic only (no camera, no drawing): app/public/hands.js gives it each camera frame's hand
// (MediaPipe's 21 points, in the picture and in metres, plus the gesture its model saw) and posts what comes out
// to Handry.app (app/macos/Hands.swift), which moves the real mouse. Kept apart so tests/hands-e2e.mjs can try it
// with made-up hands.
//
//   ☝️  index finger out:            the pointer follows the hand (the index knuckle, which stays still in a pinch)
//   🤏 thumb and index together:     mouse button down; let go: up. Quick = click, twice = double click,
//                                     pinch and move = drag
//   ✌️  index and middle out:         scroll: the hand above where it started scrolls up, below scrolls down,
//                                     farther = faster
//   ✋ open palm, ✊ fist, other:    nothing (the pointer stays where it is)
// A hand outside the part of the picture that covers the screen does nothing, so hands on the keyboard are left
// alone. A pinch clicks only right after pointing, so a pinch while doing something else doesn't click.

// The 21 points: 0 wrist; thumb 1-4; index 5-8; middle 9-12; ring 13-16; little finger 17-20 (knuckle, two
// joints, tip).
export const CONNECTIONS = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11],
  [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
const CHAINS = { index: [5, 6, 7, 8], middle: [9, 10, 11, 12], ring: [13, 14, 15, 16], pinky: [17, 18, 19, 20] };
export const ANCHOR = 5; // the index knuckle: where the pointer is

const PINCH_ON = 0.28;   // thumb tip to index tip, in palm lengths (wrist to middle knuckle)
const PINCH_OFF = 0.42;
const STRAIGHT_ON = 0.86; // a finger counts as out when its joints are this close to a straight line…
const STRAIGHT_OFF = 0.78; // …and stays out until it bends past this
const STEADY = 3;         // frames a new pose must last (~0.1 s)
const ARMED_MS = 800;     // a pinch clicks only this soon after pointing
const DRAG_PX = 18;       // a pinch turns into a drag after moving this far
const LOCK_MS = 100;      // a click goes where the pointer was this long before the pinch (pinching moves the hand)
const OUTSIDE = 0.25;     // how far past the screen's part of the picture a hand may be and still count
const SCROLL_DEAD = 0.04; // scrolling: how far the hand may drift without scrolling (part of the screen's height)
const SCROLL_MAX = 3000;  // px a second

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: (a.z || 0) - (b.z || 0) });
const len = v => Math.hypot(v.x, v.y, v.z);
const dist = (a, b) => len(sub(a, b));
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const unit = v => { const l = len(v) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Shape of one hand from its 3D points (metres): how straight each finger is and how close the pinch is. */
export function measure(world) {
  const palm = dist(world[0], world[9]) || 1;
  const palmDir = unit(sub(world[9], world[0]));
  const fingers = {};
  for (const [name, c] of Object.entries(CHAINS)) {
    let along = 0;
    for (let i = 1; i < c.length; i++) along += dist(world[c[i - 1]], world[c[i]]);
    fingers[name] = {
      straight: dist(world[c[0]], world[c[3]]) / (along || 1),
      // pointing the way the palm does (a finger folded down at the knuckle is not "out")
      ahead: dot(unit(sub(world[c[3]], world[c[0]])), palmDir)
    };
  }
  return { fingers, pinch: dist(world[4], world[8]) / palm };
}

// One Euro filter: steady when the hand rests, quick when it moves.
function oneEuro({ minCutoff = 1.5, beta = 0.01, dCutoff = 1 } = {}) {
  let x = null, dx = 0, t = null;
  const alpha = (cutoff, dt) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
  return (value, now) => {
    if (x === null) { x = value; t = now; return value; }
    const dt = Math.max(1e-3, (now - t) / 1000);
    t = now;
    dx += alpha(dCutoff, dt) * ((value - x) / dt - dx);
    x += alpha(minCutoff + beta * Math.abs(dx), dt) * (value - x);
    return x;
  };
}

/**
 * The gesture follower. screen: the screen's size in points; video: the camera picture's width / height.
 * step(hand, t) takes one frame (hand = { image, world, gesture: { name, score } } or null) and returns what to
 * do: { type: 'move' | 'down' | 'up', x, y } (screen points) and { type: 'scroll', dy } (points, + = up).
 */
export function createHands({ screen = { w: 1512, h: 982 }, video = 16 / 9 } = {}) {
  // The part of the camera picture that covers the screen: in the middle, a bit low (hands are below the face),
  // the screen's shape.
  const rw = 0.42;
  const rh = Math.min(0.8, rw * video / (screen.w / screen.h));
  const region = { x0: 0.5 - rw / 2, x1: 0.5 + rw / 2, y0: 0.54 - rh / 2, y1: 0.54 + rh / 2 };

  let pose = 'none', next = null, nextCount = 0;
  let out = { index: false, middle: false, ring: false, pinky: false };
  let pinched = false, armed = false, down = false, dragging = false, downAt = null;
  let lastPointAt = -1e9;
  let fx = null, fy = null, sent = null, history = [];
  let scrollFrom = null, scrollCarry = 0, lastT = null;

  /** Where the hand points on the screen (mirrored: the picture is the camera's, not a mirror's). */
  function onScreen(p) {
    const u = (region.x1 - p.x) / (region.x1 - region.x0);
    const v = (p.y - region.y0) / (region.y1 - region.y0);
    return {
      x: clamp(-0.02 + u * 1.04, 0, 1) * screen.w,
      y: clamp(-0.02 + v * 1.04, 0, 1) * screen.h,
      inside: u > -OUTSIDE && u < 1 + OUTSIDE && v > -OUTSIDE && v < 1 + OUTSIDE
    };
  }

  function shapeOf(m, gesture) {
    for (const [name, f] of Object.entries(m.fingers)) {
      const straight = f.straight > (out[name] ? STRAIGHT_OFF : STRAIGHT_ON) && f.ahead > 0.2;
      out[name] = straight;
    }
    // The model's own gestures when it is sure, the fingers otherwise.
    if (gesture && gesture.score > 0.65) {
      if (gesture.name === 'Open_Palm') return 'palm';
      if (gesture.name === 'Victory') return 'scroll';
      if (gesture.name === 'Closed_Fist') return 'fist';
      if (gesture.name === 'Pointing_Up') return 'point';
    }
    if (out.index && out.middle && out.ring) return 'palm';
    if (out.index && out.middle && !out.ring && !out.pinky) return 'scroll';
    if (out.index && !out.middle && !(out.ring && out.pinky)) return 'point';
    if (!out.index && !out.middle && !out.ring && !out.pinky) return 'fist';
    return 'idle';
  }

  function release(events) {
    if (down) {
      const at = dragging ? sent || downAt : downAt;
      events.push({ type: 'up', x: at.x, y: at.y });
    }
    down = false; dragging = false; downAt = null; pinched = false; armed = false;
  }

  function moveTo(events, x, y, t) {
    if (!sent || Math.hypot(x - sent.x, y - sent.y) >= 0.5) {
      sent = { x, y };
      events.push({ type: 'move', x, y });
    }
    history.push({ t, x: sent.x, y: sent.y });
    while (history.length && history[0].t < t - 500) history.shift();
  }

  function step(hand, t) {
    const events = [];
    const dt = lastT === null ? 1 / 30 : clamp((t - lastT) / 1000, 0.001, 0.2);
    lastT = t;
    if (!hand) {
      release(events);
      pose = 'none'; next = null; nextCount = 0; fx = fy = null; history = []; scrollFrom = null;
      return events;
    }
    const m = measure(hand.world);
    const shape = shapeOf(m, hand.gesture);
    const where = onScreen(hand.image[ANCHOR]);
    const fist = shape === 'fist';

    // The pinch: on and off at once (two thresholds keep it from flickering).
    if (!pinched && m.pinch < PINCH_ON && m.fingers.index.straight > 0.5 && !fist) {
      pinched = true;
      armed = (pose === 'point' || t - lastPointAt < ARMED_MS) && where.inside;
    } else if (pinched && m.pinch > PINCH_OFF) {
      release(events);
    }

    // Any other pose must last a few frames in a row.
    const raw = pinched ? (armed ? 'pinch' : 'idle') : shape;
    let now = raw;
    if (raw === pose) { next = null; nextCount = 0; }
    else if (!pinched && pose !== 'none' && pose !== 'pinch') {
      if (raw === next) nextCount++; else { next = raw; nextCount = 1; }
      if (nextCount < STEADY) now = pose; else { next = null; nextCount = 0; }
    }
    const was = pose;
    pose = now;

    // The pointer, smoothed.
    if (!fx) { fx = oneEuro(); fy = oneEuro(); }
    const x = fx(where.x, t), y = fy(where.y, t);

    if (pose === 'point' && where.inside) {
      lastPointAt = t;
      moveTo(events, x, y, t);
    } else if (pose === 'pinch') {
      if (!down) {
        // where the pointer was just before the hand closed
        const before = history.filter(h => h.t <= t - LOCK_MS).pop() || history[0] || sent || { x, y };
        downAt = { x: before.x, y: before.y };
        down = true;
        events.push({ type: 'down', x: downAt.x, y: downAt.y });
      } else {
        if (!dragging && Math.hypot(x - downAt.x, y - downAt.y) > DRAG_PX) dragging = true;
        if (dragging) moveTo(events, x, y, t);
      }
    }

    if (pose === 'scroll') {
      const hy = hand.image[ANCHOR].y;
      if (was !== 'scroll' || scrollFrom === null) { scrollFrom = hy; scrollCarry = 0; }
      const off = (hy - scrollFrom) / (region.y1 - region.y0);
      const over = Math.max(0, Math.abs(off) - SCROLL_DEAD);
      const speed = Math.min(SCROLL_MAX, 8000 * over ** 1.3);
      const want = -Math.sign(off) * speed * dt + scrollCarry;
      const dy = Math.trunc(want);
      scrollCarry = want - dy;
      if (dy) events.push({ type: 'scroll', dy });
    } else {
      scrollFrom = null;
    }
    return events;
  }

  return {
    step,
    region,
    get pose() { return pose; },
    get dragging() { return dragging; },
    /** Lets go of the mouse button (when the camera stops). */
    reset() { const events = []; release(events); pose = 'none'; return events; }
  };
}
