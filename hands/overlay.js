// What to draw on the screen for Handry.app's drawing layer (app/macos/Overlay.swift):
// lines that appear by themselves out of the dot under the notch: an arrow, a
// circle, an underline, a box, and a short note. Places are global top-left
// screen points, the same the desktop hands use. Nothing is clicked.
// A drawing goes after its seconds (counted from when it shows) or as soon as the
// user clicks or types; several places can be shown one after another (steps).
// Written to ~/.jevis/overlay.json in one go (a temp file renamed over it), so
// the app never reads half of it.
import fs from 'node:fs';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { HOME, homeDir } from '../core/config.js';
import { APP_NAME } from '../core/brand.js';

export const SHAPES = ['arrow', 'circle', 'underline', 'box', 'note'];

// The colors a drawing can take; 'auto' picks the one that stands out most from what is under it.
export const PALETTE = { violet: '#AF52DE', pink: '#FF2D78', red: '#FF3B30', orange: '#FF9500', yellow: '#FFD60A', green: '#30D158', teal: '#40C8E0', blue: '#0A84FF' };
const rgbOf = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const luminance = ([r, g, b]) => {
  const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
function hueSat([r, g, b]) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (!d) return { hue: 0, sat: 0 };
  const hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { hue: (hue * 60 + 360) % 360, sat: max ? d / max : 0 };
}

/**
 * The palette color that stands out most on a background ([r, g, b]): far in lightness (WCAG contrast) and,
 * on a colored background, far in hue too (no orange on an orange button). Violet wins a near tie.
 */
export function bestColor(bg) {
  const { hue: bh, sat: bs } = hueSat(bg);
  let best = PALETTE.violet, score = -1;
  for (const [name, hex] of Object.entries(PALETTE)) {
    const c = rgbOf(hex);
    const apart = Math.min(Math.abs(hueSat(c).hue - bh), 360 - Math.abs(hueSat(c).hue - bh)) / 180;
    const s = contrast(c, bg) * (1 - 0.7 * bs * (1 - apart)) * (name === 'violet' ? 1.08 : 1);
    if (s > score) { score = s; best = hex; }
  }
  return best;
}

/** The average color of the screen around rect (screencapture; needs Screen Recording), or null. */
export async function backgroundOf(rect, pad = 24) {
  const file = path.join(homeDir('tmp'), `under-${process.pid}-${counter++}.bmp`);
  try {
    const r = [rect.x - pad, rect.y - pad, rect.w + 2 * pad, rect.h + 2 * pad].map(Math.round);
    // not blocking: a confirmation question opens while this runs
    await promisify(execFile)('screencapture', ['-x', '-t', 'bmp', `-R${r.join(',')}`, file], { timeout: 4000 });
    const b = await fs.promises.readFile(file);
    const start = b.readUInt32LE(10), w = b.readInt32LE(18), h = Math.abs(b.readInt32LE(22)), bytes = b.readUInt16LE(28) / 8;
    if (!w || !h || bytes < 3) return null;
    const stride = Math.ceil((w * bytes) / 4) * 4, step = Math.max(1, Math.floor(Math.sqrt((w * h) / 4000)));
    let red = 0, green = 0, blue = 0, n = 0;
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const i = start + y * stride + x * bytes; // rows of blue, green, red
        blue += b[i]; green += b[i + 1]; red += b[i + 2]; n++;
      }
    }
    return n ? [red / n, green / n, blue / n] : null;
  } catch {
    return null;
  } finally {
    fs.rmSync(file, { force: true });
  }
}
const FILE = () => path.join(HOME, 'overlay.json');
let counter = 0;

function shown() {
  try {
    return (JSON.parse(fs.readFileSync(FILE(), 'utf-8')).shapes || []).filter(s => s.until > Date.now());
  } catch {
    return [];
  }
}

function write(shapes) {
  fs.mkdirSync(HOME, { recursive: true });
  const tmp = `${FILE()}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ at: Date.now(), shapes }));
  fs.renameSync(tmp, FILE());
  // tests read every drawing, even ones cleared a moment later
  if (process.env.JEVIS_TEST_OVERLAY_LOG) fs.appendFileSync(process.env.JEVIS_TEST_OVERLAY_LOG, `${JSON.stringify(shapes)}\n`);
}

/**
 * Draws a shape around rect ({ x, y, w, h }); returns its id (to clear it). color: 'auto' (default: the palette
 * color that stands out most from the screen under it), a palette name, or '#RRGGBB'.
 */
async function colorFor(color, rect) {
  if (color === 'auto' || !color) {
    const bg = process.env.JEVIS_TEST_OVERLAY_BG ? JSON.parse(process.env.JEVIS_TEST_OVERLAY_BG) : await backgroundOf(rect);
    return bg ? bestColor(bg) : PALETTE.violet;
  }
  return PALETTE[color] || color;
}

async function shape({ shape: kind = 'arrow', rect, note, color, seconds }) {
  return {
    id: `s${Date.now().toString(36)}${(counter++).toString(36)}`,
    kind: SHAPES.includes(kind) ? kind : 'arrow',
    rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.max(1, Math.round(rect.w)), h: Math.max(1, Math.round(rect.h)) },
    ...(note ? { text: String(note).slice(0, 80) } : {}),
    color: await colorFor(color, rect),
    seconds
  };
}

const span = seconds => Math.min(Math.max(1, Number(seconds) || 5), 900);

/** Draws a shape around rect ({ x, y, w, h }); returns its id (to clear it). See bestColor for color 'auto'. */
export async function draw({ shape: kind = 'arrow', rect, note, color = 'auto', seconds = 5 }) {
  const secs = span(seconds);
  // the file keeps it a little longer than it shows: the app counts the seconds from when it appears
  const item = { ...(await shape({ shape: kind, rect, note, color, seconds: secs })), until: Date.now() + secs * 1000 + 3000 };
  write([...shown(), item]);
  return item.id;
}

/**
 * Several places one after another ({ shape, rect, note } each): the next one shows when the last one goes
 * (its seconds are up, or the user clicked or typed). The notes are numbered. Returns the ids.
 */
export async function drawSteps(steps, { seconds = 5, color = 'auto' } = {}) {
  const secs = span(seconds);
  const group = `g${Date.now().toString(36)}${(counter++).toString(36)}`;
  const until = Date.now() + steps.length * (secs + 1) * 1000 + 5000;
  const items = await Promise.all(steps.map(async (st, i) => ({
    ...(await shape({ ...st, color: st.color || color, note: `${i + 1}. ${st.note || ''}`.trim(), seconds: secs })),
    group, order: i, until
  })));
  write([...shown(), ...items]);
  return items.map(x => x.id);
}

/** Removes one drawing (id), several (ids) or all of them. */
export function clear(ids) {
  const gone = ids === undefined ? null : new Set([].concat(ids));
  write(gone ? shown().filter(s => !gone.has(s.id)) : []);
}

/** Is Handry.app running (it draws the layer)? */
export function appRunning() {
  try {
    execFileSync('pgrep', ['-f', `${APP_NAME}.app/Contents/MacOS/`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
