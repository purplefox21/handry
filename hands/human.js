// Human-like input for Chrome pages. The pointer glides along a curve (slow
// start, fast middle, slow landing), a click has a short hold, and text
// arrives key by key at a typing pace. Sites that judge "is this a person?"
// (Google sign-in for one) then see real mouse movement and keystrokes
// instead of a pointer that appears on the button and a value that shows up
// with no key events. JEVIS_HUMAN=0 or `human.enabled: false` in the config
// turns it off (tests that only want speed).
import { config } from '../core/config.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);
const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const humanOn = () => process.env.JEVIS_HUMAN !== '0' && config().human?.enabled !== false;
/** Longer text is pasted the old way: nobody types a 2000 character description key by key. */
export const maxTypeChars = () => config().human?.maxTypeChars ?? 120;

// Hosts where being taken for a bot ends the login: forms there are always typed by hand.
const STRICT_HOSTS = /(^|\.)(accounts\.google\.com|idmsa\.apple\.com|appleid\.apple\.com|login\.microsoftonline\.com|login\.live\.com|github\.com|facebook\.com|instagram\.com|linkedin\.com|x\.com|twitter\.com)$/;
export const strictHost = url => { try { return STRICT_HOSTS.test(new URL(url).host); } catch { return false; } };

const pointer = new WeakMap(); // page → where JEVIS left the pointer

async function viewport(page) {
  return page.evaluate(() => ({ w: innerWidth, h: innerHeight })).catch(() => ({ w: 1200, h: 800 }));
}

// One curved stroke from a to b; the speed follows a minimum-jerk curve.
async function stroke(page, a, b, duration, bow, vp) {
  const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
  if (d < 1) return;
  const nx = -dy / d, ny = dx / d;
  const p1 = { x: a.x + dx * 0.3 + nx * bow, y: a.y + dy * 0.3 + ny * bow };
  const p2 = { x: a.x + dx * 0.7 + nx * bow * 0.6, y: a.y + dy * 0.7 + ny * bow * 0.6 };
  const n = Math.max(6, Math.round(duration / 11));
  const t0 = Date.now();
  let last = { x: Math.round(a.x), y: Math.round(a.y) };
  for (let i = 1; i <= n; i++) {
    const u = i / n;
    const s = u * u * u * (u * (6 * u - 15) + 10);
    const m = 1 - s;
    let x = m * m * m * a.x + 3 * m * m * s * p1.x + 3 * m * s * s * p2.x + s * s * s * b.x;
    let y = m * m * m * a.y + 3 * m * m * s * p1.y + 3 * m * s * s * p2.y + s * s * s * b.y;
    if (i < n) { x += gauss() * 0.6; y += gauss() * 0.6; } // a hand is never perfectly steady
    const pt = i < n
      ? { x: clamp(Math.round(x), 0, vp.w - 1), y: clamp(Math.round(y), 0, vp.h - 1) }
      : { x: Math.round(b.x), y: Math.round(b.y) };
    const wait = t0 + duration * u - Date.now();
    if (wait > 0) await sleep(wait);
    if (pt.x === last.x && pt.y === last.y) continue;
    await page.mouse.move(pt.x, pt.y);
    last = pt;
  }
}

/** Moves the pointer to `to` (viewport pixels) the way a hand would. */
export async function glide(page, to) {
  const vp = await viewport(page);
  let from = pointer.get(page);
  if (!from) {
    from = { x: Math.round(vp.w * rand(0.35, 0.65)), y: Math.round(vp.h * rand(0.3, 0.55)) };
    await page.mouse.move(from.x, from.y);
  }
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  if (dist >= 2) {
    const duration = clamp((200 + 140 * Math.log2(dist / 40 + 1)) * rand(0.85, 1.25), 160, 1500);
    const bow = dist * rand(0.04, 0.12) * (Math.random() < 0.5 ? -1 : 1);
    if (dist > 280 && Math.random() < 0.35) {
      // a long throw often lands a little past the target and comes back
      const over = rand(6, 16);
      const via = { x: to.x + ((to.x - from.x) / dist) * over, y: to.y + ((to.y - from.y) / dist) * over };
      await stroke(page, from, via, duration * 0.88, bow, vp);
      await sleep(rand(30, 80));
      await stroke(page, via, to, rand(90, 170), 0, vp);
    } else {
      await stroke(page, from, to, duration, bow, vp);
    }
  }
  pointer.set(page, { x: Math.round(to.x), y: Math.round(to.y) });
}

