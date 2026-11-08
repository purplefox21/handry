// Handry · © 2026 Berat Olekli (purplefox) · github.com/purplefox21/handry
// The pen (Kalem) on the Claude side: screen_marks reads the user's drawing. Nothing is drawn on the real
// screen: the lines are written to a throwaway Handry folder, the way Handry.app writes them, and the pictures
// are stand-ins (JEVIS_TEST_MARKS_IMAGE). What is under the lines is real: Calculator is opened and its "7" is
// circled, and the tool has to name the app, the window and the button. Calculator is closed again.
// Usage: node tests/marks-e2e.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'handry-marks-'));
process.env.JEVIS_HOME = home;
process.env.JEVIS_LANG = 'tr';
process.env.JEVIS_NO_CHAT = '1';
process.env.JEVIS_TEST_MARKS_IMAGE = path.join(ROOT, 'app', 'public', 'icon.png');
const marks = await import('../hands/marks.js');
const desktop = await import('../hands/desktop.js');
const { callTool, TOOLS, INSTRUCTIONS } = await import('../core/tools.js');
const { loadState } = await import('../core/config.js');
const call = async (name, args = {}) => {
  const r = await callTool(name, args);
  return { ...r, text: r.content.filter(c => c.type === 'text').map(c => c.text).join('\n'), images: r.content.filter(c => c.type === 'image').length };
};

let passed = 0, total = 0;
async function check(name, fn) {
  total++;
  let ok = false, note = '';
  try { const r = await fn(); ok = r && typeof r === 'object' && 'ok' in r ? Boolean(r.ok) : Boolean(r); note = r?.note || ''; } catch (err) { note = err.stack?.split('\n').slice(0, 2).join(' ') || err.message; }
  if (ok) passed++;
  console.log(`${ok ? '✅' : '❌'} ${name}${note ? `\n     → ${note}` : ''}`);
}

const DISPLAY = { id: 1, x: 0, y: 0, w: 1512, h: 982, scale: 2 };
const ring = (cx, cy, rx, ry, turns = 1.08, n = 48) => Array.from({ length: n }, (_, i) => [cx + rx * Math.cos((i / (n - 1)) * turns * 2 * Math.PI), cy + ry * Math.sin((i / (n - 1)) * turns * 2 * Math.PI)]);
const write = (strokes, extra = {}) => {
  fs.mkdirSync(path.join(home, 'marks'), { recursive: true });
  const drawing = { id: `m${Date.now()}${Math.floor(Math.random() * 1000)}`, startedAt: Date.now(), at: Date.now(), active: false, color: '#C6FF00', strokes: strokes.map((points, i) => ({ display: DISPLAY, at: i + 1, points })), ...extra };
  fs.writeFileSync(path.join(home, 'marks', 'current.json'), JSON.stringify(drawing));
  return drawing;
};

