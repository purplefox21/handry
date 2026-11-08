// Handry · © 2026 Berat Olekli (purplefox) · github.com/purplefox21/handry
// The pen (Kalem): the user draws on the screen with Handry.app (app/macos/Pen.swift) and asks "what is this?".
// The app writes the lines to ~/.jevis/marks/current.json (global top-left points, the same the desktop hands
// use); a question asked with the drawing goes to question.json. Here the lines become marks (a circle, an
// underline, a line or arrow, a dot, a scribble), and for each mark what is under it: the window and app (the
// window list), the control (the accessibility tree of that app, asked past Handry's own layer) and a close-up.
// Pictures are taken only when screen_marks asks, kept in ~/.jevis/marks/<drawing>/ (the last ten drawings),
// and sent nowhere else.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { HOME, homeDir, saveState } from '../core/config.js';
import { JevisError } from '../core/errors.js';
import { APP_NAME, MCP_NAME } from '../core/brand.js';
import { T } from '../core/i18n.js';
import * as desktop from './desktop.js';

const run = promisify(execFile);
const KEEP = 10;
const IMAGE_WIDTH = 1400;
const CLOSE_UP = 700;
const MAX_CLOSE_UPS = 4;
export const PEN_COLOR = '#C6FF00'; // the user's lines; Handry's own drawings never use it (hands/overlay.js PALETTE)

const dir = () => path.join(HOME, 'marks');
const CURRENT = () => path.join(dir(), 'current.json');
const QUESTION = () => path.join(dir(), 'question.json');
const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return null; } };

/** The drawing the app saved last ({ id, at, active, strokes }), or null when there is none (or it was cleared). */
export function current() {
  const d = readJson(CURRENT());
  return d?.strokes?.length ? d : null;
}

/** The question asked with a drawing (from the bar, by voice, or sent on to a Claude session). */
export function setQuestion(text, via = 'bar', drawingId = current()?.id) {
  if (!drawingId || !String(text || '').trim()) return null;
  fs.mkdirSync(dir(), { recursive: true });
  const q = { drawingId, text: String(text).trim().slice(0, 500), via, at: Date.now() };
  fs.writeFileSync(QUESTION(), JSON.stringify(q));
  return q;
}

export function questionFor(drawingId) {
  const q = readJson(QUESTION());
  return q && q.drawingId === drawingId ? q : null;
}

/** What goes to an open Claude Code session when the user sends the question there. */
export function forwardText(question) {
  return T(`Kullanıcı ekranda bir yer işaretledi ve soruyor: "${question}". Neyi işaretlediğini görmek için önce ${MCP_NAME} screen_marks aracını çağır; cevap verirken gerekirse screen_draw ile onun çiziminin yanına ok ya da etiket koy.`,
    `The user marked something on the screen and asks: "${question}". Call the ${MCP_NAME} screen_marks tool first to see what they marked; when you answer, you can put an arrow or a label next to their drawing with screen_draw.`);
}

const box = points => {
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
};
const grow = (b, pad) => ({ x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad });
const meet = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const union = (a, b) => { const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y); return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }; };
const length = points => points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - points[i][0], p[1] - points[i][1]), 0);
const round = b => ({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) });

/**
 * What one mark is and where to look under it: a closed loop (circle, box) → its middle; a flat open line
 * (underline) → just above it; any other open line (a line, an arrow) → where it ends; a dot → itself;
 * several lines together (a scribble, an arrow drawn in two strokes) → the middle.
 */
export function shapeOf(strokes) {
  const all = strokes.flatMap(s => s.points);
  const b = box(all);
  const middle = [b.x + b.w / 2, b.y + b.h / 2];
  if (b.w < 14 && b.h < 14) return { kind: 'dot', probe: middle };
  // the far end from where a line started: the tip, also of an arrow whose head was drawn in the same stroke
  const tip = pts => pts.reduce((best, p) => (Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]) > Math.hypot(best[0] - pts[0][0], best[1] - pts[0][1]) ? p : best), pts[0]);
  if (strokes.length === 2) {
    // an arrow drawn in two strokes: a long line, and a short head at one of its ends
    const [long, short] = [...strokes].sort((p, q) => length(q.points) - length(p.points)).map(s => s.points);
    const head = box(short);
    const headMiddle = [head.x + head.w / 2, head.y + head.h / 2];
    const end = [long[0], long[long.length - 1]].sort((p, q) => Math.hypot(p[0] - headMiddle[0], p[1] - headMiddle[1]) - Math.hypot(q[0] - headMiddle[0], q[1] - headMiddle[1]))[0];
    if (length(short) < 0.6 * length(long) && Math.hypot(end[0] - headMiddle[0], end[1] - headMiddle[1]) < 45) return { kind: 'line', probe: end };
  }
  if (strokes.length > 1) return { kind: 'scribble', probe: middle };
  const pts = strokes[0].points;
  const [first, last] = [pts[0], pts[pts.length - 1]];
  const size = Math.max(b.w, b.h);
  const closed = Math.hypot(first[0] - last[0], first[1] - last[1]) < 0.3 * size && length(pts) > 1.6 * (b.w + b.h) * 0.75;
  if (closed) return { kind: 'circle', probe: middle };
  if (b.h < 0.3 * b.w && b.w > 30) return { kind: 'underline', probe: [middle[0], b.y - 12] };
  return { kind: 'line', probe: tip(pts) };
}

