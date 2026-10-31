// Handry · © 2026 Berat Olekli (purplefox) · github.com/purplefox21/handry
// Files and projects through the tool layer: folder listing with Turkish
// folder names, reading texts (secrets masked, key files and paths outside
// the home folder refused), search, recently used apps and projects, what
// was done in this project, and opening files (programs ask first). Works in
// a throwaway folder under ~/Library/Caches (~/.jevis itself is off limits to
// the file tools); opens and closes TextEdit.
// Usage: node tests/files-e2e.mjs
import fs from 'node:fs';
import path from 'node:path';
import { callTool } from '../core/tools.js';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import * as desktop from '../hands/desktop.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const call = async (name, args) => {
  const r = await callTool(name, args);
  return { ...r, text: r.content.filter(c => c.type === 'text').map(c => c.text).join('\n') };
};

let passed = 0;
let total = 0;
async function step(name, run, check) {
  total++;
  const started = Date.now();
  let ok = false;
  let note = '';
  try {
    const r = await run();
    ok = Boolean(await check(r));
    note = r?.text?.split('\n').slice(0, 2).join(' / ').slice(0, 160) || '';
  } catch (err) {
    note = err.message;
  }
  if (ok) passed++;
  console.log(`${ok ? '✅' : '❌'} ${String(Date.now() - started).padStart(5)} ms  ${name}${note ? `\n        ${note}` : ''}`);
}

process.env.JEVIS_TEST_CONFIRM = 'deny';
const dir = fs.mkdtempSync(path.join(os.homedir(), 'Library', 'Caches', 'jevis-files-test-'));
const fake = ['sk', 'ant', 'api03', 'x'.repeat(30)].join('-');
fs.writeFileSync(path.join(dir, 'notlar.txt'), `Alışveriş: süt, ekmek\nAPI anahtarı: ${fake}\npassword=çokgizli123\n`);
fs.writeFileSync(path.join(dir, '.env'), 'JEV_KEY=gizli\n');
fs.writeFileSync(path.join(dir, 'calistir.command'), '#!/bin/sh\ntouch "$(dirname "$0")/CALISTI"\n', { mode: 0o755 });
fs.mkdirSync(path.join(dir, 'alt klasör'));

try {
  await step('Klasör listesi (gizli dosyalar gizli)', () => call('files_list', { path: dir }), r => !r.isError && r.text.includes('notlar.txt') && r.text.includes('alt klasör/') && !r.text.includes('.env'));
  await step('"Masaüstü" → ~/Desktop', () => call('files_list', { path: 'Masaüstü' }), r => !r.isError && r.text.startsWith('~/Desktop') && r.text.includes('jev/'));
  await step('Metin okunuyor, anahtar ve şifre maskeleniyor', () => call('files_read', { path: path.join(dir, 'notlar.txt') }), r => !r.isError && r.text.includes('süt, ekmek') && !r.text.includes(fake) && !r.text.includes('çokgizli123') && r.text.includes('[gizli]'));
  await step('.env dosyası okunmuyor', () => call('files_read', { path: path.join(dir, '.env') }), r => r.isError && r.text.includes('okumaz'));
  await step('Ev klasörü dışı reddediliyor', () => call('files_read', { path: '/etc/hosts' }), r => r.isError && r.text.includes('ev klasöründeki'));
  await step('Handry\'in kendi klasörü (~/.jevis) okunmuyor', () => call('files_read', { path: '~/.jevis/state.json' }), r => r.isError && r.text.includes('okumaz'));
  await step('Ad ile arama (Spotlight)', () => call('files_search', { query: 'PLAN.md', path: '~/Desktop/jev' }), r => !r.isError && r.text.includes('~/Desktop/jev/PLAN.md'));
  await step('Son kullanılan uygulamalar', () => call('files_recent', { kind: 'apps', days: 7 }), r => !r.isError && /Calculator|TextEdit|Google Chrome/.test(r.text));
  await step('Son projeler (VS Code + Claude Code)', () => call('files_recent', { kind: 'projects' }), r => !r.isError && /📁 jev — ~\/Desktop\/jev .*Claude Code/.test(r.text) && !r.text.includes('/private/tmp'));
  await step('Git: son commit ve kaydedilmemiş değişiklik', () => {
    const git = (...a) => execFileSync('git', ['-C', dir, '-c', 'user.name=Handry Test', '-c', 'user.email=test@jevis.local', ...a], { stdio: 'pipe' });
    git('init', '-q');
    git('add', 'notlar.txt');
    git('commit', '-qm', 'İlk kayıt');
    fs.appendFileSync(path.join(dir, 'notlar.txt'), 'yumurta\n');
    return call('project_activity', { path: dir });
  }, r => !r.isError && r.text.includes('kaydedilmemiş değişiklik (notlar.txt, ') && r.text.includes('az önce) İlk kayıt'));
  await step('Bu projede ne yapıldı (Claude Code oturumları)', () => call('project_activity', { path: '~/Desktop/jev', sessions: 1 }), r => !r.isError && r.text.includes('Claude Code oturumu 1:') && r.text.includes('İlk istek:'));
  await step('Çalışacak dosya sorulmadan açılmıyor', async () => {
    const r = await call('files_open', { path: path.join(dir, 'calistir.command') });
    await sleep(1500);
    return { ...r, ran: fs.existsSync(path.join(dir, 'CALISTI')) };
  }, r => r.isError && r.text.includes('izin vermedi') && !r.ran);
  await step('Metin dosyası TextEdit ile açılıyor', async () => {
    const r = await call('files_open', { path: path.join(dir, 'notlar.txt'), app: 'TextEdit' });
    await sleep(1500);
    const front = await desktop.frontmost();
    return { ...r, front };
  }, r => !r.isError && r.front.app === 'TextEdit' && r.front.window?.includes('notlar'));
} finally {
  if ((await desktop.apps()).some(a => a.bundleId === 'com.apple.TextEdit')) await desktop.quitApp('TextEdit').catch(() => {});
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${passed}/${total} geçti`);
process.exit(passed === total ? 0 : 1);
