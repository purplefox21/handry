// The compact bar in the real Handry.app, driven like a person would: ⌥Space,
// type a harmless command, Enter. Checks that the command arrived from the
// bar, that the app the user was in stayed in front (the bar doesn't steal
// it), and that Esc / ⌥Space hide it again. Needs Handry.app running.
// Usage: node tests/bar-live-e2e.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as desktop from '../hands/desktop.js';

const HELPER = new URL('../bin/jevis-ax', import.meta.url).pathname;
const helper = (...args) => JSON.parse(execFileSync(HELPER, args.map(String)).toString() || '{}');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const BASE = `http://127.0.0.1:${JSON.parse(fs.readFileSync(new URL('../handry.config.json', import.meta.url))).server.port}`;

let passed = 0;
let total = 0;
async function check(name, fn) {
  total++;
  const started = Date.now();
  let ok = false;
  let note = '';
  try { const r = await fn(); ok = r && typeof r === 'object' && 'ok' in r ? Boolean(r.ok) : Boolean(r); note = r?.note || ''; } catch (err) { note = err.message; }
  if (ok) passed++;
  console.log(`${ok ? '✅' : '❌'} ${String(Date.now() - started).padStart(6)} ms  ${name}${note ? `\n          → ${note}` : ''}`);
}

const token = (await (await fetch(`${BASE}/`)).text()).match(/name="jevis-token" content="([a-f0-9]+)"/)?.[1];
const history = async () => (await (await fetch(`${BASE}/api/history`, { headers: { 'X-Jevis-Token': token } })).json()).runs;
// Handry.app writes whether the bar is up and has the keyboard to ~/.jevis/bar.json.
const barState = () => { try { return JSON.parse(fs.readFileSync(path.join(os.homedir(), '.jevis', 'bar.json'), 'utf-8')); } catch { return {}; } };
const barOnScreen = () => Boolean(barState().visible);
const barHasKeyboard = () => { const s = barState(); return Boolean(s.visible && s.key); };

// Never type while a macOS permission question is on screen: Enter would answer it.
const SYSTEM_DIALOGS = /UserNotificationCenter|SecurityAgent|universalAccessAuthWarn|CoreServicesUIAgent|tccd|Konum|Location/i;
const before = await desktop.frontmost();
if (SYSTEM_DIALOGS.test(before.app || '')) {
  console.log(`⏭️  Ekranda bir macOS sorusu var (${before.app}); test çalıştırılmadı.`);
  process.exit(0);
}
const command = 'şu an hangi şarkı çalıyor';

await check('⌥Space çubuğu açıyor', async () => {
  if (barOnScreen()) { helper('key', 'option+space'); await sleep(500); } // start from a closed bar
  helper('key', 'option+space');
  await sleep(600);
  return { ok: barOnScreen(), note: `önde: ${(await desktop.frontmost()).app}` };
});

await check('Yazılan komut Enter ile çubuktan gidiyor', async () => {
  const front = await desktop.frontmost();
  // The keys must land in Handry's bar, never in the app the user is working in.
  if (!barHasKeyboard() || SYSTEM_DIALOGS.test(front.app || '')) {
    return { ok: false, note: `klavye çubukta değil (önde ${front.app}); hiçbir şey yazılmadı` };
  }
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
  if (!barHasKeyboard()) return { ok: false, note: 'klavye çubukta değil; Esc gönderilmedi' };
  helper('key', 'escape');
  await sleep(500);
  return !barOnScreen();
});

console.log(`\n${passed}/${total} geçti`);
process.exit(passed === total ? 0 : 1);
