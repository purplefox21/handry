// The compact bar in the real JEVIS.app, driven like a person would: ⌥Space,
// type a harmless command, Enter. Checks that the command arrived from the
// bar, that the app the user was in stayed in front (the bar doesn't steal
// it), and that Esc / ⌥Space hide it again. Needs JEVIS.app running.
// Usage: node tests/bar-live-e2e.mjs
import { execFileSync } from 'node:child_process';
import * as desktop from '../hands/desktop.js';

const HELPER = new URL('../bin/jevis-ax', import.meta.url).pathname;
const helper = (...args) => JSON.parse(execFileSync(HELPER, args.map(String)).toString() || '{}');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const BASE = 'http://127.0.0.1:3000';

let passed = 0;
let total = 0;
async function check(name, fn) {
  total++;
  const started = Date.now();
  let ok = false;
  let note = '';
  try { const r = await fn(); ok = Boolean(r?.ok ?? r); note = r?.note || ''; } catch (err) { note = err.message; }
  if (ok) passed++;
  console.log(`${ok ? '✅' : '❌'} ${String(Date.now() - started).padStart(6)} ms  ${name}${note ? `\n          → ${note}` : ''}`);
}

const token = (await (await fetch(`${BASE}/`)).text()).match(/name="jevis-token" content="([a-f0-9]+)"/)?.[1];
const history = async () => (await (await fetch(`${BASE}/api/history`, { headers: { 'X-Jevis-Token': token } })).json()).runs;
// Is the bar panel on screen? It is JEVIS's only window near the top, 680 pt wide.
const barOnScreen = () => {
  const w = helper('windows', '--app', 'JEVIS').windows || [];
  return w.some(x => x.w === 680 && !x.minimized);
};

// Never type while a macOS permission question is on screen: Enter would answer it.
const SYSTEM_DIALOGS = /UserNotificationCenter|SecurityAgent|universalAccessAuthWarn|CoreServicesUIAgent|tccd|Konum|Location/i;
const before = await desktop.frontmost();
if (SYSTEM_DIALOGS.test(before.app || '')) {
  console.log(`⏭️  Ekranda bir macOS sorusu var (${before.app}); test çalıştırılmadı.`);
  process.exit(0);
}
const command = 'şu an hangi şarkı çalıyor';

await check('⌥Space çubuğu açıyor', async () => {
  helper('key', 'option+space');
  await sleep(600);
  return { ok: barOnScreen(), note: `önde: ${(await desktop.frontmost()).app}` };
});

await check('Yazılan komut Enter ile çubuktan gidiyor', async () => {
  const front = await desktop.frontmost();
  if (!barOnScreen() || SYSTEM_DIALOGS.test(front.app || '')) return { ok: false, note: `çubuk açık değil ya da önde bir sistem sorusu var (${front.app}); yazılmadı` };
  const count = (await history()).length;
  helper('type', command);
  await sleep(200);
  helper('key', 'return');
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    const runs = await history();
    if (runs.length > count && runs.at(-1).answer !== undefined) return { ok: runs.at(-1).source === 'bar' && runs.at(-1).text === command, note: `cevap: ${runs.at(-1).answer}` };
  }
  return { ok: false, note: 'komut sunucuya ulaşmadı' };
});

await check('Öndeki uygulama yerinde kaldı (çubuk odağı çalmıyor)', async () => {
  const f = await desktop.frontmost();
  return { ok: f.pid === before.pid, note: `önce ${before.app}, şimdi ${f.app}` };
});

await check('Esc çubuğu gizliyor', async () => {
  helper('key', 'escape');
  await sleep(500);
  return !barOnScreen();
});

console.log(`\n${passed}/${total} geçti`);
process.exit(passed === total ? 0 : 1);