/** The drawing's lines as marks: lines on the same display that touch (or nearly do) are one mark. */
export function marksOf(drawing) {
  const groups = [];
  for (const stroke of drawing.strokes.filter(s => s.points?.length)) {
    const b = grow(box(stroke.points), 24);
    const display = stroke.display?.id ?? 0;
    const near = groups.filter(g => g.display === display && meet(g.box, b));
    const merged = { display, displayBounds: stroke.display, box: b, strokes: [stroke] };
    for (const g of near) { merged.box = union(merged.box, g.box); merged.strokes.unshift(...g.strokes); groups.splice(groups.indexOf(g), 1); }
    groups.push(merged);
  }
  return groups
    .sort((a, b) => Math.min(...a.strokes.map(s => s.at || 0)) - Math.min(...b.strokes.map(s => s.at || 0)))
    .map((g, i) => ({ n: i + 1, display: g.display, displayBounds: g.displayBounds, bounds: round(box(g.strokes.flatMap(s => s.points))), lines: g.strokes.length, ...shapeOf(g.strokes) }));
}

/** What is under a point: the window (skipping Handry's own layers) and the control of that app there. */
async function under([x, y]) {
  const win = await desktop.windowAt(x, y).catch(() => ({ found: false }));
  if (!win.found) return { window: null, control: null };
  const control = win.pid ? await desktop.controlAt(x, y, win.pid).catch(() => null) : null;
  return { window: { app: win.app, bundleId: win.bundleId, title: win.title, id: win.id, bounds: { x: win.x, y: win.y, w: win.w, h: win.h } }, control: control?.found ? control : null };
}