try {
  await check('no drawing: the tool says so and how to draw', async () => {
    const r = await call('screen_marks');
    return { ok: /çizimi yok/.test(r.text) && /⌥⇧P/.test(r.text) && r.images === 0, note: r.text.slice(0, 90) };
  });

  await check('a circle, an underline, an arrow (one stroke and two), a dot, a scribble', () => {
    const d = write([
      ring(300, 300, 60, 40),
      [[100, 700], [250, 703], [420, 702]],
      [[600, 600], [700, 500], [800, 400], [780, 395], [800, 400], [795, 425]],
      [[1000, 800], [1100, 700], [1200, 600]], [[1170, 598], [1200, 600], [1195, 630]],
      [[1400, 100], [1402, 101]],
      [[900, 150], [960, 210]], [[905, 210], [955, 150]]
    ]);
    const kinds = marks.marksOf(d).map(m => `${m.kind}@${m.probe.map(Math.round).join(',')}`);
    const want = ['circle@300,300', 'underline@260,688', 'line@800,400', 'line@1200,600', 'dot@1401,101', 'scribble@930,180'];
    return { ok: JSON.stringify(kinds) === JSON.stringify(want), note: kinds.join(' ') };
  });

  await check('lines that touch are one mark; lines on another display are not', () => {
    const other = { ...DISPLAY, id: 2, x: 1512 };
    const d = { id: 'm1', at: Date.now(), strokes: [{ display: DISPLAY, at: 1, points: [[100, 100], [200, 100]] }, { display: DISPLAY, at: 2, points: [[205, 110], [300, 110]] }, { display: other, at: 3, points: [[1600, 100], [1700, 100]] }] };
    const m = marks.marksOf(d);
    return { ok: m.length === 2 && m[0].lines === 2 && m[1].display === 2, note: m.map(x => `${x.n}:${x.lines}@${x.display}`).join(' ') };
  });

  await check('the text sent on to a Claude session carries the question and asks for screen_marks', () => {
    const t = marks.forwardText('bu ne?');
    return /"bu ne\?"/.test(t) && /screen_marks/.test(t);
  });

  await check('Claude is told about the pen, and the tool is listed', () => INSTRUCTIONS.includes('screen_marks first') && TOOLS.some(t => t.name === 'screen_marks'));

  // The real thing under the lines: Calculator's "7".
  await call('desktop_open_app', { name: 'Hesap Makinesi' });
  await new Promise(r => setTimeout(r, 800));
  const seven = (await desktop.read({ app: 'Hesap Makinesi', remember: false })).elements.find(e => e.name === '7');
  const { displays = [] } = await import('../hands/desktop.js').then(d => d.spaces()).then(list => ({ displays: list.map(x => x.bounds) })).catch(() => ({}));
  const center = seven ? [seven.x + seven.w / 2, seven.y + seven.h / 2] : [0, 0];
  const on = displays.find(b => center[0] >= b.x && center[0] < b.x + b.w && center[1] >= b.y && center[1] < b.y + b.h) || DISPLAY;
  Object.assign(DISPLAY, { x: on.x, y: on.y, w: on.w, h: on.h });

  await check('circling Calculator\'s 7: the app, the window and the button are named', async () => {
    if (!seven) return { ok: false, note: '7 bulunamadı' };
    const d = write([ring(center[0], center[1], seven.w * 0.75, seven.h * 0.75)]);
    marks.setQuestion('bu ne?', 'bar', d.id);
    const r = await call('screen_marks');
    const named = /Hesap Makinesi|Calculator/.test(r.text) && /"7"/.test(r.text) && /daire/.test(r.text) && /Soru: "bu ne\?"/.test(r.text);
    return { ok: named && r.images === 3, note: `${r.images} resim · ${r.text.split('\n').find(l => /^1\./.test(l))?.slice(0, 150)}` };
  });

  await check('screen_draw and desktop_click_at take the pixels of its first picture', () => {
    const shot = loadState().shot;
    const p = desktop.shotToScreen(shot.image.w / 2, shot.image.h / 2);
    const want = { x: shot.area.x + shot.area.w / 2, y: shot.area.y + shot.area.h / 2 };
    return { ok: Math.abs(p.x - want.x) <= 1 && Math.abs(p.y - want.y) <= 1, note: `${JSON.stringify(shot.area)} ${shot.image.w}×${shot.image.h}` };
  });

  await check('the drawing is kept in ~/.jevis/marks/<id> (notes and pictures)', () => {
    const id = JSON.parse(fs.readFileSync(path.join(home, 'marks', 'current.json'), 'utf-8')).id;
    const files = fs.readdirSync(path.join(home, 'marks', id));
    return { ok: files.includes('info.json') && files.some(f => f.endsWith('-marked.jpg')) && files.some(f => f.endsWith('-clean.jpg')) && files.includes('mark-1.jpg'), note: files.join(' ') };
  });

  await check('an earlier drawing can be read back (previous: 1)', async () => {
    write([[[200, 200], [400, 205]]]);
    await call('screen_marks');
    const r = await call('screen_marks', { previous: 1 });
    return { ok: /"7"/.test(r.text) && r.images >= 1, note: `${r.images} resim` };
  });

  await check('only the last ten drawings are kept', async () => {
    for (let i = 0; i < 11; i++) { write([[[100 + i, 100], [300, 100 + i]]]); await marks.inspect({ pictures: false }); }
    const dirs = fs.readdirSync(path.join(home, 'marks'), { withFileTypes: true }).filter(d => d.isDirectory());
    return { ok: dirs.length === 10, note: `${dirs.length} klasör` };
  });

  await check('a question about the drawing goes to the brain, past the fast path, which is told to look first', async () => {
    write([ring(500, 400, 40, 30)]);
    const { runCommand } = await import('../core/runner.js');
    let got = '';
    const brain = { id: 'fake', label: 'fake', run: async ({ text }) => { got = text; return { text: 'tamam' }; } };
    await runCommand({ text: 'sesi kıs', marks: true, brainOverride: brain, source: 'bar', chat: false });
    const q = JSON.parse(fs.readFileSync(path.join(home, 'marks', 'question.json'), 'utf-8'));
    return { ok: /screen_marks/.test(got) && got.startsWith('sesi kıs') && q.text === 'sesi kıs', note: got.split('\n')[0] };
  });

  await check('a cleared drawing is no drawing', async () => {
    write([]);
    const r = await call('screen_marks');
    return /çizimi yok/.test(r.text);
  });
} finally {
  await call('desktop_quit_app', { name: 'Hesap Makinesi' }).catch(() => {});
  fs.rmSync(home, { recursive: true, force: true });
}

console.log(`\n${passed}/${total} geçti`);
process.exit(passed === total ? 0 : 1);
