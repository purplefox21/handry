// Timers, watches and power commands, and the fast path not acting on chat.
// Works in a throwaway JEVIS home with made-up Claude Code sessions; locking,
// shutting down and iMessages are only written down (JEVIS_TEST_POWER /
// JEVIS_TEST_NOTIFY = record), nothing really happens to the Mac. Uses Jev for
// the fast-path decisions; the brain is a stand-in that records what it gets.
// Usage: node tests/timers-e2e.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'jevis-timers-'));
const sessionsDir = path.join(home, 'claude-sessions');
fs.mkdirSync(sessionsDir);
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ notify: { imessageTo: 'test@example.com', imessageAfterSec: 1 } }));
Object.assign(process.env, {
  JEVIS_HOME: home, JEVIS_TEST_POWER: 'record', JEVIS_TEST_NOTIFY: 'record', JEVIS_CLAUDE_SESSIONS_DIR: sessionsDir,
  JEVIS_TIMER_TICK_MS: '200', JEVIS_TIMER_STABLE_MS: '800'
});
delete process.env.JEVIS_NO_CHAT;
delete process.env.JEVIS_NO_TIMERS;

const timers = await import('../core/timers.js');
const { runCommand } = await import('../core/runner.js');
const { callTool } = await import('../core/tools.js');
const { requestStop, clearStop } = await import('../guard/stop.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const lines = name => { try { return fs.readFileSync(path.join(home, name), 'utf-8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } };
const powered = () => lines('power-test.log').map(l => l.action);
const notices = () => lines('notify-test.log');
const reset = () => { for (const f of ['power-test.log', 'notify-test.log', 'timers.json']) fs.rmSync(path.join(home, f), { force: true }); clearStop(); };
const waitFor = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await sleep(100); } return false; };
const toolText = async (name, args) => (await callTool(name, args)).content.map(c => c.text).join('\n');

// Two made-up Claude Code sessions in VS Code: this process and a child that sleeps.
const child = spawn('sleep', ['300']);
const session = (pid, name, status, extra = {}) => fs.writeFileSync(path.join(sessionsDir, `${pid}.json`), JSON.stringify({ pid, sessionId: `s-${pid}`, cwd: `/tmp/${name}`, name, entrypoint: 'claude-vscode', status, statusUpdatedAt: Date.now(), ...extra }));
session(process.pid, 'iş geliştirme', 'busy');
session(child.pid, 'ornek-proje', 'busy');

const brainGot = [];
const brain = { id: 'claude-code', label: 'Test beyni', run: async ({ text }) => { brainGot.push(text); return { text: 'Tamam.', sessionId: 'test-session' }; } };
const say = text => runCommand({ text, brainId: 'claude-code', brainOverride: brain });

let passed = 0;
let total = 0;
async function check(name, fn) {
  total++;
  const started = Date.now();
  let ok = false;
  let note = '';
  try { const r = await fn(); ok = Boolean(r?.ok ?? r); note = r?.note || ''; } catch (err) { note = err.stack || err.message; }
  if (ok) passed++;
  console.log(`${ok ? '✅' : '❌'} ${String(Date.now() - started).padStart(6)} ms  ${name}${note ? `\n          → ${String(note).split('\n').slice(0, 6).join('\n            ')}` : ''}`);
}

