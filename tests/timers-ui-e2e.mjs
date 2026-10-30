// The timer list in the chat window and the bar, in a headless Chrome against
// its own server (throwaway Handry home, made-up Claude Code sessions). Nothing
// shows on screen and nothing makes a sound: reminders, shutdowns and iMessages
// are only written down (JEVIS_TEST_NOTIFY / JEVIS_TEST_POWER = record).
// The user's case: 2 timers and 1 watch, the middle one cancelled from the
// list → the other two run, the cancelled one never does.
// Usage: node tests/timers-ui-e2e.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const PORT = 3937;
const BASE = `http://127.0.0.1:${PORT}`;
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'jevis-timers-ui-'));
const sessionsDir = path.join(home, 'claude-sessions');
fs.mkdirSync(sessionsDir);
const env = {
  JEVIS_HOME: home, JEVIS_TEST_POWER: 'record', JEVIS_TEST_NOTIFY: 'record', JEVIS_CLAUDE_SESSIONS_DIR: sessionsDir,
  JEVIS_TIMER_TICK_MS: '300', JEVIS_TIMER_STABLE_MS: '600', JEVIS_NO_CHAT: '1'
};
Object.assign(process.env, env);
const timers = await import('../core/timers.js');
const chats = await import('../core/chats.js');

