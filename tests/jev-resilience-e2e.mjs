// Handry · © 2026 Berat Olekli (purplefox) · github.com/purplefox21/handry
// When Jev is busy or unreachable: calls are tried again with a growing wait (and
// a Retry-After is honoured up to 3 s), then fail as JEV_DOWN; a bad request
// fails at once as JEV_ERROR; the fast path hands the command to the brain
// instead of failing it. Uses a local stand-in for the Jev API (JEVIS_JEV_URL),
// a throwaway Handry folder and a fake brain: no Jev tokens, no Claude.
// Usage: node tests/jev-resilience-e2e.mjs
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';

let mode = 'ok';
let hits = [];
const server = http.createServer((req, res) => {
  hits.push(Date.now());
  req.resume();
  req.on('end', () => {
    const busy = () => { res.writeHead(529, { 'content-type': 'application/json' }); res.end('{"detail":{"error_type":"system_overloaded"}}'); };
    if (mode === 'busy') return busy();
    if (mode === 'busy-once' && hits.length === 1) return busy();
    if (mode === 'retry-after' && hits.length === 1) { res.writeHead(529, { 'retry-after': '10' }); return res.end('{}'); }
    if (mode === 'bad') { res.writeHead(400); return res.end('{"detail":"bad request"}'); }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ answers: { q: { noul: 0.9 } }, usage: {} }));
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'handry-jevdown-'));
process.env.JEVIS_HOME = home;
process.env.JEVIS_JEV_URL = `http://127.0.0.1:${server.address().port}/`;
process.env.JEV_KEY = 'test';
process.env.JEVIS_TEST_NOTIFY = 'record';
const jev = await import('../core/jev.js');
const { tryFast } = await import('../core/router.js');
const { runCommand } = await import('../core/runner.js');
const Q = { q: { type: 'noul', instructions: 'Is `t` a greeting?' } };

let passed = 0, total = 0;
async function check(name, fn) {
  total++;
  const started = Date.now();
  let ok = false, note = '';
  try { const r = await fn(); ok = r && typeof r === 'object' && 'ok' in r ? Boolean(r.ok) : Boolean(r); note = r?.note || ''; } catch (err) { note = err.stack?.split('\n').slice(0, 2).join(' ') || err.message; }
  if (ok) passed++;
  console.log(`${ok ? '✅' : '❌'} ${String(Date.now() - started).padStart(6)} ms  ${name}${note ? `\n          → ${note}` : ''}`);
}
const reset = m => { mode = m; hits = []; };
const gaps = () => hits.slice(1).map((t, i) => t - hits[i]);

try {
  await check('Bir kez "aşırı yük" (529), sonra cevap: ikinci denemede başarılı', async () => {
    reset('busy-once');
    const r = await jev.ask({ t: 'merhaba' }, Q);
    return { ok: r.answers.q?.noul === 0.9 && hits.length === 2 && gaps()[0] >= 550, note: `${hits.length} istek, bekleme ${gaps()} ms` };
  });
  await check('Sürekli aşırı yük: 3 deneme (artan bekleme), sonra JEV_DOWN', async () => {
    reset('busy');
    const err = await jev.ask({ t: 'merhaba' }, Q).then(() => null, e => e);
    const g = gaps();
    return { ok: err?.code === 'JEV_DOWN' && hits.length === 3 && g[0] >= 550 && g[1] >= 1400 && g[1] < g[0] + 2000, note: `${hits.length} istek, beklemeler ${g} ms, ${err?.code}` };
  });
  await check('Retry-After 10 sn dese bile en fazla 3 sn beklenir', async () => {
    reset('retry-after');
    await jev.ask({ t: 'merhaba' }, Q);
    const g = gaps()[0];
    return { ok: hits.length === 2 && g >= 2900 && g < 3600, note: `bekleme ${g} ms` };
  });
  await check('Bozuk istek (400): tekrar denenmez, JEV_ERROR', async () => {
    reset('bad');
    const err = await jev.ask({ t: 'merhaba' }, Q).then(() => null, e => e);
    return { ok: err?.code === 'JEV_ERROR' && hits.length === 1, note: `${hits.length} istek, ${err?.code}` };
  });
  await check('Hızlı yol Jev\'e soramayınca komutu düşürmez, Claude\'a bırakır', async () => {
    reset('busy');
    const events = [];
    const r = await tryFast('sesi biraz kıs', e => events.push(e));
    const route = events.find(e => e.type === 'route');
    return { ok: r.handled === false && /Claude yapıyor/.test(r.note || '') && route?.why === 'jev_unavailable', note: r.note };
  });
  await check('Komut uçtan uca: Jev yokken beyin cevap veriyor, hata yok', async () => {
    reset('busy');
    const fakeBrain = { id: 'fake', run: async () => ({ text: 'Tamam, sesi kıstım.' }) };
    const out = await runCommand({ text: 'sesi biraz kıs', brainOverride: fakeBrain, switchChat: false, source: 'test' });
    return { ok: /sesi kıstım/.test(out.text || ''), note: String(out.text).slice(0, 80) };
  });
  await check('Jev kapalı (bağlantı yok): denemeler sonra JEV_DOWN', async () => {
    await new Promise(r => server.close(r));
    const err = await jev.ask({ t: 'merhaba' }, Q).then(() => null, e => e);
    return { ok: err?.code === 'JEV_DOWN' && /ulaşılamadı/.test(err.message), note: err?.message?.slice(0, 80) };
  });
} finally {
  server.close();
  fs.rmSync(home, { recursive: true, force: true });
}

console.log(`\n${passed}/${total} geçti`);
process.exit(passed === total ? 0 : 1);
