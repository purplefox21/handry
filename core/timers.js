// Handry · © 2026 Berat Olekli (purplefox) · github.com/purplefox21/handry
// Scheduled tasks and watches: "3 saat sonra bilgisayarı kapat", "saat
// 01:01'de ekranı kilitle", "VS Code'daki işler bitince bilgisayarı kapat",
// "5 dakikada bir bak, indirme bitince uyut". A task has a time (at), a
// condition (until) checked every `every` ms, or both, and one thing to do:
// lock / sleep / restart / shutdown, a reminder, a Handry command, or a report
// (a Claude Code session is done: its last answer goes to the user).
// Conditions are checked by Handry itself, without an LLM: Claude Code's own
// session status files, or the text of an app window or a Handry Chrome tab
// (a plain "contains", or a yes/no by Jev).
// Tasks live in ~/.jevis/timers.json, so a task set from any Claude session
// through the Handry tools is kept too; the Handry server runs them
// (startScheduler). Shut down and restart get a countdown first (Handry bar,
// notification, then an iMessage to the user) and can be cancelled with ⌥Esc,
// "dur" or "zamanlayıcıyı iptal et"; then macOS asks once more for a minute.
// Safety: a shutdown that comes due while the Mac slept is not done late, and
// nothing powers off in the first 10 minutes after the Mac wakes up.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { HOME } from './config.js';
import * as jev from './jev.js';
import * as desktop from '../hands/desktop.js';
import * as browser from '../hands/browser.js';
import { claudeSessions, stateText } from '../hands/claude-sessions.js';
import { sessionReport } from '../hands/files.js';
import { power } from '../hands/power.js';
import { alertUser, resolveAlert, sendIMessage } from '../guard/notify.js';
import { stopRequestedSince } from '../guard/stop.js';
import { APP_NAME } from './brand.js';
import { T, lang } from './i18n.js';

const MIN = 60_000;
const LATE_MS = 10 * MIN;
const EXPIRES_MS = 24 * 60 * MIN;
export const POWER = new Set(['lock', 'sleep', 'restart', 'shutdown']);
const OFF = new Set(['restart', 'shutdown']);
const ACTIONS = new Set([...POWER, 'remind', 'command', 'report']);
const sleep = ms => new Promise(r => setTimeout(r, ms));
export const timerTitle = () => T('Zamanlayıcı', 'Timer'); // notices from here (the bar shows them without "Handry goes on by itself")

const file = () => path.join(HOME, 'timers.json');
const lockFile = () => path.join(HOME, 'timers.lock');
const tickMs = () => Number(process.env.JEVIS_TIMER_TICK_MS) || 5000;
// A condition must still hold this long later (a Claude session pauses between steps).
const stableMs = () => Number(process.env.JEVIS_TIMER_STABLE_MS) || MIN;

// ---------------------------------------------------------------------------
// Saying times: "01:01'de", "03:30'da", "yarın 09:00'da"; in English "at 1:01 AM", "tomorrow at 9:00 AM"
// ---------------------------------------------------------------------------

const ONES = ['sıfır', 'bir', 'iki', 'üç', 'dört', 'beş', 'altı', 'yedi', 'sekiz', 'dokuz'];
const TENS = ['', 'on', 'yirmi', 'otuz', 'kırk', 'elli'];
const lastWord = n => (n === 0 ? 'sıfır' : n % 10 ? ONES[n % 10] : TENS[Math.floor(n / 10)]);

/** The locative (de/da/te/ta) or ablative (den/dan/ten/tan) ending for a time, by how it is read out. */
function ending(t, kind = 'de') {
  const d = new Date(t);
  const word = lastWord(d.getMinutes() || d.getHours() % 24);
  const vowel = [...word].reverse().find(c => 'aeıioöuü'.includes(c));
  const back = 'aıou'.includes(vowel);
  const hard = 'çfhkpsşt'.includes(word.at(-1));
  return `${hard ? 't' : 'd'}${back ? 'a' : 'e'}${kind === 'den' ? 'n' : ''}`;
}

const hhmm = t => T(new Date(t).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }), new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\u202f/g, ' '));

/** kind 'den': "from then on" ("01:01'den" / "after 1:01 AM"). */
function whenText(t, kind = 'de') {
  const days = Math.round((new Date(new Date(t).toDateString()) - new Date(new Date().toDateString())) / 86400000);
  if (lang() === 'en') {
    const day = days === 0 ? '' : days === 1 ? 'tomorrow ' : `on ${new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} `;
    return `${day}${kind === 'den' ? 'after' : 'at'} ${hhmm(t)}`;
  }
  const day = days === 0 ? '' : days === 1 ? 'yarın ' : `${new Date(t).toLocaleDateString('tr-TR')} `;
  return `${day}${hhmm(t)}'${ending(t, kind)}`;
}

const holding = action => T(
  { lock: 'kilitlemeyi', sleep: 'uyutmayı', restart: 'yeniden başlatmayı', shutdown: 'kapatmayı', remind: 'hatırlatmayı', command: 'işi' },
  { lock: 'locking the screen', sleep: 'putting the Mac to sleep', restart: 'restarting the Mac', shutdown: 'shutting down the Mac', remind: 'the reminder', command: 'the task' }
)[action];
const powerText = action => T(
  { lock: 'ekranı kilitle', sleep: "Mac'i uyut", restart: "Mac'i yeniden başlat", shutdown: "Mac'i kapat" },
  { lock: 'lock the screen', sleep: 'put the Mac to sleep', restart: 'restart the Mac', shutdown: 'shut down the Mac' }
)[action];
const future = action => T(
  { lock: 'ekranı kilitleyeceğim', sleep: "Mac'i uyutacağım", restart: "Mac'i yeniden başlatacağım", shutdown: "Mac'i kapatacağım", report: 'sana son cevabını yazacağım' },
  { lock: "I'll lock the screen", sleep: "I'll put the Mac to sleep", restart: "I'll restart the Mac", shutdown: "I'll shut down the Mac", report: "I'll send you its last answer" }
)[action];
const whatText = job => (job.action === 'remind' ? T(`"${job.text}" diye hatırlat`, `remind you "${job.text}"`) : job.action === 'command' ? T(`"${job.text}" komutunu çalıştır`, `run "${job.text}"`) : job.action === 'report' ? T('haber ver', 'let you know') : powerText(job.action));
const futureText = job => (job.action === 'remind' ? T(`"${job.text}" diye hatırlatacağım`, `I'll remind you "${job.text}"`) : job.action === 'command' ? T(`"${job.text}" komutunu çalıştıracağım`, `I'll run "${job.text}"`) : future(job.action));

