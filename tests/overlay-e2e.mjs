// Handry · © 2026 Berat Olekli (purplefox) · github.com/purplefox21/handry
// Drawing on the screen (screen_draw), checked without drawing on the real
// screen: a throwaway Handry folder, so the app's ~/.jevis/overlay.json is
// never touched. Checks: the color that stands out on a background; a drawing
// written with its place, shape, note, color and time, and cleared; a Mac
// app's control placed where the accessibility tree says; a web page element
// placed where it really is on the screen (the button is bright green; a
// screenshot of the computed place must be green: page math checked by pixels,
// in a Chrome with its own profile and port); a point of a
// screenshot; and, while a risky click waits for an answer, the button circled
// and the circle gone after the answer.
// Usage: node tests/overlay-e2e.mjs   (opens Calculator and a test Chrome; closes both)
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'handry-overlay-'));
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ browser: { cdpPort: 9491, profileDir: path.join(home, 'chrome-profile') } }));
process.env.JEVIS_HOME = home;
process.env.JEVIS_TEST_CONFIRM = 'allow';
const overlayLog = path.join(home, 'overlay.log');
process.env.JEVIS_TEST_OVERLAY_LOG = overlayLog;
delete process.env.JEVIS_HUMAN;
const overlay = await import('../hands/overlay.js');
const desktop = await import('../hands/desktop.js');
const b = await import('../hands/browser.js');
const { callTool } = await import('../core/tools.js');
const call = async (name, args) => {
  const r = await callTool(name, args);
  return { ...r, text: r.content.filter(c => c.type === 'text').map(c => c.text).join('\n') };
};
const shown = () => { try { return JSON.parse(fs.readFileSync(path.join(home, 'overlay.json'), 'utf-8')).shapes; } catch { return []; } };
const near = (a, c, px = 6) => ['x', 'y', 'w', 'h'].every(k => Math.abs(a[k] - c[k]) <= px);

let passed = 0, total = 0;
async function check(name, fn) {
  total++;
  const started = Date.now();
  let ok = false, note = '';
  try { const r = await fn(); ok = r && typeof r === 'object' && 'ok' in r ? Boolean(r.ok) : Boolean(r); note = r?.note || ''; } catch (err) { note = err.stack?.split('\n').slice(0, 2).join(' ') || err.message; }
  if (ok) passed++;
  console.log(`${ok ? '✅' : '❌'} ${String(Date.now() - started).padStart(6)} ms  ${name}${note ? `\n          → ${note}` : ''}`);
}

const PAGE = `<!doctype html><meta charset="utf-8"><title>Çizim testi</title>
<div style="height:260px"></div><button style="margin-left:300px;font-size:20px;padding:10px 24px;background:#00c853;color:#00c853;border:none">Publish</button>
<script>window.clicks = 0; document.querySelector('button').onclick = () => clicks++</script>`;
const server = http.createServer((_, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(PAGE); });
await new Promise(r => server.listen(0, '127.0.0.1', r));

