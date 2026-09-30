// Fast path v2 end to end: simple commands run without a brain, quickly.
// Restores the volume it changes; opens/closes Calculator; uses the JEVIS Chrome.
// Usage: node tests/fast-e2e.mjs
process.env.JEVIS_NO_CHAT = '1'; // test commands stay out of the user's chats
import { runCommand } from '../core/runner.js';
import * as mac from '../hands/mac.js';
import * as desktop from '../hands/desktop.js';
import * as browser from '../hands/browser.js';

const FIXTURE = new URL('./fixtures/appstore-like.html', import.meta.url).href;
const original = await mac.getVolume();
const sleep = ms => new Promise(r => setTimeout(r, ms));

const noBrain = { run: () => { throw new Error('beyne gitmemeliydi'); } };
let passed = 0;
let total = 0;
async function fast(command, check) {
  total++;
  const events = [];
  let out;
  try {
    out = await runCommand({ text: command, brainId: 'claude-code', onEvent: e => events.push(e), brainOverride: noBrain });
  } catch (err) {
    out = { error: err.message };
  }
  const ok = Boolean(out.fast) && Boolean(await check(out));
  if (ok) passed++;
  const route = events.find(e => e.type === 'route');
  console.log(`${ok ? '✅' : '❌'} ${String(out.ms ?? '-').padStart(5)} ms  ${String(route?.route).padEnd(11)} "${command}" → ${out.text || out.error || events.filter(e => e.type === 'status').map(e => e.text).join(' ')}`);
}

try {
  await fast(`sesi yüzde ${original} yap`, async () => (await mac.getVolume()) === original);
  await fast('sesi biraz kıs', async () => (await mac.getVolume()) === Math.max(0, original - 10));
  await fast('sesi biraz aç', async () => (await mac.getVolume()) === Math.max(0, original - 10) + 10);
  await fast('şu an hangi şarkı çalıyor', out => /çalıyor|çalmıyor/.test(out.text));
  await fast('hesap makinesini aç', async () => (await desktop.apps()).some(a => a.bundleId === 'com.apple.calculator'));
  await sleep(500);
  await fast('hesap makinesini kapat', async () => { await sleep(800); return !(await desktop.apps()).some(a => a.bundleId === 'com.apple.calculator'); });
  await fast("YouTube'u aç", async () => (await browser.activePage()).url().includes('youtube.com'));
  // Google may answer repeated test searches with its CAPTCHA page; the query is then in its "continue" link.
  await fast("Google'da mac mini fiyatları ara", async () => decodeURIComponent(decodeURIComponent((await browser.activePage()).url())).replace(/\+/g, ' ').includes('mac mini fiyatları'));
  await browser.open(FIXTURE);
  await fast('fiyatlandırma bölümüne tıkla', async () => (await (await browser.activePage()).evaluate(() => window.__log)).includes('nav:pricing'));
} finally {
  await mac.setVolume(original);
}
console.log(`\n${passed}/${total} geçti · ses eski seviyesine (%${original}) döndü`);
process.exit(passed === total ? 0 : 1);