function conditionText(u) {
  if (lang() === 'en') {
    if (u.claude) return `when ${u.claude.map(s => `"${s.name}"`).join(', ')} ${u.claude.length > 1 ? 'are' : 'is'} done`;
    const where = u.app ? `the ${u.app} window` : `the "${u.page}" tab`;
    if (u.app && u.closed) return `when ${u.app} quits`;
    return u.contains ? `when "${u.contains}" shows up in ${where}` : `when "${u.expect}" is true in ${where}`;
  }
  if (u.claude) return `${u.claude.map(s => `"${s.name}"`).join(', ')} bitince`;
  const where = u.app ? `${u.app} penceresinde` : `"${u.page}" sekmesinde`;
  if (u.app && u.closed) return `${u.app} kapanınca`;
  return u.contains ? `${where} "${u.contains}" görününce` : `${where} "${u.expect}" olunca`;
}

const capital = t => t.charAt(0).toLocaleUpperCase(T('tr', 'en')) + t.slice(1);
const whatLabel = job => (job.action === 'command' ? capital(job.text) : job.action === 'remind' ? T(`Hatırlat: "${job.text}"`, `Remind: "${job.text}"`) : capital(whatText(job)));

function whenPart(job) {
  const parts = [];
  if (job.at && (!job.until || job.at > job.created + 5000)) parts.push(job.until ? T(`${whenText(job.at, 'den')} sonra`, whenText(job.at, 'den')) : whenText(job.at));
  if (job.until) parts.push(conditionText(job.until));
  return parts.join(', ');
}

/** "⏰ 01:01'de → ekranı kilitle", "👀 "iş geliştirme" bitince → Mac'i kapat"; "⏰ at 1:01 AM → lock the screen". */
export function describe(job) {
  return `${job.until ? '👀' : '⏰'} ${whenPart(job)} → ${whatText(job)}`;
}

// ---------------------------------------------------------------------------
// The task list
// ---------------------------------------------------------------------------

export function listJobs() {
  try {
    const jobs = JSON.parse(fs.readFileSync(file(), 'utf-8'));
    return Array.isArray(jobs) ? jobs : [];
  } catch {
    return [];
  }
}

function saveJobs(jobs) {
  fs.mkdirSync(HOME, { recursive: true });
  const tmp = `${file()}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(jobs, null, 1));
  fs.renameSync(tmp, file());
}

function updateJob(id, patch) {
  const jobs = listJobs();
  const job = jobs.find(j => j.id === id);
  if (!job) return null;
  Object.assign(job, patch);
  saveJobs(jobs);
  return job;
}

function removeJob(id) {
  const jobs = listJobs();
  const left = jobs.filter(j => j.id !== id);
  if (left.length === jobs.length) return false;
  saveJobs(left);
  return true;
}

/** Cancels by id, 'all', or a filter; returns the cancelled tasks. */
export function cancelJobs(which = 'all') {
  const jobs = listJobs();
  const gone = jobs.filter(j => which === 'all' || j.id === which || (typeof which === 'function' && which(j)));
  if (gone.length) saveJobs(jobs.filter(j => !gone.includes(j)));
  return gone;
}

/** "HH:MM" (next time it comes), "YYYY-MM-DDTHH:MM[:SS]" (local) or ms → ms. */
export function resolveAt(at, now = Date.now()) {
  if (typeof at === 'number') return at;
  const clock = String(at).trim().match(/^(\d{1,2})[:.](\d{2})$/);
  if (clock) {
    const d = new Date(now);
    d.setHours(Number(clock[1]), Number(clock[2]), 0, 0);
    if (d.getTime() <= now) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  const t = new Date(String(at).trim()).getTime();
  if (Number.isNaN(t)) throw new Error(T(`Saati anlayamadım: "${at}". "HH:MM" ya da "YYYY-MM-DDTHH:MM" ver.`, `I couldn't read the time "${at}". Give "HH:MM" or "YYYY-MM-DDTHH:MM".`));
  return t;
}

/** Which Claude Code sessions to wait for: the working (or waiting) ones now, or the named ones. */
export function claudeTargets(names = []) {
  const all = claudeSessions().filter(s => !s.jevis);
  const wanted = names.map(n => String(n).toLocaleLowerCase('tr'));
  const picked = wanted.length
    ? all.filter(s => wanted.some(w => s.name.toLocaleLowerCase('tr').includes(w) || s.project.toLocaleLowerCase('tr').includes(w)))
    : all.filter(s => s.state !== 'idle');
  return picked.map(s => ({ pid: s.pid, sessionId: s.sessionId, name: s.name, project: s.project }));
}

export function addJob({ action, text = '', at = null, until = null, every, countdown, said = '', source = '', chatId = null }) {
  if (!ACTIONS.has(action)) throw new Error(T(`Bilinmeyen iş: ${action}`, `Unknown task: ${action}`));
  if ((action === 'remind' || action === 'command') && !String(text).trim()) throw new Error(T('Ne hatırlatayım ya da ne yapayım? text boş.', 'What should I remind you of, or do? text is empty.'));
  if (!at && !until) throw new Error(T('Ne zaman? Bir saat (at), bir süre (in_minutes) ya da bir koşul (until) ver.', 'When? Give a time (at), a delay (in_minutes) or a condition (until).'));
  const now = Date.now();
  const job = {
    id: `t${now.toString(36)}${Math.random().toString(36).slice(2, 4)}`,
    created: now,
    said,
    source,
    action,
    text,
    at: at ?? null,
    until: until ?? null,
    every: every || (until?.claude ? 30_000 : 5 * MIN),
    countdown: countdown ?? (OFF.has(action) ? 30 : 0),
    expires: until ? now + EXPIRES_MS : null,
    nextCheck: now,
    chatId
  };
  job.label = { what: whatLabel(job), when: capital(whenPart(job)) }; // Handry.app's menu shows these as they are
  saveJobs([...listJobs(), job]);
  return job;
}