try {
  await check('Renk zemine göre seçiliyor (turuncuya mavi, beyaza mor, koyuya sarı)', () => {
    const name = hex => Object.entries(overlay.PALETTE).find(([, v]) => v === hex)?.[0];
    const got = [[255, 149, 0], [250, 250, 250], [30, 30, 30]].map(bg => name(overlay.bestColor(bg)));
    return { ok: got.join() === 'blue,violet,yellow', note: got.join(', ') };
  });

  await check('Çizim yeriyle, şekliyle, notuyla, rengiyle ve süresiyle yazılıyor; temizlenince gidiyor', async () => {
    process.env.JEVIS_TEST_OVERLAY_BG = JSON.stringify([255, 149, 0]);
    const id = await overlay.draw({ shape: 'circle', rect: { x: 10.4, y: 20.6, w: 30, h: 40 }, note: 'burada', seconds: 5 });
    delete process.env.JEVIS_TEST_OVERLAY_BG;
    const s = shown().find(x => x.id === id);
    // the app counts the seconds from when it shows the drawing; the file keeps it a little longer
    const good = s && s.kind === 'circle' && s.text === 'burada' && s.color === overlay.PALETTE.blue && s.rect.x === 10 && s.rect.y === 21
      && s.seconds === 5 && s.until > Date.now() + 5000 && s.until < Date.now() + 9000;
    overlay.clear(id);
    return { ok: good && !shown().some(x => x.id === id), note: JSON.stringify(s) };
  });

  await check('Sıra sıra: adımlar tek grupta, sıralı, notları numaralı', async () => {
    process.env.JEVIS_TEST_OVERLAY_BG = JSON.stringify([30, 30, 30]);
    const ids = await overlay.drawSteps([
      { shape: 'arrow', rect: { x: 10, y: 10, w: 20, h: 20 }, note: 'önce bu' },
      { shape: 'circle', rect: { x: 50, y: 10, w: 20, h: 20 }, note: 'sonra bu' },
      { shape: 'box', rect: { x: 90, y: 10, w: 20, h: 20 } }
    ], { seconds: 3 });
    delete process.env.JEVIS_TEST_OVERLAY_BG;
    const steps = shown().filter(x => ids.includes(x.id));
    const ok = steps.length === 3 && new Set(steps.map(x => x.group)).size === 1 && steps.map(x => x.order).join() === '0,1,2'
      && steps.map(x => x.text).join('|') === '1. önce bu|2. sonra bu|3.' && steps.every(x => x.seconds === 3 && x.color === overlay.PALETTE.yellow);
    overlay.clear();
    return { ok, note: steps.map(x => `${x.order}:${x.text}`).join(' ') };
  });

  await check('Mac uygulamasındaki düğme erişilebilirlik ağacının dediği yere çiziliyor', async () => {
    await call('desktop_open_app', { name: 'Hesap Makinesi' });
    const r = await call('screen_draw', { desktop: 'Eşittir', app: 'Hesap Makinesi', shape: 'arrow', note: 'buraya bas' });
    const el = (await desktop.read({ app: 'Hesap Makinesi', remember: false })).elements.find(e => e.name === 'Eşittir');
    const s = shown().at(-1);
    return { ok: !r.isError && el && near(s.rect, { x: el.x, y: el.y, w: el.w, h: el.h }, 1) && s.kind === 'arrow', note: `${JSON.stringify(s?.rect)} / AX ${el && JSON.stringify({ x: el.x, y: el.y, w: el.w, h: el.h })}` };
  });

  await check('Ekran görüntüsündeki nokta ekrana çevriliyor', async () => {
    const shot = await desktop.screenshot({ app: 'Hesap Makinesi' });
    const r = await call('screen_draw', { x: Math.round(shot.width / 2), y: Math.round(shot.height / 2), shape: 'circle' });
    const s = shown().at(-1);
    const f = await desktop.frontmost();
    const cx = s.rect.x + s.rect.w / 2, cy = s.rect.y + s.rect.h / 2;
    const inside = cx > f.bounds.X && cx < f.bounds.X + f.bounds.Width && cy > f.bounds.Y && cy < f.bounds.Y + f.bounds.Height;
    return { ok: !r.isError && inside, note: `merkez (${cx}, ${cy}), pencere ${JSON.stringify(f.bounds)}` };
  });
  await call('desktop_quit_app', { name: 'Hesap Makinesi' });

  // a web page in a Chrome of its own
  await b.open(`http://127.0.0.1:${server.address().port}/`);
  const pid = b.profileChromePids()[0];
  await check('Web sayfasındaki düğme ekranda gerçekten olduğu yere çiziliyor (oradaki pikseller yeşil)', async () => {
    const r = await call('screen_draw', { browser: 'Publish', shape: 'box' });
    const s = shown().at(-1);
    await new Promise(res => setTimeout(res, 400));
    // a screenshot of the computed place, a few points inside its edges: the button's green, nothing else
    const avg = await overlay.backgroundOf(s.rect, -5);
    const green = avg && avg[1] > 150 && avg[0] < 60 && avg[2] < 130;
    return { ok: !r.isError && Boolean(green), note: `yer ${JSON.stringify(s?.rect)}, oradaki ortalama renk ${avg && avg.map(Math.round).join(',')}` };
  });

  await check('Riskli tıklama onay beklerken düğme daire içinde, cevaptan sonra daire yok', async () => {
    fs.rmSync(overlayLog, { force: true });
    process.env.JEVIS_TEST_CONFIRM = 'deny';
    const r = await call('browser_click', { target: 'Publish' });
    process.env.JEVIS_TEST_CONFIRM = 'allow';
    const states = fs.readFileSync(overlayLog, 'utf-8').trim().split('\n').map(l => JSON.parse(l));
    const during = states.find(st => st.some(x => x.kind === 'circle' && x.text === 'Buna basmak istiyorum'));
    const after = states.at(-1);
    return { ok: r.isError && /izin vermedi/.test(r.text) && during && !after.some(x => x.text === 'Buna basmak istiyorum'), note: `${states.length} durum` };
  });

  await check('clear: true her şeyi siliyor', async () => {
    const r = await call('screen_draw', { clear: true });
    return { ok: !r.isError && shown().length === 0 };
  });
} finally {
  server.close();
  await b.closeChrome().catch(() => {});
  fs.rmSync(home, { recursive: true, force: true });
}

console.log(`\n${passed}/${total} geçti`);
process.exit(passed === total ? 0 : 1);