const server = spawn(process.execPath, [new URL('../app/server.js', import.meta.url).pathname], { env: { ...process.env, ...env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise(r => server.stdout.once('data', r));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await (await browser.newContext()).newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));

const sleep = ms => new Promise(r => setTimeout(r, ms));
const lines = name => { try { return fs.readFileSync(path.join(home, name), 'utf-8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } };
const said = () => lines('notify-test.log').map(n => n.message || n.imessage || '');
const powered = () => lines('power-test.log').map(l => l.action);
const waitFor = async (fn, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(150); } return false; };
const session = status => fs.writeFileSync(path.join(sessionsDir, `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: 's1', cwd: '/tmp/infiniteTales', name: 'iş geliştirme', entrypoint: 'claude-vscode', status, statusUpdatedAt: Date.now() }));
const texts = sel => page.$$eval(sel, els => els.map(e => e.textContent.trim()));

let passed = 0;
let total = 0;
async function check(name, fn) {
  total++;
  const started = Date.now();
  let ok = false;
  let note = '';
  try { const r = await fn(); ok = Boolean(r?.ok ?? r); note = r?.note || ''; } catch (err) { note = err.message; }
  if (ok) passed++;
  console.log(`${ok ? '✅' : '❌'} ${String(Date.now() - started).padStart(6)} ms  ${name}${note ? `\n          → ${String(note).split('\n').slice(0, 6).join('\n            ')}` : ''}`);
}

try {
  session('busy');
  const first = timers.addJob({ action: 'remind', text: 'birinci hatırlatma', at: Date.now() + 14000, said: '14 sn sonra birinciyi hatırlat' });
  const second = timers.addJob({ action: 'remind', text: 'ikinci hatırlatma', at: Date.now() + 14000, said: '14 sn sonra ikinciyi hatırlat' });
  timers.addJob({ action: 'remind', text: 'üçüncü hatırlatma', until: { claude: timers.claudeTargets(['iş geliştirme']) }, every: 300, said: 'iş geliştirme bitince hatırlat' });

  await page.goto(`${BASE}/`);
  await check('Pencere: ⏰ düğmesinde 3, listede 2 zamanlayıcı + 1 koşul, kalan süre ve son bakış', async () => {
    await page.waitForFunction(() => document.getElementById('timersBadge').textContent === '3');
    await page.click('#timersBtn');
    await page.waitForFunction(() => document.querySelectorAll('.timer-item').length === 3);
    await waitFor(async () => (await texts('.timer-sub')).some(t => /son bakış: iş geliştirme: çalışıyor/.test(t)), 5000);
    const subs = await texts('.timer-sub');
    const titles = await texts('.timer-title');
    return { ok: subs.filter(t => /kaldı$/.test(t)).length === 2 && subs.some(t => /son bakış: iş geliştirme: çalışıyor/.test(t)) && titles.some(t => t === 'Hatırlat: "ikinci hatırlatma"'), note: titles.map((t, i) => `${t} · ${subs[i]}`).join('\n') };
  });

  await check('Ortadakine "İptal": önce "Emin misin?" diyor, ikinci basışta listeden düşüyor', async () => {
    const button = page.locator(`.timer-item[data-id="${second.id}"] .timer-cancel`);
    await button.click();
    const asked = (await button.textContent()) === 'Emin misin?' && timers.listJobs().length === 3;
    await button.click();
    await page.waitForFunction(() => document.querySelectorAll('.timer-item').length === 2);
    const left = timers.listJobs().map(j => j.text);
    return { ok: asked && left.length === 2 && !left.includes('ikinci hatırlatma') && (await page.textContent('#timersBadge')) === '2', note: `kalan: ${left.join(', ')}` };
  });

  await check('Tek basış iptal etmiyor (3 sn sonra geri dönüyor)', async () => {
    const button = page.locator(`.timer-item[data-id="${first.id}"] .timer-cancel`);
    await button.click();
    await sleep(3400);
    return { ok: (await button.textContent()) === 'İptal' && timers.listJobs().length === 2 };
  });

  await check('Saati gelince birincisi yapılıyor, iptal edilen ikincisi hiç yapılmıyor', async () => {
    const done = await waitFor(() => said().includes('birinci hatırlatma'), 20000);
    await sleep(1500);
    return { ok: done && !said().includes('ikinci hatırlatma'), note: said().join(' | ') };
  });

  await check('Koşul gerçekleşince (iş geliştirme bitti) üçüncüsü yapılıyor; liste ve sayaç boşalıyor', async () => {
    session('idle');
    const done = await waitFor(() => said().includes('üçüncü hatırlatma'));
    await page.waitForFunction(() => document.getElementById('timersBadge').hidden && document.querySelector('#timerList .empty'), null, { timeout: 8000 });
    return { ok: done && !said().includes('ikinci hatırlatma') };
  });

  await check('"Hepsini iptal et" (iki basış)', async () => {
    timers.addJob({ action: 'shutdown', at: Date.now() + 3600000 });
    timers.addJob({ action: 'lock', at: Date.now() + 7200000 });
    await page.waitForFunction(() => document.querySelectorAll('.timer-item').length === 2, null, { timeout: 8000 });
    await page.click('#cancelAllTimers');
    await page.click('#cancelAllTimers');
    await page.waitForFunction(() => document.querySelector('#timerList .empty'), null, { timeout: 5000 });
    return { ok: !timers.listJobs().length && !powered().length };
  });

  await check('Çubuk: kapatma geri sayımında büyük İptal düğmesi; basınca Mac kapanmıyor', async () => {
    timers.addJob({ action: 'lock', at: Date.now() + 3600000, said: '1 saat sonra ekranı kilitle' });
    timers.addJob({ action: 'shutdown', at: Date.now() + 1500, countdown: 8 });
    await page.goto(`${BASE}/bar.html`);
    await page.waitForFunction(() => !document.getElementById('alarm').hidden, null, { timeout: 10000 });
    const alarmText = await page.textContent('#alarmText');
    await page.click('#alarmCancel');
    const cancelled = await waitFor(() => said().some(t => /Kapatma iptal edildi/.test(t)), 5000);
    await sleep(9000); // past the end of the countdown
    return { ok: /sn sonra kapanıyor/.test(alarmText) && cancelled && !powered().length && timers.listJobs().length === 1, note: alarmText };
  });

  await check('Çubuk: "⏰ 1" → liste → ✕ iki basışla iptal', async () => {
    await page.waitForFunction(() => document.getElementById('alarm').hidden && document.getElementById('timersChip').textContent === '⏰ 1', null, { timeout: 8000 });
    await page.click('#timersChip');
    const rows = await texts('.timer-row-title');
    await page.click('.timer-x');
    const asked = (await page.textContent('.timer-x')) === 'İptal?';
    await page.click('.timer-x');
    await page.waitForFunction(() => document.getElementById('timersChip').hidden, null, { timeout: 5000 });
    return { ok: rows.join() === 'Ekranı kilitle' && asked && !timers.listJobs().length, note: rows.join(', ') };
  });

  await check('Zamanlayıcıya tıklayınca kurulduğu sohbet açılıyor (pencere ve çubuk)', async () => {
    const asked = chats.newChat();
    chats.addUser(asked, '14 dk sonra spotifydan need for speed çal', 'bar');
    const other = chats.newChat();
    chats.addUser(other, 'başka bir konu', 'window');
    const job = timers.addJob({ action: 'command', text: 'zamanlayıcılar neler', at: Date.now() + 3600000, said: '14 dk sonra spotifydan need for speed çal', chatId: asked.id });
    await page.goto(`${BASE}/`);
    await page.waitForFunction(() => document.getElementById('timersBadge').textContent === '1');
    await page.click('#timersBtn');
    await page.click(`.timer-item[data-id="${job.id}"] .timer-title`);
    await page.waitForFunction(() => document.getElementById('timersDrawer').hidden, null, { timeout: 5000 });
    const title = (await page.textContent('#chatTitle')).trim();
    const shown = await texts('.msg-user');
    const windowOk = title.startsWith('14 dk sonra') && shown.some(t => t.includes('need for speed')) && chats.peekChat().id === asked.id;
    chats.switchChat(other.id);
    await page.goto(`${BASE}/bar.html`);
    await page.waitForFunction(() => !document.getElementById('timersChip').hidden);
    await page.click('#timersChip');
    await page.click('.timer-row-title');
    await waitFor(() => chats.peekChat().id === asked.id, 3000);
    const barOk = chats.peekChat().id === asked.id;
    timers.cancelJobs('all');
    return { ok: windowOk && barOk, note: `pencere: ${title} · çubuk sonrası açık sohbet: ${chats.peekChat().title}` };
  });

  await check('Sayfa hatası yok', () => ({ ok: !errors.length, note: errors.join('\n') }));
} finally {
  await browser.close();
  server.kill();
  fs.rmSync(home, { recursive: true, force: true });
}

console.log(`\n${passed}/${total} geçti`);
process.exit(passed === total ? 0 : 1);