/** What Handry says after setting a task. */
export function confirmText(job) {
  if (lang() === 'en') {
    const lines = [`OK: ${futureText(job)} ${whenPart(job)}.`];
    const every = (n, unit) => (n === 1 ? `every ${unit}` : `every ${n} ${unit}s`);
    if (job.until) lines.push(`I'm checking ${job.every >= MIN ? every(Math.round(job.every / MIN), 'minute') : every(Math.max(1, Math.round(job.every / 1000)), 'second')}.`);
    if (OFF.has(job.action)) lines.push(`First there's a ${job.countdown}-second countdown; to cancel, press ⌥Esc or say "stop".`);
    lines.push('If you change your mind, say "cancel the timers".');
    return lines.join(' ');
  }
  const lines = [`Tamam: ${whenPart(job)} ${futureText(job)}.`];
  if (job.until) lines.push(`${job.every >= MIN ? `${Math.round(job.every / MIN)} dakikada` : `${Math.max(1, Math.round(job.every / 1000))} saniyede`} bir bakıyorum.`);
  if (OFF.has(job.action)) lines.push(`Önce ${job.countdown} sn geri sayım olacak; iptal için ⌥Esc'ye bas ya da "dur" de.`);
  lines.push('Vazgeçersen "zamanlayıcıyı iptal et" de.');
  return lines.join(' ');
}


/** The list order: a running countdown first, then the soonest time, then the watches. */
export function sortedJobs(jobs = listJobs()) {
  const rank = j => (j.firing ? 0 : j.until && !j.at ? 2 : 1);
  return [...jobs].sort((a, b) => rank(a) - rank(b) || (a.at || 0) - (b.at || 0) || a.created - b.created);
}

/** One task for the timer list in the window and the bar. */
export function jobView(job) {
  return {
    id: job.id,
    kind: job.until ? 'watch' : 'timer',
    action: job.action,
    what: whatLabel(job),
    when: capital(whenPart(job)),
    at: job.at,
    said: job.said || '',
    note: job.lastNote || '',
    firing: job.firing ? { started: job.firing, seconds: job.countdown } : null,
    created: job.created,
    chatId: job.chatId || null,
    source: job.source || ''
  };
}

export function formatJobs(jobs = listJobs()) {
  if (!jobs.length) return T('Bekleyen zamanlanmış iş yok.', 'Nothing is scheduled.');
  return jobs.map((j, i) => `${i + 1}. ${describe(j)}${j.lastNote ? ` — ${T('son bakış', 'last check')}: ${j.lastNote}` : ''} (id ${j.id})`).join('\n');
}

// ---------------------------------------------------------------------------
// Checking conditions
// ---------------------------------------------------------------------------

async function textCondition(u, text, where, strict) {
  if (u.contains) {
    const met = text.toLocaleLowerCase('tr').includes(String(u.contains).toLocaleLowerCase('tr'));
    return { met, note: met ? T(`"${u.contains}" göründü`, `"${u.contains}" showed up`) : T(`"${u.contains}" henüz yok`, `no "${u.contains}" yet`) };
  }
  const v = await jev.checkState(u.expect, { ...where, text: text.slice(0, 6000) });
  return { met: v.p >= (strict ? 0.75 : 0.6), note: T(`%${Math.round(v.p * 100)} "${u.expect}"`, `${Math.round(v.p * 100)}% "${u.expect}"`) };
}

export async function checkCondition(job) {
  const u = job.until;
  if (u.claude) {
    const now = claudeSessions();
    const status = u.claude.map(t => {
      const s = now.find(x => x.pid === t.pid && (!t.sessionId || x.sessionId === t.sessionId));
      return { t, s, state: s ? s.state : 'gone' };
    });
    return {
      met: status.every(x => x.state === 'idle' || x.state === 'gone'),
      waiting: status.filter(x => x.state === 'waiting').map(x => x.t.name),
      note: status.map(x => `${x.t.name}: ${x.s ? stateText(x.s) : T('kapandı', 'closed')}`).join(' · ')
    };
  }
  const strict = POWER.has(job.action);
  if (u.app) {
    const wanted = String(u.app).toLocaleLowerCase('tr');
    const running = (await desktop.apps()).find(a => a.name.toLocaleLowerCase('tr') === wanted || a.bundleId.toLowerCase() === wanted)
      || (await desktop.apps()).find(a => a.name.toLocaleLowerCase('tr').includes(wanted));
    if (u.closed) return { met: !running, note: running ? T(`${u.app} açık`, `${u.app} is open`) : T(`${u.app} kapandı`, `${u.app} quit`) };
    if (!running) return { met: false, note: T(`${u.app} açık değil`, `${u.app} is not open`) };
    const r = await desktop.read({ app: running.pid, remember: false });
    return textCondition(u, [r.window, ...r.texts, ...r.elements.map(e => e.name)].join('\n'), { app: r.app, window: r.window }, strict);
  }
  if (u.page) {
    const tab = await browser.tabText(u.page);
    return textCondition(u, `${tab.title}\n${tab.text}`, { url: tab.url, title: tab.title }, strict);
  }
  return { met: false, note: T('koşul anlaşılmadı', 'the condition was not understood') };
}

// ---------------------------------------------------------------------------
// Running them
// ---------------------------------------------------------------------------

let loopTimer = null;
let lastTick = 0;
let runCommandFn = null;
let awake = null;
const firing = new Set();

const pidAlive = pid => { try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; } };