/** A PNG of part of the screen. without: the app to leave out (Handry: then the lines aren't in it). */
async function grab(rect, file, { without } = {}) {
  const r = round(rect);
  const fake = process.env.JEVIS_TEST_MARKS_IMAGE;
  if (fake) {
    // tests: a picture of the right size instead of the screen
    fs.copyFileSync(fake, file);
    await run('sips', ['-z', String(r.h * 2), String(r.w * 2), file]);
    return { file, w: r.w * 2, h: r.h * 2, clean: Boolean(without) };
  }
  try {
    const out = await desktop.capture(r, file, { without });
    return { file, w: out.w, h: out.h, clean: Boolean(without) };
  } catch (err) {
    if (err.code !== 'UNSUPPORTED') throw err;
    if (without) return null; // macOS 13: no way to leave Handry out
    await run('screencapture', ['-x', '-t', 'png', `-R${r.x},${r.y},${r.w},${r.h}`, file]);
    const { stdout } = await run('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file]);
    return { file, w: Number(stdout.match(/pixelWidth: (\d+)/)?.[1]), h: Number(stdout.match(/pixelHeight: (\d+)/)?.[1]), clean: false };
  }
}

/** A JPEG for the model, at most `width` wide; returns its size. */
async function forModel(png, width) {
  const jpg = png.replace(/\.png$/, '.jpg');
  await run('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '80', '-Z', String(width), png, '--out', jpg]);
  const { stdout } = await run('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', jpg]);
  return { file: jpg, w: Number(stdout.match(/pixelWidth: (\d+)/)?.[1]), h: Number(stdout.match(/pixelHeight: (\d+)/)?.[1]) };
}

const clamp = (r, to) => {
  const x = Math.max(r.x, to.x), y = Math.max(r.y, to.y);
  return { x, y, w: Math.max(1, Math.min(r.x + r.w, to.x + to.w) - x), h: Math.max(1, Math.min(r.y + r.h, to.y + to.h) - y) };
};
const toImage = (b, area, image) => {
  const k = image.w / area.w;
  return { x: Math.round((b.x - area.x) * k), y: Math.round((b.y - area.y) * k), w: Math.round(b.w * k), h: Math.round(b.h * k) };
};

function keepLast() {
  const old = fs.readdirSync(dir(), { withFileTypes: true }).filter(d => d.isDirectory() && /^m\d+/.test(d.name))
    .map(d => ({ name: d.name, at: fs.statSync(path.join(dir(), d.name)).mtimeMs })).sort((a, b) => b.at - a.at).slice(KEEP);
  for (const d of old) fs.rmSync(path.join(dir(), d.name), { recursive: true, force: true });
}

/**
 * Everything about the last drawing, with pictures: for each display it is on, the screen (or the one window all
 * its marks are in) with the lines and the same place without them, then a close-up of each mark.
 * Returns { drawing, marks, question, areas, closeUps, saved } (files under ~/.jevis/marks/<id>/).
 */
export async function inspect({ pictures = true } = {}) {
  const drawing = current();
  if (!drawing) return null;
  const marks = marksOf(drawing);
  for (const m of marks) Object.assign(m, await under(m.probe));
  const out = path.join(homeDir('marks'), drawing.id);
  fs.mkdirSync(out, { recursive: true });
  const areas = [];
  const closeUps = [];
  if (pictures) {
    for (const display of [...new Set(marks.map(m => m.display))]) {
      const on = marks.filter(m => m.display === display);
      const bounds = on[0].displayBounds || on[0].window?.bounds;
      // one window holds all the marks: just that window (easier to read than the whole screen)
      const ids = new Set(on.map(m => m.window?.id));
      const win = ids.size === 1 && on[0].window ? on[0].window.bounds : null;
      const area = round(win && bounds ? clamp(win, bounds) : bounds);
      const tag = `display-${areas.length + 1}`;
      const marked = await grab(area, path.join(out, `${tag}-marked.png`));
      const clean = await grab(area, path.join(out, `${tag}-clean.png`), { without: APP_NAME });
      const markedJpg = await forModel(marked.file, IMAGE_WIDTH);
      const cleanJpg = clean ? await forModel(clean.file, IMAGE_WIDTH) : null;
      for (const m of on) {
        m.inImage = { area: areas.length + 1, ...toImage(m.bounds, area, markedJpg) };
        m.probeInImage = toImage({ x: m.probe[0], y: m.probe[1], w: 0, h: 0 }, area, markedJpg);
      }
      areas.push({ n: areas.length + 1, display, area, window: win ? on[0].window : null, marked: markedJpg, clean: cleanJpg });
    }
    for (const m of marks.slice(0, MAX_CLOSE_UPS)) {
      const display = m.displayBounds || areas[0].area;
      const r = clamp(grow(m.bounds, Math.max(40, 0.35 * Math.max(m.bounds.w, m.bounds.h))), display);
      const cut = { x: r.x, y: r.y, w: Math.max(r.w, 160), h: Math.max(r.h, 110) };
      const shot = await grab(clamp(cut, display), path.join(out, `mark-${m.n}.png`));
      closeUps.push({ n: m.n, ...(await forModel(shot.file, CLOSE_UP)) });
    }
    // Like a desktop_screenshot: screen_draw and desktop_click_at take this picture's pixels.
    const first = areas[0];
    saveState({ shot: { at: Date.now(), app: first.window?.app || T('ekran', 'screen'), pid: null, windowId: null, area: first.area, image: { w: first.marked.w, h: first.marked.h } } });
  }
  const question = questionFor(drawing.id);
  const info = { id: drawing.id, at: drawing.at, active: Boolean(drawing.active), question, marks: marks.map(({ displayBounds, ...m }) => m), areas: areas.map(a => ({ ...a, marked: a.marked.file, clean: a.clean?.file || null })) };
  fs.writeFileSync(path.join(out, 'info.json'), JSON.stringify(info, null, 2));
  keepLast();
  return { drawing, marks, question, areas, closeUps, saved: out };
}

const KIND = () => T({ circle: 'daire', underline: 'alt çizgi', line: 'çizgi/ok', dot: 'nokta', scribble: 'karalama' }, { circle: 'circle', underline: 'underline', line: 'line/arrow', dot: 'dot', scribble: 'scribble' });

/** The text screen_marks returns, next to the pictures. */
export function describe(r) {
  const when = new Date(r.drawing.at).toLocaleTimeString(T('tr-TR', 'en-US'), { hour: '2-digit', minute: '2-digit' });
  const lines = [T(`Kullanıcının son çizimi (${when}, ${r.marks.length} işaret${r.drawing.active ? ', kalem hâlâ açık' : ''}). Çizgiler ${PEN_COLOR} renginde.`,
    `The user's last drawing (${when}, ${r.marks.length} ${r.marks.length === 1 ? 'mark' : 'marks'}${r.drawing.active ? ', the pen is still on' : ''}). Their lines are ${PEN_COLOR}.`)];
  lines.push(r.question ? T(`Soru: "${r.question.text}"`, `Question: "${r.question.text}"`) : T('Soru yazılmamış; kullanıcının sana söylediğine göre cevap ver.', 'No question was written with it; go by what the user told you.'));
  let picture = 1;
  const pics = [];
  for (const a of r.areas) {
    pics.push(T(`${picture}. çizgili ${a.window ? `"${a.window.app}" penceresi` : `ekran ${a.n}`} (${a.marked.w}×${a.marked.h} piksel)`, `${picture}. with the lines: ${a.window ? `the "${a.window.app}" window` : `display ${a.n}`} (${a.marked.w}×${a.marked.h} pixels)`));
    picture++;
    if (a.clean) { pics.push(T(`${picture}. aynı yer çizgisiz`, `${picture}. the same place without the lines`)); picture++; }
  }
  const closeUpAt = Object.fromEntries(r.closeUps.map(c => [c.n, picture++]));
  for (const m of r.marks) {
    const where = m.window ? `${m.window.app}${m.window.title ? ` — "${m.window.title}"` : ''}` : T('bilinmiyor', 'unknown');
    const control = m.control ? `${m.control.role}${m.control.name ? ` "${m.control.name}"` : ''}${m.control.value ? ` = "${m.control.value}"` : ''}` : T('kontrol bulunamadı (uygulama kendini çiziyor olabilir; resme bak)', 'no control found (the app may draw itself; look at the picture)');
    lines.push(T(`${m.n}. ${KIND()[m.kind]}: ekranda x ${m.bounds.x}, y ${m.bounds.y}, ${m.bounds.w}×${m.bounds.h} nokta${m.inImage ? `; ${m.inImage.area}. alanın resminde x ${m.inImage.x}, y ${m.inImage.y}, ${m.inImage.w}×${m.inImage.h} piksel` : ''}. Altında: ${where}; ${control}.${closeUpAt[m.n] ? ` Yakını: ${closeUpAt[m.n]}. resim.` : ''}`,
      `${m.n}. ${KIND()[m.kind]}: on screen x ${m.bounds.x}, y ${m.bounds.y}, ${m.bounds.w}×${m.bounds.h} points${m.inImage ? `; in picture ${m.inImage.area} at x ${m.inImage.x}, y ${m.inImage.y}, ${m.inImage.w}×${m.inImage.h} pixels` : ''}. Under it: ${where}; ${control}.${closeUpAt[m.n] ? ` Close-up: picture ${closeUpAt[m.n]}.` : ''}`));
  }
  if (pics.length) lines.push(T(`Resimler: ${pics.join('; ')}; sonra işaretlerin yakınları. screen_draw ve desktop_click_at x/y için 1. resmin piksellerini kullanır.`, `Pictures: ${pics.join('; ')}; then the close-ups of the marks. screen_draw and desktop_click_at take x/y in the pixels of picture 1.`));
  if (Date.now() - r.drawing.at > 30 * 60 * 1000) lines.push(T('Bu çizim yarım saatten eski; ekran o zamandan beri değişmiş olabilir.', 'This drawing is more than half an hour old; the screen may have changed since.'));
  lines.push(T(`Kaydedildi: ${r.saved}`, `Saved in: ${r.saved}`));
  return lines.join('\n');
}

/** An earlier drawing from ~/.jevis/marks (1 = the one before the last): its saved notes and pictures, nothing new taken. */
export function previous(n = 1) {
  const all = fs.existsSync(dir()) ? fs.readdirSync(dir(), { withFileTypes: true }).filter(d => d.isDirectory() && /^m\d+/.test(d.name))
    .map(d => path.join(dir(), d.name)).filter(d => fs.existsSync(path.join(d, 'info.json'))).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs) : [];
  const pick = all[n];
  if (!pick) throw new JevisError('NOT_FOUND', T('O kadar eski bir çizim kayıtlı değil.', "No drawing that old is saved."));
  return readJson(path.join(pick, 'info.json'));
}

/** Claude Code sessions in VS Code that a question can be sent on to. */
export async function targets() {
  const { claudeSessions } = await import('./claude-sessions.js');
  return claudeSessions().filter(s => !s.jevis && s.where === 'VS Code').map(s => ({ id: s.sessionId, name: s.name, project: s.project, state: s.state }));
}

/** Sends the question with the drawing on to an open Claude Code session in VS Code. */
export async function forward(session, question) {
  if (!current()) throw new JevisError('NO_DRAWING', T('Ekranda çizim yok.', 'There is no drawing on the screen.'));
  setQuestion(question, `claude:${session}`);
  const { sendToSession } = await import('./vscode-claude.js');
  return sendToSession({ session, text: forwardText(question) });
}

export const noDrawing = () => T(`Ekranda kullanıcının çizimi yok. Kullanıcı ${APP_NAME} › Kalem (⌥⇧P), çentikteki kalem ya da çubuktaki ✏️ ile çizebilir.`,
  `There is no drawing by the user on the screen. They can draw with ${APP_NAME} › Pen (⌥⇧P), the pen at the notch, or ✏️ in the bar.`);
