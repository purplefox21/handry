// Phase 6 voice end to end without using the speakers: Turkish speech is made
// with `say -o` (to a file), transcribed through the app API, run as a
// command; the page's own recording code (downsample + WAV) is exercised in
// the browser with decoded audio instead of a live microphone.
// Usage: node tests/voice-e2e.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import * as browser from '../hands/browser.js';
import * as desktop from '../hands/desktop.js';
import { speak, speakable } from '../voice/tts.js';

const PORT = 3923;
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jevis-voice-'));

function speech(text, rate = 16000) {
  const aiff = path.join(TMP, 'say.aiff');
  const wav = path.join(TMP, `say-${rate}.wav`);
  execFileSync('say', ['-v', 'Yelda', '-o', aiff, text]);
  execFileSync('afconvert', ['-f', 'WAVE', '-d', `LEI16@${rate}`, '-c', '1', aiff, wav]);
  return wav;
}

function silence(seconds = 2) {
  const wav = path.join(TMP, 'silence.wav');
  const data = Buffer.alloc(16000 * 2 * seconds);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8); header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(data.length, 40);
  fs.writeFileSync(wav, Buffer.concat([header, data]));
  return wav;
}

const server = spawn(process.execPath, [new URL('../app/server.js', import.meta.url).pathname], {
  env: { ...process.env, PORT: String(PORT), JEVIS_TEST_CONFIRM: 'deny', JEVIS_NO_TIMERS: '1' }, stdio: ['ignore', 'pipe', 'inherit']
});
await new Promise(r => server.stdout.once('data', r));
const token = (await (await fetch(`${BASE}/`)).text()).match(/name="jevis-token" content="([a-f0-9]+)"/)[1];
const post = (url, body, type = 'application/json') => fetch(`${BASE}${url}`, { method: 'POST', headers: { 'Content-Type': type, 'X-Jevis-Token': token }, body });

let passed = 0;
let total = 0;
async function check(name, fn) {
  total++;
  const started = Date.now();
  let ok = false;
  let note = '';
  try { const r = await fn(); ok = Boolean(r?.ok ?? r); note = r?.note || ''; } catch (err) { note = err.message; }
  if (ok) passed++;
  console.log(`${ok ? '✅' : '❌'} ${String(Date.now() - started).padStart(5)} ms  ${name}${note ? `  → ${note}` : ''}`);
}

try {
  await check('Ses durumu: whisper + say hazır', async () => {
    const v = await (await fetch(`${BASE}/api/voice`, { headers: { 'X-Jevis-Token': token } })).json();
    return v.stt.ok && v.tts.ok;
  });

  let heard = '';
  await check('Konuşma → yazı (API)', async () => {
    const r = await (await post('/api/voice', fs.readFileSync(speech('Hesap makinesini aç')), 'audio/wav')).json();
    heard = r.text;
    return { ok: /hesap makinesini aç/i.test(r.text), note: `"${r.text}"` };
  });

  await check('Sessizlikten uydurma yazı çıkmıyor', async () => {
    const r = await (await post('/api/voice', fs.readFileSync(silence()), 'audio/wav')).json();
    return { ok: r.text === '', note: `"${r.text}"` };
  });

  await check('Sesle verilen komut çalışıyor (hızlı yol)', async () => {
    const res = await post('/api/run', JSON.stringify({ text: heard }));
    const body = await res.text();
    const opened = (await desktop.apps()).some(a => a.bundleId === 'com.apple.calculator');
    if (opened) await desktop.quitApp('Hesap Makinesi');
    return { ok: body.includes('"fast":true') && opened };
  });

  await check('Sesli cevap (dosyaya, hoparlörsüz)', async () => {
    const out = path.join(TMP, 'reply.aiff');
    await speak('Tamam, hesap makinesini açtım. **Sonuç** 84.', { toFile: out });
    return { ok: fs.statSync(out).size > 10000, note: `okunan: "${speakable('Tamam, hesap makinesini açtım. **Sonuç** 84.')}"` };
  });

  await check('Uzun cevabın sadece özeti okunuyor', () => {
    const long = 'Birinci cümle kısa. ' + 'İkinci cümle biraz daha uzun ve ayrıntılı. '.repeat(20);
    const s = speakable(long);
    return { ok: s.length <= 320 && s.startsWith('Birinci cümle kısa.'), note: `${s.length} karakter` };
  });

  await check('Arayüzün kayıt kodu: 44.1 kHz ses → 16 kHz WAV → yazı', async () => {
    const wav44 = fs.readFileSync(speech('Xcode\'u aç ve projeyi derle', 44100)).toString('base64');
    await browser.open(`${BASE}/`, { newTab: true });
    const page = await browser.activePage();
    const text = await page.evaluate(async ({ b64, tok }) => {
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const ctx = new AudioContext({ sampleRate: 44100 });
      const audio = await ctx.decodeAudioData(bytes.buffer);
      const samples = await resample([audio.getChannelData(0)], audio.sampleRate, 16000); // app.js
      const res = await fetch('/api/voice', { method: 'POST', headers: { 'Content-Type': 'audio/wav', 'X-Jevis-Token': tok }, body: toWav(samples, 16000) }); // app.js
      return (await res.json()).text;
    }, { b64: wav44, tok: token });
    await browser.closeTab();
    return { ok: /xcode/i.test(text) && /derle/i.test(text), note: `"${text}"` };
  });

  await check('Mikrofon kaydı (bilgi: izin gerekebilir)', async () => {
    try {
      const file = path.join(TMP, 'mic.wav');
      await desktop.record(1, file);
      return { ok: fs.statSync(file).size > 20000, note: 'mikrofon çalışıyor' };
    } catch (err) {
      return { ok: err.code === 'NO_PERMISSION', note: `izin yok: ${err.message.slice(0, 80)}` };
    }
  });
} finally {
  server.kill();
  fs.rmSync(TMP, { recursive: true, force: true });
}

console.log(`\n${passed}/${total} geçti`);
process.exit(passed === total ? 0 : 1);