/** The pid of the process running the tasks, or null. */
export function schedulerAlive() {
  try {
    const { pid } = JSON.parse(fs.readFileSync(lockFile(), 'utf-8'));
    return pid && pidAlive(pid) ? pid : null;
  } catch {
    return null;
  }
}

function takeLock() {
  const holder = schedulerAlive();
  if (holder && holder !== process.pid) return false;
  if (holder !== process.pid) {
    fs.mkdirSync(HOME, { recursive: true });
    fs.writeFileSync(lockFile(), JSON.stringify({ pid: process.pid, at: Date.now() }));
  }
  return true;
}

/** Makes sure something runs the tasks: the Handry app (its server) is opened in the background if needed. */
export async function ensureScheduler() {
  if (schedulerAlive()) return true;
  if (process.env.JEVIS_HOME || process.env.JEVIS_NO_TIMERS === '1') return false; // tests, throwaway homes
  const app = [`${APP_NAME}.app`, 'Inaro.app', 'Foxie.app', 'Handry.app'].map(name => path.join(os.homedir(), 'Applications', name)).find(p => fs.existsSync(p));
  if (!app) return false;
  execFile('open', ['-g', app], () => {});
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    if (schedulerAlive()) return true;
  }
  return false;
}

// While a power task waits, the Mac must not fall asleep on its own (it would miss the time).
function keepAwake(on) {
  if (process.env.JEVIS_TEST_POWER === 'record') return;
  if (on && !awake) {
    awake = spawn('caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore' });
    awake.on('exit', () => { awake = null; });
  } else if (!on && awake) {
    awake.kill();
    awake = null;
  }
}

/** `run(text)` runs a Handry command (the server passes one that waits until nothing else runs). */
export function startScheduler({ run } = {}) {
  if (process.env.JEVIS_NO_TIMERS === '1' || loopTimer) return;
  runCommandFn = run || null;
  lastTick = Date.now();
  const loop = async () => {
    try {
      if (takeLock()) await tick();
    } catch (err) {
      console.error(`Zamanlayıcı: ${err.message}`);
    }
    if (loopTimer) loopTimer = setTimeout(loop, tickMs());
  };
  loopTimer = setTimeout(loop, 0);
}

export function stopScheduler() {
  clearTimeout(loopTimer);
  loopTimer = null;
  keepAwake(false);
  if (schedulerAlive() === process.pid) fs.rmSync(lockFile(), { force: true });
}

async function tick() {
  const now = Date.now();
  const woke = now - lastTick > Math.max(90_000, tickMs() * 6); // this process was frozen: the Mac slept
  lastTick = now;
  const jobs = listJobs();
  keepAwake(jobs.some(j => OFF.has(j.action) || j.action === 'sleep' || j.until));
  for (const job of jobs) {
    if (firing.has(job.id)) continue;
    const off = OFF.has(job.action) || job.action === 'sleep';
    if (job.expires && now > job.expires) {
      removeJob(job.id);
      alertUser(T(`Beklediğim şey 24 saatte olmadı, bıraktım: ${describe(job)}`, `What I was waiting for didn't happen in 24 hours, so I stopped: ${describe(job)}`), { title: timerTitle(), speak: false });
      continue;
    }
    if (woke && off) {
      updateJob(job.id, { notBefore: now + LATE_MS });
      alertUser(T(`Mac uykudan uyandı. Bekleyen bir iş var: ${describe(job)}. 10 dakika bir şey yapmayacağım; istemiyorsan "zamanlayıcıyı iptal et" de.`, `The Mac woke up from sleep. A task is waiting: ${describe(job)}. I won't do anything for 10 minutes; if you don't want it, say "cancel the timers".`), { title: timerTitle(), speak: false });
      continue;
    }
    if (job.notBefore && now < job.notBefore) continue;
    if (job.at && now < job.at) continue;
    if (job.at && !job.until && off && now - job.at > LATE_MS) {
      removeJob(job.id);
      alertUser(T(`Mac uyuduğu için ${whenText(job.at)} yapılacak işi zamanında yapamadım, geç de yapmadım: ${describe(job)}`, `The Mac was asleep, so I couldn't do the task due ${whenText(job.at)} on time, and I didn't do it late: ${describe(job)}`), { title: timerTitle(), speak: false });
      continue;
    }
    if (job.until) {
      if (now < (job.nextCheck || 0)) continue;
      let r;
      try { r = await checkCondition(job); } catch (err) { r = { met: false, note: `${T('bakılamadı', 'could not check')}: ${err.message}` }; }
      const patch = { lastCheck: now, lastNote: r.note, nextCheck: now + job.every };
      // A Claude session that needs an answer can't finish: tell the user once (an iMessage if they don't come).
      if (r.waiting?.length && !job.waitAlert) {
        const who = r.waiting.map(n => `"${n}"`).join(', ');
        patch.waitAlert = job.action === 'report'
          ? alertUser(T(`${who} senden cevap bekliyor (VS Code'da).`, `${who} is waiting for your answer (in VS Code).`), { title: 'Claude', imessage: true, speak: false })
          : alertUser(T(`${who} senden cevap bekliyor. O bitmeden ${holding(job.action)} bekletiyorum.`, `${who} is waiting for your answer. Until it's done, I'm holding off on ${holding(job.action)}.`), { title: timerTitle(), imessage: true, speak: false });
      } else if (!r.waiting?.length && job.waitAlert) {
        resolveAlert(job.waitAlert);
        patch.waitAlert = null;
      }
      if (!r.met) {
        updateJob(job.id, { ...patch, metSince: null });
        continue;
      }
      const settle = job.action === 'report' ? Math.min(stableMs(), 20_000) : stableMs();
      if (!job.metSince || now - job.metSince < settle) {
        const since = job.metSince || now;
        updateJob(job.id, { ...patch, metSince: since, nextCheck: since + settle });
        continue;
      }
      updateJob(job.id, patch);
      job.lastNote = r.note;
    }
    fire(job);
  }
}

