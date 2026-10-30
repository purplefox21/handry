// App shortcuts: Spotify through the fast path for real (plays the top
// search result and the Liked Songs, then pauses again if nothing was
// playing before), AppleScript syntax of the Music / Notes / Reminders /
// Calendar scripts, and their Automation permission state. Those four only
// run for real when macOS already allows it: Handry never answers macOS
// permission questions, so the first real use is left to the user.
// Usage: node tests/appshortcuts-e2e.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
process.env.JEVIS_NO_CHAT = '1'; // test commands stay out of the user's chats
import { runCommand } from '../core/runner.js';
import * as apps from '../hands/apps.js';
import * as desktop from '../hands/desktop.js';

const noBrain = { id: 'none', label: 'yok', run: () => { throw new Error('beyne gitmemeliydi'); } };
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
const fast = text => runCommand({ text, brainId: 'claude-code', onEvent: () => {}, brainOverride: noBrain });
const spotifyPlaying = async () => (await desktop.read({ app: 'Spotify' })).elements.some(e => e.name === 'Duraklat' && /Oyuncu|Player/.test(e.ctx || ''));

// AppleScripts compile (nothing runs).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jevis-scpt-'));
for (const [name, lines] of Object.entries(apps.SCRIPTS)) {
  await check(`AppleScript derleniyor: ${name}`, () => {
    execFileSync('osacompile', ['-o', path.join(tmp, `${name}.scpt`), '-e', lines.join('\n')], { stdio: 'pipe' });
    return true;
  });
}
fs.rmSync(tmp, { recursive: true, force: true });

if (desktop.installedApps().includes('Spotify')) {
  const startedIn = (await desktop.frontmost()).app;
  if (!(await desktop.apps()).some(a => a.bundleId === 'com.spotify.client')) {
    execFileSync('open', ['-gjb', 'com.spotify.client']);
    await new Promise(r => setTimeout(r, 4000));
  }
  const wasPlaying = await spotifyPlaying();
  await check('Hızlı yol: "Spotify\'da Tarkan çal" (Claude\'suz, çalıyor)', async () => {
    const out = await fast("Spotify'da Tarkan çal");
    return { ok: out.fast && /çalıyor/.test(out.text) && (await spotifyPlaying()), note: `${(out.ms / 1000).toFixed(1)} sn · ${out.text}` };
  });
  await check('Hızlı yol: "beğendiğim şarkıları çal"', async () => {
    const out = await fast('beğendiğim şarkıları çal');
    return { ok: out.fast && /Beğenilen Şarkılar çalıyor/.test(out.text) && (await spotifyPlaying()), note: `${(out.ms / 1000).toFixed(1)} sn · ${out.text}` };
  });
  if (!wasPlaying) {
    await check('Önceki hâline döndü (duraklatıldı)', async () => {
      await apps.spotifyPause();
      await new Promise(r => setTimeout(r, 800));
      return !(await spotifyPlaying());
    });
  }
  await desktop.activate(startedIn).catch(() => {});
}

for (const [id, name] of [['com.apple.Notes', 'Notlar'], ['com.apple.reminders', 'Anımsatıcılar'], ['com.apple.iCal', 'Takvim']]) {
  const { state } = await desktop.automationState(id);
  if (state !== 'granted') {
    const why = { ask: 'macOS izni henüz sorulmadı', denied: 'macOS izni kapalı', not_running: 'uygulama kapalı, izin durumu okunamadı' }[state] || state;
    console.log(`⏭️          ${name}: ${why}; gerçek deneme atlandı (izin sorusunu Handry cevaplamaz).`);
    continue;
  }
  if (id === 'com.apple.reminders') await check('Anımsatıcılar okunuyor', async () => ({ ok: true, note: apps.formatReminders(await apps.remindersList()).split('\n')[0] }));
  if (id === 'com.apple.iCal') await check('Bugünün takvimi okunuyor', async () => ({ ok: true, note: apps.formatEvents(await apps.calendarEvents()).split('\n')[0] }));
  if (id === 'com.apple.Notes') await check('Notlarda arama', async () => ({ ok: true, note: apps.formatNotes(await apps.notesFind('JEVIS')).split('\n')[0] }));
}

console.log(`\n${passed}/${total} geçti`);
process.exit(passed === total ? 0 : 1);