/** Mouse wheel in small ticks, like a hand on a wheel or trackpad. */
export async function wheel(page, dy) {
  const vp = await viewport(page);
  const at = pointer.get(page);
  if (!at || at.x < 0 || at.y < 0 || at.x >= vp.w || at.y >= vp.h) {
    await glide(page, { x: Math.round(vp.w * rand(0.4, 0.6)), y: Math.round(vp.h * rand(0.4, 0.6)) });
  }
  let left = Math.abs(dy);
  const sign = dy < 0 ? -1 : 1;
  while (left > 0) {
    const step = Math.min(left, Math.round(rand(50, 130)));
    await page.mouse.wheel(0, sign * step);
    left -= step;
    await sleep(rand(14, 36));
  }
  await sleep(rand(120, 260));
}

// Brings the element into view with the wheel; the instant jump is the last resort.
async function reveal(page, loc) {
  for (let i = 0; i < 12; i++) {
    const box = await loc.boundingBox().catch(() => null);
    if (!box) break;
    const vp = await viewport(page);
    const margin = 80;
    let dy = 0;
    if (box.y < margin) dy = box.y - vp.h * 0.3;
    else if (box.y + box.height > vp.h - margin) dy = box.y + box.height - vp.h * 0.7;
    if (Math.abs(dy) < 4) return;
    await wheel(page, clamp(dy, -700, 700));
  }
  await loc.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
}

/**
 * Glides to a spot inside the element (not its exact middle), rests a moment,
 * then presses and releases with a short hold. Playwright's own click does the
 * actionability and covered-element checks. Throws like loc.click() does.
 */
export async function click(loc, { timeout = 3000 } = {}) {
  const page = loc.page();
  await reveal(page, loc);
  const box = await loc.boundingBox();
  if (!box || box.width < 1 || box.height < 1) return loc.click({ timeout });
  const vp = await viewport(page);
  const px = box.width < 8 ? box.width / 2 : clamp(box.width / 2 + gauss() * Math.min(box.width * 0.18, 30), 3, box.width - 3);
  const py = box.height < 6 ? box.height / 2 : clamp(box.height / 2 + gauss() * Math.min(box.height * 0.18, 8), 2, box.height - 2);
  const target = { x: clamp(box.x + px, 1, vp.w - 2), y: clamp(box.y + py, 1, vp.h - 2) };
  await glide(page, target);
  await sleep(rand(70, 200));
  await loc.click({ position: { x: px, y: py }, delay: rand(45, 120), timeout });
}

const SHIFTED = /[A-Z~!@#$%^&*()_+{}|:"<>?]/;

/** Types text key by key: key hold, uneven gaps, Shift for capitals, now and then a hesitation. */
export async function typeKeys(page, text) {
  await sleep(rand(160, 380));
  for (const ch of text) {
    if (ch === '\n') {
      await page.keyboard.press('Enter', { delay: rand(40, 90) });
    } else {
      const shift = SHIFTED.test(ch);
      if (shift) { await page.keyboard.down('Shift'); await sleep(rand(30, 80)); }
      await page.keyboard.type(ch, { delay: rand(30, 75) });
      if (shift) await page.keyboard.up('Shift');
    }
    let gap = clamp(70 + gauss() * 24, 40, 180);
    if (Math.random() < 0.04) gap += rand(200, 450);
    await sleep(gap);
  }
}

const valueOf = el => ('value' in el ? el.value : el.isContentEditable ? el.innerText : null);
const squash = s => String(s).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/**
 * Clicks into a field and types the text. `append` adds to what is there;
 * otherwise the old content is selected and replaced. If the field does not
 * end up holding the text (a script ate a key), the value is set directly so
 * the result is always right. Returns the way it was entered.
 */
export async function fillField(loc, text, { append = false } = {}) {
  const page = loc.page();
  const before = await loc.evaluate(valueOf).catch(() => null);
  await click(loc);
  if (append) {
    await page.keyboard.press('End', { delay: rand(30, 70) });
  } else if (before) {
    await page.keyboard.press('Meta+A', { delay: rand(30, 70) });
    await sleep(rand(60, 140));
    await page.keyboard.press('Backspace', { delay: rand(30, 70) });
    await sleep(rand(80, 180));
  }
  await typeKeys(page, text);
  if (before === null) return 'keys'; // contenteditable and the like: cannot be compared reliably
  const expected = append ? before + text : text;
  const now = await loc.evaluate(valueOf).catch(() => null);
  if (now !== null && now !== expected && squash(now) !== squash(expected)) {
    await loc.fill(expected, { timeout: 4000 });
    return 'fill';
  }
  return 'keys';
}

/** Presses a key (or chord) with a real key hold. */
export const pressKey = (page, keys) => page.keyboard.press(keys, { delay: rand(40, 90) });