/** A Claude Code session is done: its last answer on the Handry bar, and by iMessage if the user doesn't come. */
function report(job) {
  const lines = job.until.claude.map(t => {
    const last = t.sessionId ? sessionReport(t.sessionId)?.lastReply : '';
    const said = last ? (last.length > 600 ? `${last.slice(0, 599)}…` : last) : '';
    return T(`"${t.name}" (${t.project}) bitti.${said ? ` Son cevabı: ${said}` : ''}`, `"${t.name}" (${t.project}) is done.${said ? ` Its last answer: ${said}` : ''}`);
  });
  if (job.waitAlert) resolveAlert(job.waitAlert);
  alertUser(lines.join('\n'), { title: 'Claude', imessage: true, speak: false });
}

function reasonOf(job) {
  if (job.until?.claude) return T(`Claude işleri bitti (${job.until.claude.map(s => s.name).join(', ')}).`, `The Claude sessions are done (${job.until.claude.map(s => s.name).join(', ')}).`);
  if (job.until) return T(`Beklediğin oldu (${job.lastNote}).`, `What you were waiting for happened (${job.lastNote}).`);
  return T(`Saat ${hhmm(job.at)} oldu.`, `It's ${hhmm(job.at)}.`);
}

async function fire(job) {
  firing.add(job.id);
  try {
    const reason = reasonOf(job);
    if (OFF.has(job.action) && job.countdown > 0) {
      const started = Date.now();
      const restart = job.action === 'restart';
      const alertId = alertUser(T(`${reason} Mac ${job.countdown} saniye sonra ${restart ? 'yeniden başlayacak' : 'kapanacak'}. İptal için ⌥Esc'ye bas ya da "dur" de.`, `${reason} The Mac will ${restart ? 'restart' : 'shut down'} in ${job.countdown} seconds. To cancel, press ⌥Esc or say "stop".`), { title: timerTitle(), speak: false });
      updateJob(job.id, { firing: started });
      while (Date.now() - started < job.countdown * 1000) {
        await sleep(500);
        if (!listJobs().some(j => j.id === job.id) || stopRequestedSince(started)) {
          resolveAlert(alertId);
          removeJob(job.id);
          alertUser(restart ? T('Yeniden başlatma iptal edildi.', 'Restart cancelled.') : T('Kapatma iptal edildi.', 'Shutdown cancelled.'), { title: timerTitle(), speak: false });
          return;
        }
      }
      resolveAlert(alertId);
      if (!removeJob(job.id)) return; // cancelled at the last moment
      // The user finds out on the phone what happened while they were away.
      await Promise.race([sendIMessage(`${APP_NAME}: ${reason} ${T(`Mac'i ${restart ? 'yeniden başlatıyorum' : 'kapatıyorum'}.`, restart ? 'Restarting the Mac.' : 'Shutting down the Mac.')}`), sleep(20000)]).catch(() => {});
      await power(job.action);
      return;
    }
    removeJob(job.id);
    if (POWER.has(job.action)) await power(job.action);
    else if (job.action === 'remind') alertUser(job.text, { title: T('Hatırlatma', 'Reminder') });
    else if (job.action === 'report') report(job);
    else if (runCommandFn) await runCommandFn(job.text, job);
    else {
      const { runCommand } = await import('./runner.js');
      await runCommand({ text: job.text, source: 'timer', chatId: job.chatId, switchChat: false });
    }
  } catch (err) {
    alertUser(T(`Zamanlanmış iş yapılamadı (${describe(job)}): ${err.message}`, `A scheduled task didn't work (${describe(job)}): ${err.message}`), { title: timerTitle(), imessage: true });
  } finally {
    firing.delete(job.id);
  }
}

// ---------------------------------------------------------------------------
// Understanding it in Turkish or English, without an LLM (the fast path uses this)
// ---------------------------------------------------------------------------

const NUMS = { bir: 1, iki: 2, 'üç': 3, 'dört': 4, 'beş': 5, 'altı': 6, yedi: 7, sekiz: 8, dokuz: 9, on: 10, 'on beş': 15, yirmi: 20, 'yirmi beş': 25, otuz: 30, 'kırk': 40, 'kırk beş': 45, elli: 50, 'altmış': 60, 'yarım': 0.5, 'çeyrek': 0.25 };
const NUM = '(\\d+(?:[.,]\\d+)?|on beş|yirmi beş|kırk beş|bir|iki|üç|dört|beş|altı|yedi|sekiz|dokuz|on|yirmi|otuz|kırk|elli|altmış|yarım|çeyrek)';
const START = '(?<![\\p{L}\\d])';
const END = '(?=$|[\\s.,!?;:])';
const UNIT = { saat: 60, sa: 60, dakika: 1, dk: 1, saniye: 1 / 60, sn: 1 / 60 };
const num = w => NUMS[w] ?? Number(String(w).replace(',', '.'));

// "3 saat sonra", "yarım saat sonra", "bir buçuk saat sonra", "1 saat 20 dakika sonra", "10 dk içinde"
function relative(t) {
  const re = new RegExp(`${START}${NUM}\\s*(buçuk\\s*)?(saat|sa|dakika|dk|saniye|sn)\\.?(?:\\s*(?:ve\\s*)?${NUM}\\s*(dakika|dk|saniye|sn)\\.?)?\\s*(?:sonra|içinde)${END}`, 'u');
  const m = t.match(re);
  if (!m) return null;
  let minutes = num(m[1]) * UNIT[m[3]] + (m[2] ? 0.5 * UNIT[m[3]] : 0);
  if (m[4]) minutes += num(m[4]) * UNIT[m[5]];
  return minutes > 0 ? { minutes, match: m[0] } : null;
}

// "saat 3'te", "saat 01:01 olunca", "gece 2'de", "23:30'da", "akşam 8 gibi"
function absolute(t, now, tomorrow) {
  const re = new RegExp(`${START}(?:(saat|gece|sabah|akşam|öğleden sonra|öğlen)\\s*)?(\\d{1,2})(?:[:.](\\d{2}))?\\s*(?:['’]?\\s*(?:de|da|te|ta|den|dan|ten|tan)|\\s+(?:olunca|olduğunda|gibi|civarı|civarında|sularında))${END}`, 'u');
  const m = t.match(re);
  if (!m) return null;
  const [, word, hs, ms] = m;
  if (!word && ms === undefined && !/['’]/.test(m[0])) return null; // "3te" alone is too loose
  const h = Number(hs);
  const min = Number(ms || 0);
  if (h > 23 || min > 59) return null;
  let hours;
  if (word === 'akşam' || word === 'öğleden sonra') hours = [h < 12 ? h + 12 : h];
  else if (word === 'sabah') hours = [h];
  else if (word === 'gece') hours = [h >= 7 && h < 12 ? h + 12 : h];
  else if (word === 'öğlen') hours = [h < 7 ? h + 12 : h];
  else if (h >= 13 || h === 0 || hs.startsWith('0')) hours = [h];
  else hours = [h, (h + 12) % 24];
  const at = soonest(hours, min, now, tomorrow);
  return at ? { at, match: m[0] } : null;
}

/** The first of these hours (today or tomorrow) still to come, or null. */
function soonest(hours, min, now, tomorrow) {
  const candidates = [];
  for (const hh of hours) {
    for (const day of tomorrow ? [1] : [0, 1]) {
      const d = new Date(now);
      d.setDate(d.getDate() + day);
      d.setHours(hh, min, 0, 0);
      if (d.getTime() > now + 5000) candidates.push(d.getTime());
    }
  }
  return candidates.length ? Math.min(...candidates) : null;
}

const END_RE = '(?=$|[\\s.,!?;:])';
const NOUN = "(?:bilgisayar(?:ı|ımı)?|pc(?:\\s*['’]?\\s*yi)?|mac(?:\\s*['’]?\\s*i|ı)?|makine(?:yi|mi)?|laptop(?:u|umu)?|sistemi)";
const FILL = '(?:\\s+(?:de|da|hemen|şimdi|tamamen|direkt|direk|bi|bir|artık|lütfen))*';
const ACTION_RES = {
  lock: [
    new RegExp(`${START}(?:ekran(?:ı)?|${NOUN})${FILL}\\s+kilitle(?:r|yebilir|yin|sin)?${END_RE}`, 'u'),
    new RegExp(`${START}kilitleme${END_RE}`, 'u')
  ],
  sleep: [
    new RegExp(`${START}(?:${NOUN}${FILL}\\s+uyut(?:ur|abilir|sun)?|uyku(?:ya|\\s+moduna)\\s+(?:al(?:ır|abilir)?|geçir|sok|geç))${END_RE}`, 'u'),
    new RegExp(`${START}(?:uyutma|uyku(?:ya|\\s+moduna)\\s+(?:da\\s+)?(?:alma|sokma|geçirme))${END_RE}`, 'u')
  ],
  restart: [
    new RegExp(`${START}${NOUN}${FILL}\\s+(?:yeniden\\s+başlat(?:ır|abilir|sın)?|resetle|restart\\s+at|reset\\s+at)${END_RE}`, 'u'),
    new RegExp(`${START}yeniden\\s+başlatma${END_RE}`, 'u')
  ],
  shutdown: [
    new RegExp(`${START}(?:${NOUN}${FILL}\\s+(?:kapat(?:ır|abilir|sın)?|kapa|kapansın)|kapat\\s+${NOUN})${END_RE}`, 'u'),
    new RegExp(`${START}(?:kapatma|kapama)${END_RE}`, 'u')
  ]
};

const CANCEL = /(zamanlayıcı|zamanlanmış|bekleyen\s+iş|nöbet|geri\s+sayım|kapatmayı|kapatmayi|kapanmayı|kilitlemeyi|uyutmayı|hatırlatmayı)\S*[^.!?]{0,30}?(iptal|sil|kaldır|vazgeç|durdur|boşver|kapat)|(iptal\s+et|vazgeç|boşver)\S*\s+(kapatma|zamanlayıcı|kilitleme|uyutma|hatırlatma)/u;
const LIST = /(zamanlayıcı|zamanlanmış|bekleyen|nöbet|kurduğun)\S*[^.!?]{0,30}?(neler|ne\s+var|göster|listele|var\s*m[ıi]|hangi)/u;
const CLAUDE_DONE = /(iş|görev|claude|vs\s*code|vscode|kod|oturum|proje)\S*[^.!?]{0,60}?(bit(?:ince|tiğinde|tikten\s+sonra|irince|irdiğinde|irdikten\s+sonra|ir\s+bitmez)|tamamlan(?:ınca|dığında))/u;
const CONDITION = /(bitince|bittiğinde|bitirince|olunca|olduğunda|gelince|geldiğinde|kapanınca|kapandığında|açılınca|tamamlanınca|görününce|dakikada\s+bir|saatte\s+bir|kontrol\s+et)/u;
const LATER = /(haftaya|pazartesi|salı|çarşamba|perşembe|cuma|cumartesi|pazar(?![\p{L}])|ayın|sonra\b)/u;

const TR = { cancel: CANCEL, list: LIST, relative, absolute, tomorrow: /yarın/u, claude: CLAUDE_DONE, condition: CONDITION, later: LATER, actions: ACTION_RES, cut: ' ' };

// English: "in 10 minutes", "in an hour and a half", "at 3 pm", "tomorrow at 9", "when the Claude sessions are done"
const EN_NUMS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, 'twenty five': 25, thirty: 30, forty: 40, 'forty five': 45, fifty: 50, sixty: 60, 'half an': 0.5, 'half a': 0.5, 'a quarter of an': 0.25, 'quarter of an': 0.25, 'a couple of': 2, 'a few': 3 };
const EN_NUM = '(\\d+(?:[.,]\\d+)?|a\\s+quarter\\s+of\\s+an?|quarter\\s+of\\s+an?|half\\s+an?|a\\s+couple\\s+of|a\\s+few|twenty\\s+five|forty\\s+five|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty)';
const EN_AMOUNT = `${EN_NUM}(\\s+and\\s+a\\s+half)?\\s*(hours?|hrs?|h|minutes?|mins?|seconds?|secs?)\\.?(\\s+and\\s+a\\s+half)?(?:\\s*(?:and\\s+)?${EN_NUM}\\s*(minutes?|mins?|seconds?|secs?)\\.?)?`;
const EN_REL = [new RegExp(`\\b(?:in|after|within)\\s+${EN_AMOUNT}${END}`), new RegExp(`\\b${EN_AMOUNT}\\s+from\\s+now${END}`)];
const numEn = w => EN_NUMS[w.replace(/\s+/g, ' ')] ?? Number(String(w).replace(',', '.'));
const unitEn = u => (u.startsWith('h') ? 60 : u.startsWith('m') ? 1 : 1 / 60);

function relativeEn(t) {
  const m = t.match(EN_REL[0]) || t.match(EN_REL[1]);
  if (!m) return null;
  let minutes = numEn(m[1]) * unitEn(m[3]) + (m[2] || m[4] ? 0.5 * unitEn(m[3]) : 0);
  if (m[5]) minutes += numEn(m[5]) * unitEn(m[6]);
  return minutes > 0 ? { minutes, match: m[0] } : null;
}

const EN_AT = /(?:\b(tonight|this\s+(?:morning|afternoon|evening)|morning|afternoon|evening|night)\s+)?\b(?:at|around|about)\s+(?:(noon|midnight)|(\d{1,2})(?:[:.](\d{2}))?(?:\s*(a\.?m\.?|p\.?m\.?)|\s*o'?clock)?)(?:\s+(in\s+the\s+(?:morning|afternoon|evening)|at\s+night|tonight))?(?=$|[\s.,!?;:])/;
const EN_AMPM = /\b(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?=$|[\s.,!?;:])/;
const EN_POWER_WORD = /\b(lock|sleep|restart|reboot|shut|turn\s+off|switch\s+off|power)\b/;

// "at 3", "at 3 pm", "at 15:30", "tonight at 11", "at 8 in the evening", "at noon", "9:30 am"
function absoluteEn(t, now, tomorrow) {
  let word, special, hs, ms, ampm, after;
  let m = t.match(EN_AT);
  if (m) [, word, special, hs, ms, ampm, after] = m;
  else if ((m = t.match(EN_AMPM))) [, hs, ms, ampm] = m;
  if (!m) return null;
  const h = special === 'noon' ? 12 : special === 'midnight' ? 0 : Number(hs);
  const min = Number(ms || 0);
  if (h > 23 || min > 59) return null;
  // a bare "at 3" is a time only next to a power word ("look at 3 files" is not)
  if (!special && !ampm && ms === undefined && !word && !after && !/o'?clock/.test(m[0]) && !EN_POWER_WORD.test(t)) return null;
  const part = String(word || after || '').replace(/^(?:in\s+the|at|this)\s+/, '');
  let hours;
  if (special) hours = [h];
  else if (ampm) {
    if (h < 1 || h > 12) return null;
    hours = [ampm.startsWith('p') ? (h % 12) + 12 : h % 12];
  } else if (part === 'evening' || part === 'afternoon') hours = [h < 12 ? h + 12 : h];
  else if (part === 'morning') hours = [h];
  else if (part === 'night' || part === 'tonight') hours = [h >= 7 && h < 12 ? h + 12 : h];
  else if (h >= 13 || h === 0 || hs.startsWith('0')) hours = [h];
  else hours = [h, (h + 12) % 24];
  const at = soonest(hours, min, now, tomorrow);
  return at ? { at, match: m[0] } : null;
}

// A command verb stands at the start, after a comma, or after words like "please", "can you", "and".
const LEAD = "(?:^|[.,!?;:]|\\b(?:please|pls|kindly|ok|okay|hey|and|then|also|now|just|so|you(?:\\s+to)?|go\\s+ahead\\s+and|handry|done|finished|finishes))\\s*";
const EN_NOUN = '(?:mac|computer|pc|laptop|machine|system)';
const THE = "(?:(?:the|my|this)\\s+)?";
// After a bare "shut down" / "restart": nothing, or words about when, not an app's name ("shut down Spotify")
const BARE = "(?=$|[\\s.,!?;:])(?!\\s+(?:the|my|this|that|all|every|a|an)\\b)(?!\\s+(?!(?:when|once|after|as|at|in|now|right|tonight|tomorrow|please|then|and|but|so|for|by|around|about|if|before|until|later|immediately|asap)\\b)[a-z]{2,})";
const NOT = "\\b(?:don'?t|do\\s+not|never|no\\s+need\\s+to)\\s+";
const EN_ACTIONS = {
  lock: [
    new RegExp(`${LEAD}lock(?:\\s+up)?\\s+${THE}(?:screen|${EN_NOUN})\\b`),
    new RegExp(`${NOT}lock\\b`)
  ],
  sleep: [
    new RegExp(`${LEAD}(?:(?:put|send)\\s+${THE}(?:${EN_NOUN}|it)\\s+to\\s+sleep|sleep\\s+${THE}${EN_NOUN})\\b`),
    new RegExp(`${NOT}(?:put\\s+${THE}(?:${EN_NOUN}|it)\\s+to\\s+sleep|sleep\\s+${THE}${EN_NOUN}|let\\s+${THE}(?:${EN_NOUN}|it)\\s+sleep)\\b`)
  ],
  restart: [
    new RegExp(`${LEAD}(?:restart|reboot)(?:\\s+${THE}${EN_NOUN})?${BARE}`),
    new RegExp(`${NOT}(?:restart|reboot)\\b`)
  ],
  shutdown: [
    new RegExp(`${LEAD}(?:(?:shut\\s*down|power\\s+(?:off|down))(?:\\s+${THE}${EN_NOUN})?${BARE}|(?:turn|switch)\\s+off\\s+${THE}${EN_NOUN}\\b|(?:shut|turn|switch|power)\\s+${THE}${EN_NOUN}\\s+(?:down|off)\\b)`),
    new RegExp(`${NOT}(?:shut\\s*down|power\\s+(?:off|down)|(?:turn|switch)\\s+off\\s+${THE}${EN_NOUN}|(?:shut|turn|switch|power)\\s+${THE}(?:${EN_NOUN}|it)\\s+(?:down|off))\\b`)
  ]
};
const EN_CANCEL = /\b(?:cancel|call\s+off|abort|clear|stop|kill|delete|remove|turn\s+off|never\s*mind|forget(?:\s+about)?)\s+(?:the\s+|my\s+|all\s+(?:the\s+|my\s+)?|that\s+|this\s+|any\s+|those\s+)?(?:timers?|countdowns?|scheduled\s+(?:tasks?|jobs?|things?|shutdowns?|restarts?|reminders?)|watch(?:es)?|shutdown|shut\s*down|shutting\s+down|restart(?:ing)?|reboot|sleep\s+timer)\b/;
const EN_LIST = /\b(?:what(?:'?s|\s+is|\s+are)?|show(?:\s+me)?|list|any(?:thing)?|which|do\s+i\s+have|are\s+there|tell\s+me)\b[^.!?]{0,30}?\b(?:timers?|countdowns?|scheduled\b(?!\s+(?:for|on|in|this|today|tonight|tomorrow|meetings?|calls?|events?)\b))/;
const EN_CLAUDE_DONE = /\b(?:when|once|after|as\s+soon\s+as|until)\b[^.!?]{0,60}?\b(?:claude|vs\s*code|vscode|sessions?|tasks?|jobs?|work|coding|agents?|projects?)\b[^.!?]{0,30}?\b(?:done|finish(?:es|ed)?|complete[ds]?|over|through|ends?|ended|stops?|stopped)\b/;
// "when …" is a condition, but not "when is my meeting?"
const EN_CONDITION = /\b(?:once|as\s+soon\s+as|whenever|until|unless)\b|(?<!^\s*)\bwhen\b|^\s*when\b(?!\s+(?:is|are|was|were|do|does|did|will|would|can|could|should|am|'?s)\b)|\b(?:after|once)\b[^.!?]{0,50}?\b(?:finish(?:es|ed)?|is\s+done|are\s+done|completes?|ends|closes|quits|opens|appears|shows\s+up)\b|\bevery\s+(?:\d+\s+|few\s+|couple\s+of\s+)?(?:minutes?|mins?|hours?|seconds?)\b|\bkeep\s+checking\b|\bcheck\s+(?:every|back)\b/;
const EN_LATER = /\b(?:next\s+(?:week|month)|(?:on\s+|next\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|later|tonight|this\s+(?:evening|afternoon|weekend)|in\s+the\s+(?:morning|evening|afternoon))\b/;
// strictDays: a day word alone ("what's on tomorrow") is not ours, and a weekday with a time is more than these rules know.
const EN = { cancel: EN_CANCEL, list: EN_LIST, relative: relativeEn, absolute: absoluteEn, tomorrow: /\btomorrow\b/, claude: EN_CLAUDE_DONE, condition: EN_CONDITION, later: EN_LATER, actions: EN_ACTIONS, cut: ' ; ', strictDays: true };

function readSchedule(t, rules, now) {
  if (rules.cancel.test(t)) return { type: 'cancel' };
  if (rules.list.test(t)) return { type: 'list' };
  let rest = t;
  const rel = rules.relative(rest);
  if (rel) rest = rest.replace(rel.match, rules.cut);
  const abs = rel ? null : rules.absolute(rest, now, rules.tomorrow.test(rest));
  if (abs) rest = rest.replace(abs.match, rules.cut);
  const claude = rules.claude.test(rest);
  const otherCondition = !claude && rules.condition.test(rest);
  const later = rules.later.test(rest) || (rules.tomorrow.test(rest) && !abs);
  const positive = new Set();
  const negated = new Set();
  for (const [action, [yes, no]] of Object.entries(rules.actions)) {
    if (no.test(rest)) negated.add(action);
    if (yes.test(rest.replace(no, rules.cut))) positive.add(action);
  }
  const timed = Boolean(rel || abs || claude || otherCondition || later);
  if (!timed && !positive.size && !negated.size) return null;
  if (rules.strictDays) {
    if (!positive.size && !negated.size && !rel && !abs && !claude && !otherCondition) return null;
    if (rules.later.test(rest)) return { type: 'brain' };
  }
  if (otherCondition || (later && !rel && !abs && !claude)) return { type: 'brain' };
  if (positive.size !== 1) {
    if (!positive.size && negated.size && !timed) return { type: 'negated', actions: [...negated] };
    return { type: 'brain' };
  }
  const [action] = positive;
  if (negated.has(action)) return { type: 'brain' };
  if (!timed) return negated.size ? { type: 'brain' } : { type: 'now', action };
  return { type: 'schedule', action, at: rel ? now + Math.round(rel.minutes * MIN) : abs ? abs.at : null, claude };
}

/**
 * Timers and power commands the fast path can do without an LLM, said in
 * Turkish (first) or English:
 *   { type: 'list' } · { type: 'cancel' } · { type: 'negated', actions } ("bilgisayarı kapatma", "don't shut down")
 *   { type: 'now', action } · { type: 'schedule', action, at?, claude? }
 *   { type: 'brain' }: it is about later / a condition / mixed, but too much for these rules
 *   null: not about timers or power at all.
 */
export function parseSchedule(text, now = Date.now()) {
  const t = ` ${String(text).toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim()} `;
  const turkish = readSchedule(t, TR, now);
  if (turkish) return turkish;
  // English is read lower-cased without the Turkish dotless ı ("I" → "i"), with ’ as ' and "twenty-five" as "twenty five".
  const e = ` ${String(text).toLowerCase().replace(/[’‘]/g, "'").replace(/(\p{L})-(\p{L})/gu, '$1 $2').replace(/\s+/g, ' ').trim()} `;
  return readSchedule(e, EN, now);
}
