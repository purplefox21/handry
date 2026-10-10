// "Hey Handry" (and the older "Hey Foxie" / "Hey Fox") and live speech in the app (Handry.app), without a microphone: phrases are
// spoken by macOS (Yelda) into files and run through the app's own listener
// (JEVIS --test-listener), the same steps the microphone goes through. Then
// the phrase audio it keeps goes through whisper, as in the bar.
// Needs the app (Handry.app) installed and its Speech Recognition permission.
// Usage: node tests/listener-e2e.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { INSTALLED } from '../app/macos/build.js';
import { transcribe, stripWake } from '../voice/stt.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jevis-listener-'));
const norm = s => String(s).toLocaleLowerCase('tr').replace(/[.,!?;:'’"]/g, ' ').replace(/\s+/g, ' ').trim();

function speak(name, text) {
  const aiff = path.join(dir, `${name}.aiff`);
  const wav = path.join(dir, `${name}.wav`);
  execFileSync('say', ['-v', 'Yelda', '-o', aiff, text]);
  execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@48000', '-c', '1', aiff, wav]);
  return wav;
}

function listen(wav, { active = false } = {}) {
  const out = `${wav}.json`;
  execFileSync('open', ['-n', '-W', '-a', INSTALLED, '--args', '--test-listener', wav, '--out', out, ...(active ? ['--active'] : [])], { timeout: 60000 });
  return JSON.parse(fs.readFileSync(out, 'utf-8')).events;
}

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

const final = events => events.find(e => e.type === 'final');
const describe = events => events.filter(e => e.type !== 'partial').map(e => e.type + (e.text ? `: "${e.text}"` : '')).join(' · ');

try {
  const perm = listen(speak('perm', '[[slnc 300]] deneme'), { active: true }).find(e => e.type === 'permissions');
  if (!perm?.speech) {
    console.log('⏭️  JEVIS\'in Konuşma Tanıma izni yok: JEVIS menüsü › İzinleri Kontrol Et. Test atlandı.');
    process.exit(0);
  }

  await check('"Hey Foxie, sesi yüzde otuz yap": uyanıyor, komut canlı yazılıyor', async () => {
    const events = listen(speak('volume', '[[slnc 700]] Hey Foxie, sesi yüzde otuz yap. [[slnc 300]]'));
    const f = final(events);
    const partials = events.filter(e => e.type === 'partial').length;
    return { ok: events.some(e => e.type === 'wake') && f?.woke && /ses/.test(norm(f.text)) && /(30|otuz)/.test(norm(f.text)) && partials > 0, note: `${describe(events)} · ${partials} canlı parça` };
  });

  // Said the way the user says it ("Hendri"). With this voice (2026-10-10):
  // "…, Spotify'ı aç" every time; "…, müziği durdur" woke but the final text
  // lost "müziği"; "…, karanlık moda geç" did not wake ("Tayland"). Written as
  // "Handry", Yelda reads it "Handrı" (heard "Seyhan", "Android"); the bare name
  // came out as "Camby". The user's own voice is the real test.
  await check('"Hey Hendri, Spotify\'ı aç" uyandırıyor', async () => {
    const events = listen(speak('hey-hendri', '[[slnc 700]] Hey Hendri, Spotify\'ı aç. [[slnc 300]]'));
    const f = final(events);
    return { ok: events.some(e => e.type === 'wake') && f?.woke && /spotify/.test(norm(f.text)), note: describe(events) };
  });

  await check('"Hey Fox" da uyandırıyor', async () => {
    const events = listen(speak('fox', '[[slnc 700]] Hey Fox, ekran görüntüsü al. [[slnc 300]]'));
    const f = final(events);
    return { ok: events.some(e => e.type === 'wake') && f?.woke && /ekran/.test(norm(f.text)), note: describe(events) };
  });

  await check('whisper, "Hey Foxie" kesilmiş sesi doğru yazıyor', async () => {
    const events = listen(speak('spotify', '[[slnc 700]] Hey Foxie. Spotify\'da Tarkan çal. [[slnc 300]]'));
    const f = final(events);
    if (!f?.wav) return { ok: false, note: describe(events) };
    const t0 = Date.now();
    const text = stripWake(await transcribe(f.wav));
    return { ok: /tarkan/.test(norm(text)) && !/^hey/.test(norm(text)), note: `canlı: "${f.text}" · whisper: "${text}" (${Date.now() - t0} ms)` };
  });

  await check('Uyandırma kelimesi olmayan konuşmada uyanmıyor', async () => {
    const events = listen(speak('chat', '[[slnc 700]] Bugün hava çok güzel, dışarı çıkalım mı? Akşam da sinemaya gideriz. [[slnc 300]]'));
    return { ok: !events.some(e => e.type === 'wake' || e.type === 'final'), note: describe(events) || 'hiçbir şey olmadı' };
  });

  await check('"Hey Foxie" … (duraklama) … komut: arada susunca da komutu bekliyor', async () => {
    const events = listen(speak('pause', '[[slnc 700]] Hey Foxie. [[slnc 1300]] bugün takvimimde ne var? [[slnc 300]]'));
    const f = final(events);
    return { ok: f?.woke && /takvim/.test(norm(f.text)), note: describe(events) };
  });

  await check('Mikrofon düğmesi / bas-konuş: uyandırma kelimesi gerekmeden yazıyor, sessizlikte bitiyor', async () => {
    const events = listen(speak('active', '[[slnc 300]] Hesap makinesini aç. [[slnc 300]]'), { active: true });
    const f = final(events);
    return { ok: f && !f.woke && /hesap/.test(norm(f.text)), note: describe(events) };
  });
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${passed}/${total} geçti`);
process.exit(passed === total ? 0 : 1);
