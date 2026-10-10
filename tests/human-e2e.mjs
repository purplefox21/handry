// Does JEVIS move and type like a person? Real Chrome in its own profile and
// port (the JEVIS Chrome you use is not touched); a page records every mouse
// and key event, and the test checks what a site would see: a curved, gradual
// pointer path, a held click, wheel ticks for scrolling, one key event per
// character instead of a value that appears at once.
// Usage: node tests/human-e2e.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'jevis-human-'));
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ browser: { cdpPort: 9477, profileDir: path.join(home, 'chrome-profile') } }));
process.env.JEVIS_HOME = home;
delete process.env.JEVIS_HUMAN;
process.env.JEVIS_TEST_CONFIRM = 'allow';
const b = await import('../hands/browser.js');
const human = await import('../hands/human.js');

const FIXTURE = new URL('./fixtures/human-probe.html', import.meta.url).href;
const dom = async fn => (await b.activePage()).evaluate(fn);
const events = () => dom(() => window.__ev);
const clear = () => dom(() => { window.__ev.length = 0; window.__clicked.length = 0; });

let passed = 0, total = 0;
async function check(name, fn) {
  total++;
  const started = Date.now();
  let ok = false, note = '';
  try { const r = await fn(); ok = Boolean(r?.ok ?? r); note = r?.note || ''; } catch (err) { note = err.stack?.split('\n').slice(0, 2).join(' ') || err.message; }
  if (ok) passed++;
  console.log(`${ok ? '✅' : '❌'} ${String(Date.now() - started).padStart(6)} ms  ${name}${note ? `\n          → ${note}` : ''}`);
}

try {
  await b.open(FIXTURE);
  const listing = b.formatRead(await b.read({ text: false }), { all: true });
  const id = word => {
    const line = listing.split('\n').find(l => new RegExp(word, 'i').test(l) && /^#\d+/.test(l));
    return line ? line.match(/^#(\d+)/)[0] : word;
  };

  await check('E-posta: harf harf yazılıyor (her karakter için tuş olayı)', async () => {
    await clear();
    const text = 'Bora.Test@example.com';
    const t = Date.now();
    await b.type(id('Email'), text);
    const took = Date.now() - t;
    const ev = await events();
    const downs = ev.filter(e => e.t === 'keydown' && e.k.length === 1 || e.k === 'Shift').length;
    const inputs = ev.filter(e => e.t === 'input').length;
    const value = await dom(() => document.getElementById('email').value);
    return { ok: value === text && inputs >= text.length && ev.filter(e => e.t === 'keydown').length >= text.length && took > text.length * 50, note: `değer ${value === text ? 'doğru' : value}, ${inputs} input, ${ev.filter(e => e.t === 'keydown').length} tuş, ${took} ms` };
  });

  await check('Büyük harf ve simge Shift ile yazılıyor, tuş kodları gerçek', async () => {
    const ev = await events();
    const shiftDowns = ev.filter(e => e.t === 'keydown' && e.k === 'Shift').length;
    const code = ev.find(e => e.t === 'keydown' && e.k === 'B')?.code;
    return { ok: shiftDowns >= 1 && code === 'KeyB' && ev.every(e => e.trusted), note: `Shift ${shiftDowns}, B → ${code}` };
  });

  await check('Parola (fillHidden): harf harf, değer doğru', async () => {
    await clear();
    const pw = 'Tr0ub4dor&3';
    await b.fillHidden(id('Password'), pw);
    const ev = await events();
    const value = await dom(() => document.getElementById('password').value);
    return { ok: value === pw && ev.filter(e => e.t === 'input').length >= pw.length, note: `${ev.filter(e => e.t === 'input').length} input olayı` };
  });

  await check('Eski içerik seçilip yerine yazılıyor', async () => {
    await b.type(id('Email'), 'a@b.co');
    return dom(() => document.getElementById('email').value === 'a@b.co');
  });

  await check('Tıklama: eğri yol, ışınlanma yok, tuş basılı kalıyor', async () => {
    await clear();
    const r = await b.click(id('Continue'));
    const ev = await events();
    const moves = ev.filter(e => e.t === 'mousemove');
    const down = ev.find(e => e.t === 'mousedown'), up = ev.find(e => e.t === 'mouseup');
    let maxStep = 0, maxBow = 0;
    for (let i = 1; i < moves.length; i++) maxStep = Math.max(maxStep, Math.hypot(moves[i].x - moves[i - 1].x, moves[i].y - moves[i - 1].y));
    if (moves.length > 2) {
      const a = moves[0], z = moves[moves.length - 1], len = Math.hypot(z.x - a.x, z.y - a.y) || 1;
      for (const m of moves) maxBow = Math.max(maxBow, Math.abs((z.x - a.x) * (a.y - m.y) - (a.x - m.x) * (z.y - a.y)) / len);
    }
    const clicked = await dom(() => window.__clicked);
    const hold = up && down ? up.at - down.at : 0;
    return { ok: clicked.join() === 'go' && moves.length >= 10 && maxStep < 90 && maxBow > 1 && hold >= 40, note: `${moves.length} fare olayı, en büyük sıçrama ${Math.round(maxStep)} px, eğrilik ${maxBow.toFixed(1)} px, basılı kalma ${hold} ms` };
  });

  await check('Sayfanın altındaki düğme: tekerlekle kayıp tıklanıyor', async () => {
    await clear();
    await b.click(id('Far away'));
    const ev = await events();
    const wheels = ev.filter(e => e.t === 'wheel').length;
    const clicked = await dom(() => window.__clicked);
    return { ok: clicked.join() === 'far' && wheels >= 5, note: `${wheels} tekerlek olayı` };
  });

  await check('Toplu doldurma yolu (fast) hızlı kalıyor: tek input olayı', async () => {
    await clear();
    await b.type(id('Email'), 'hizli@ornek.com', { fast: true });
    const ev = await events();
    return { ok: ev.filter(e => e.t === 'input').length === 1 && (await dom(() => document.getElementById('email').value)) === 'hizli@ornek.com', note: `${ev.filter(e => e.t === 'input').length} input olayı` };
  });

  await check('JEVIS_HUMAN=0 eski hızlı davranışa döner', async () => {
    process.env.JEVIS_HUMAN = '0';
    try {
      await clear();
      await b.type(id('Email'), 'kapali@ornek.com');
      const ev = await events();
      return { ok: ev.filter(e => e.t === 'input').length === 1 && !human.humanOn(), note: `${ev.filter(e => e.t === 'input').length} input olayı` };
    } finally { delete process.env.JEVIS_HUMAN; }
  });

  await check('Uzun metin (>120 karakter) tek seferde giriyor', async () => {
    await clear();
    const long = 'Uzun metin '.repeat(20);
    await b.type(id('Email'), long);
    const ev = await events();
    return { ok: ev.filter(e => e.t === 'input').length === 1, note: `${ev.filter(e => e.t === 'input').length} input olayı` };
  });
} finally {
  console.log(`\n${passed}/${total}`);
  try { (await b.activePage()).context().browser()?.close().catch(() => {}); } catch {}
  await new Promise(r => setTimeout(r, 300));
  try { const { execSync } = await import('node:child_process'); execSync(`pkill -f "user-data-dir=${home}" || true`); } catch {}
  fs.rmSync(home, { recursive: true, force: true });
  process.exit(passed === total ? 0 : 1);
}