try {
  await check('Kurallar: zaman, koşul, olumsuz cümle ve iptal doğru okunuyor (30 cümle)', () => {
    const now = new Date('2026-10-01T00:59:46').getTime();
    const at = (h, m, day = 1) => new Date(`2026-10-${String(day).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`).getTime();
    const cases = [
      ['saat 01:01 olunca bilgisayarı kilitle kapatma uykuya da alma ekranı kilitle', { type: 'schedule', action: 'lock', at: at(1, 1) }],
      ['kapatma kilitle kilitle uyku modu kapatma', { type: 'negated' }],
      ['anlamadın sanırım cümleyi okumadın', null],
      ['bro son mesajlarımda ne anlattım sana', null],
      ['selam', null],
      ['2 tane vs code açık 2 sine de görev verdim onlar işlemlerini bitirince bilgisayarı kapatır mısın', { type: 'schedule', action: 'shutdown', claude: true }],
      ['3 saat sonra pc yi kapat', { type: 'schedule', action: 'shutdown', at: now + 3 * 3600000 }],
      ['yarım saat sonra bilgisayarı uyut', { type: 'schedule', action: 'sleep', at: now + 1800000 }],
      ['bir buçuk saat sonra macı yeniden başlat', { type: 'schedule', action: 'restart', at: now + 5400000 }],
      ['1 saat 20 dakika sonra ekranı kilitle', { type: 'schedule', action: 'lock', at: now + 80 * 60000 }],
      ["saat 3'te bilgisayarı kapat", { type: 'schedule', action: 'shutdown', at: at(3, 0) }],
      ['gece 2de bilgisayarı kapat', { type: 'schedule', action: 'shutdown', at: at(2, 0) }],
      ['akşam 8 gibi bilgisayarı uyku moduna al', { type: 'schedule', action: 'sleep', at: at(20, 0) }],
      ["yarın sabah 9'da bilgisayarı yeniden başlat", { type: 'schedule', action: 'restart', at: at(9, 0, 2) }],
      ["VS Code'daki işler bitince bilgisayarı kapat", { type: 'schedule', action: 'shutdown', claude: true }],
      ['5 dakikada bir kontrol et indirme bitince bilgisayarı kapat', { type: 'brain' }],
      ["10 dk sonra spotify'ı durdur", { type: 'brain' }],
      ["yarın saat 9'da annemi aramayı hatırlat", { type: 'brain' }],
      ['bilgisayarı kapat', { type: 'now', action: 'shutdown' }],
      ['ekranı kilitle', { type: 'now', action: 'lock' }],
      ['uyku moduna al', { type: 'now', action: 'sleep' }],
      ['bilgisayarı kapatma', { type: 'negated' }],
      ['zamanlayıcıyı iptal et', { type: 'cancel' }],
      ['kapatmayı iptal et', { type: 'cancel' }],
      ['zamanlayıcılar neler', { type: 'list' }],
      ['hesap makinesini kapat', null],
      ["bilgisayardaki spotify'ı kapat", null],
      ['sesi yüzde 30 yap', null],
      ['şu an hangi şarkı çalıyor', null],
      ['dosyayı masaüstüne kaydet', null]
    ];
    const wrong = [];
    for (const [text, want] of cases) {
      const got = timers.parseSchedule(text, now);
      const good = want === null ? got === null : got && Object.entries(want).every(([k, v]) => (k === 'at' ? Math.abs(got.at - v) < 1000 : got[k] === v));
      if (!good) wrong.push(`${text} → ${JSON.stringify(got)}`);
    }
    return { ok: !wrong.length, note: wrong.join('\n') };
  });

  timers.startScheduler();

  await check('"saat … olunca … ekranı kilitle": hemen kilitlemiyor, o saate kuruyor (senin 00:59\'daki cümlen)', async () => {
    reset();
    const out = await say('saat 01:01 olunca bilgisayarı kilitle kapatma uykuya da alma ekranı kilitle');
    const jobs = timers.listJobs();
    return { ok: out.fast && !powered().length && jobs.length === 1 && jobs[0].action === 'lock' && /01:01/.test(out.text), note: out.text };
  });

  await check('Sohbet, itiraz ve düzeltme hızlı yoldan geçmiyor, Claude\'a gidiyor; hiçbir şey kilitlenmiyor', async () => {
    reset();
    const said = ['selam', 'anlamadın sanırım cümleyi okumadın', 'kapatma kilitle kilitle uyku modu kapatma', 'bro son mesajlarımda ne anlattım sana', 'neler yapabilirsin'];
    const before = brainGot.length;
    const fast = [];
    for (const text of said) { const out = await say(text); if (out.fast) fast.push(text); }
    return { ok: brainGot.length - before === said.length && !fast.length && !powered().length, note: fast.length ? `hızlı yoldan geçen: ${fast.join(' | ')}` : `Claude'a giden: ${brainGot.length - before}/${said.length}` };
  });

  await check('Düz komut hâlâ hızlı: "ekranı kilitle" beyinsiz kilitliyor (Apple menüsü › Ekranı Kilitle)', async () => {
    reset();
    const out = await say('ekranı kilitle');
    return { ok: out.fast && powered().join() === 'lock', note: `${out.text} · ${out.ms} ms` };
  });

  await check('Saati gelen iş yapılıyor (kilit)', async () => {
    reset();
    timers.addJob({ action: 'lock', at: Date.now() + 300 });
    return { ok: await waitFor(() => powered().includes('lock')) && !timers.listJobs().length };
  });

  await check('Kapatma geri sayımı ⌥Esc / "dur" ile iptal ediliyor', async () => {
    reset();
    timers.addJob({ action: 'shutdown', at: Date.now(), countdown: 3 });
    const counting = await waitFor(() => notices().some(n => /3 saniye sonra kapanacak/.test(n.message || '')));
    requestStop('test');
    const cancelled = await waitFor(() => notices().some(n => /Kapatma iptal edildi/.test(n.message || '')));
    await sleep(3500);
    return { ok: counting && cancelled && !powered().length && !timers.listJobs().length, note: notices().map(n => n.message || n.imessage).join(' | ') };
  });

  await check('İptal edilmezse: geri sayım, telefona iMessage, sonra kapatma', async () => {
    reset();
    timers.addJob({ action: 'shutdown', at: Date.now(), countdown: 1 });
    const done = await waitFor(() => powered().includes('shutdown'));
    const imessage = notices().find(n => n.imessage);
    return { ok: done && /kapatıyorum/.test(imessage?.imessage || ''), note: imessage?.imessage };
  });

  await check('Mac uyurken kaçan kapatma sonradan yapılmıyor, haber veriliyor', async () => {
    reset();
    timers.addJob({ action: 'shutdown', at: Date.now() - 20 * 60000 });
    const told = await waitFor(() => notices().some(n => /zamanında yapamadım/.test(n.message || '')));
    await sleep(500);
    return { ok: told && !powered().length && !timers.listJobs().length };
  });

  await check('"VS Code\'daki işler bitince kapat": ikisi bitene kadar bekliyor, cevap bekleyen varsa haber veriyor, bitince kapatıyor', async () => {
    reset();
    session(process.pid, 'iş geliştirme', 'busy');
    session(child.pid, 'ornek-proje', 'busy');
    const out = await say("VS Code'daki işler bitince bilgisayarı kapat");
    const job = timers.listJobs()[0];
    if (!job) return { ok: false, note: out.text };
    timers.cancelJobs('all');
    timers.addJob({ ...job, countdown: 1, every: 200 }); // the same watch, checked faster
    session(process.pid, 'iş geliştirme', 'idle');
    session(child.pid, 'ornek-proje', 'waiting', { waitingFor: 'permission' });
    const toldWaiting = await waitFor(() => notices().some(n => /ornek-proje.*cevap bekliyor/.test(n.message || '') && n.imessage));
    await sleep(1200);
    const waitedOne = !powered().length;
    session(child.pid, 'ornek-proje', 'idle');
    const done = await waitFor(() => powered().includes('shutdown'));
    return { ok: out.fast && job.until?.claude?.length === 2 && toldWaiting && waitedOne && done, note: `${out.text}\n${notices().map(n => n.message || n.imessage).join(' | ')}` };
  });

  await check('Çalışan Claude işi yoksa "işler bitince kapat" bir şey kurmuyor', async () => {
    reset();
    session(process.pid, 'iş geliştirme', 'idle');
    session(child.pid, 'ornek-proje', 'idle');
    const text = await toolText('schedule_task', { action: 'shutdown', until: { claude_done: true } });
    return { ok: /çalışan bir Claude Code işi yok/.test(text) && !timers.listJobs().length, note: text.split('\n')[0] };
  });

  await check('claude_sessions: oturumları ve durumlarını söylüyor', async () => {
    session(process.pid, 'iş geliştirme', 'busy');
    session(child.pid, 'ornek-proje', 'waiting', { waitingFor: 'input needed' });
    const text = await toolText('claude_sessions', {});
    return { ok: /iş geliştirme.*çalışıyor/.test(text) && /ornek-proje.*cevap bekliyor/.test(text), note: text };
  });

  await check('Uygulama kapanınca hatırlatma (koşullu nöbet, Jev\'siz)', async () => {
    reset();
    const text = await toolText('schedule_task', { action: 'remind', text: 'Render bitti, kontrol et', until: { app: 'JevisOlmayanUygulama', closed: true }, every_minutes: 0.005 });
    const reminded = await waitFor(() => notices().some(n => n.title === 'Hatırlatma' && /Render bitti/.test(n.message || '')), 10000);
    return { ok: reminded, note: text.split('\n')[0] };
  });

  await check('"zamanlayıcılar neler" ve "zamanlayıcıyı iptal et" hızlı yoldan', async () => {
    reset();
    timers.addJob({ action: 'shutdown', at: Date.now() + 3 * 3600000 });
    const list = await say('zamanlayıcılar neler');
    const cancel = await say('zamanlayıcıyı iptal et');
    return { ok: list.fast && /kapat/.test(list.text) && cancel.fast && /İptal edildi/.test(cancel.text) && !timers.listJobs().length, note: `${list.text}\n${cancel.text}` };
  });

  await check('"bilgisayarı kapatma": bekleyen kapatmayı iptal ediyor', async () => {
    reset();
    timers.addJob({ action: 'shutdown', at: Date.now() + 3600000 });
    const out = await say('bilgisayarı kapatma');
    return { ok: out.fast && /yapmıyorum/.test(out.text) && !timers.listJobs().length, note: out.text };
  });
} finally {
  timers.stopScheduler();
  child.kill();
  fs.rmSync(home, { recursive: true, force: true });
}

console.log(`\n${passed}/${total} geçti`);
process.exit(passed === total ? 0 : 1);
