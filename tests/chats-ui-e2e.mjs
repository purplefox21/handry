// Handry · © 2026 Berat Olekli (purplefox) · github.com/purplefox21/handry
// Chats in the chat window and the bar, through a real server (throwaway
// Handry home) driven with Handry's own browser hands: a command in the window,
// one in the bar that the window then shows, "yeni sohbet", and going back
// to the first chat from the Sohbetler list. Only fast-path commands, no Claude.
// Usage: node tests/chats-ui-e2e.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import * as browser from '../hands/browser.js';

const PORT = 3935;
const BASE = `http://127.0.0.1:${PORT}`;
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'jevis-chats-ui-'));
const env = { ...process.env, PORT: String(PORT), JEVIS_HOME: home, JEVIS_TEST_CONFIRM: 'allow' };
delete env.JEVIS_NO_CHAT;
const server = spawn(process.execPath, [new URL('../app/server.js', import.meta.url).pathname], { env, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise(r => server.stdout.once('data', r));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const page = () => browser.activePage();
const texts = sel => page().then(p => p.$$eval(sel, els => els.map(e => e.textContent.trim())));

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

try {
  await browser.open(`${BASE}/`, { newTab: true });
  await check('Pencereden komut: sohbet başlığı görünüyor', async () => {
    await browser.type('Komut', 'şu an hangi şarkı çalıyor', { submit: true });
    await browser.wait({ text: 'Bitti', ms: 20000 });
    const title = (await texts('#chatTitle'))[0];
    return { ok: title.startsWith('şu an hangi şarkı'), note: `başlık: ${title}` };
  });

  await check('Çubuktan verilen komut pencerede "Çubuktan" diye beliriyor', async () => {
    await browser.open(`${BASE}/bar.html`, { newTab: true });
    await browser.type('Komut', 'sesi değiştirme sadece şu an hangi şarkı çalıyor söyle', { submit: true }).catch(() => {});
    await browser.wait({ text: 'Bitti', ms: 20000 });
    const barFoot = (await texts('#foot'))[0];
    await browser.closeTab();
    const p = await page();
    await p.bringToFront();
    await p.evaluate(() => window.dispatchEvent(new Event('focus')));
    await sleep(800);
    const labels = await texts('.activity-label, .turn .label, .label');
    const users = await texts('.msg-user');
    return { ok: users.length === 2 && labels.some(l => l.startsWith('Çubuktan')) && /Sohbet:/.test(barFoot), note: `çubuk: ${barFoot} · pencere: ${users.length} komut, etiketler: ${labels.slice(-2).join(' | ')}` };
  });

  await check('"yeni sohbet": pencere temiz sayfaya geçiyor', async () => {
    await browser.type('Komut', 'yeni sohbet', { submit: true });
    await sleep(1500);
    const users = await texts('.msg-user');
    const welcome = await page().then(p => p.evaluate(() => !document.getElementById('welcome').hidden));
    return { ok: users.length === 0 && welcome, note: `${users.length} komut görünüyor, karşılama: ${welcome}` };
  });

  await check('Sohbetler listesinden ilk sohbete dönülüyor', async () => {
    await browser.click('Sohbetler');
    await sleep(500);
    const items = await texts('.chat-item-title');
    const p = await page();
    await p.click('.chat-item >> text=şu an hangi şarkı');
    await sleep(800);
    const users = await texts('.msg-user');
    return { ok: items.length === 2 && users.length === 2, note: `liste: ${items.join(' | ')} · ${users.length} komut geri geldi` };
  });
} finally {
  await browser.closeTab().catch(() => {});
  server.kill();
  fs.rmSync(home, { recursive: true, force: true });
}

console.log(`\n${passed}/${total} geçti`);
process.exit(passed === total ? 0 : 1);
