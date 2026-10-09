// Scheduled tasks and watches: "3 saat sonra bilgisayarı kapat", "saat
// 01:01'de ekranı kilitle", "VS Code'daki işler bitince bilgisayarı kapat",
// "5 dakikada bir bak, indirme bitince uyut". A task has a time (at), a
// condition (until) checked every `every` ms, or both, and one thing to do:
// lock / sleep / restart / shutdown, a reminder, or a JEVIS command.
// Conditions are checked by JEVIS itself, without an LLM: Claude Code's own
// session status files, or the text of an app window or a JEVIS Chrome tab
// (a plain "contains", or a yes/no by Jev).
// Tasks live in ~/.jevis/timers.json, so a task set from any Claude session
// through the JEVIS tools is kept too; the JEVIS server runs them
// (startScheduler). Shut down and restart get a countdown first (JEVIS bar,
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
import { power, POWER_NAMES } from '../hands/power.js';
import { alertUser, resolveAlert, sendIMessage } from '../guard/notify.js';
import { stopRequestedSince } from '../guard/stop.js';
import { APP_NAME } from './brand.js';

const MIN = 60_000;
const LATE_MS = 10 * MIN;
const EXPIRES_MS = 24 * 60 * MIN;
export const POWER = new Set(['lock', 'sleep', 'restart', 'shutdown']);
const OFF = new Set(['restart', 'shutdown']);
const ACTIONS = new Set([...POWER, 'remind', 'command']);
const sleep = ms => new Promise(r => setTimeout(r, ms));
export const TITLE = 'Zamanlayıcı'; // notices from here (the bar shows them without "JEVIS goes on by itself")

const file = () => path.join(HOME, 'timers.json');
const lockFile = () => path.join(HOME, 'timers.lock');
const tickMs = () => Number(process.env.JEVIS_TIMER_TICK_MS) || 5000;
// A condition must still hold this long later (a Claude session pauses between steps).
const stableMs = () => Number(process.env.JEVIS_TIMER_STABLE_MS) || MIN;

// ---------------------------------------------------------------------------
// Saying times in Turkish: "01:01'de", "03:30'da", "yarın 09:00'da"
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

const hhmm = t => new Date(t).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

function whenText(t, kind = 'de') {
  const days = Math.round((new Date(new Date(t).toDateString()) - new Date(new Date().toDateString())) / 86400000);
  const day = days === 0 ? '' : days === 1 ? 'yarın ' : `${new Date(t).toLocaleDateString('tr-TR')} `;
  return `${day}${hhmm(t)}'${ending(t, kind)}`;
}

const HOLDING = { lock: 'kilitlemeyi', sleep: 'uyutmayı', restart: 'yeniden başlatmayı', shutdown: 'kapatmayı', remind: 'hatırlatmayı', command: 'işi' };
const FUTURE = { lock: 'ekranı kilitleyeceğim', sleep: "Mac'i uyutacağım", restart: "Mac'i yeniden başlatacağım", shutdown: "Mac'i kapatacağım" };
const whatText = job => (job.action === 'remind' ? `"${job.text}" diye hatırlat` : job.action === 'command' ? `"${job.text}" komutunu çalıştır` : POWER_NAMES[job.action]);
const futureText = job => (job.action === 'remind' ? `"${job.text}" diye hatırlatacağım` : job.action === 'command' ? `"${job.text}" komutunu çalıştıracağım` : FUTURE[job.action]);

function conditionText(u) {
  if (u.claude) return `${u.claude.map(s => `"${s.name}"`).join(', ')} bitince`;
  const where = u.app ? `${u.app} penceresinde` : `"${u.page}" sekmesinde`;
  if (u.app && u.closed) return `${u.app} kapanınca`;
  return u.contains ? `${where} "${u.contains}" görününce` : `${where} "${u.expect}" olunca`;
}

const capital = t => t.charAt(0).toLocaleUpperCase('tr') + t.slice(1);
const whatLabel = job => (job.action === 'command' ? capital(job.text) : job.action === 'remind' ? `Hatırlat: "${job.text}"` : capital(whatText(job)));

function whenPart(job) {
  const parts = [];
  if (job.at && (!job.until || job.at > job.created + 5000)) parts.push(job.until ? `${whenText(job.at, 'den')} sonra` : whenText(job.at));
  if (job.until) parts.push(conditionText(job.until));
  return parts.join(', ');
}

/** "⏰ 01:01'de → ekranı kilitle", "👀 "iş geliştirme" bitince → Mac'i kapat". */
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
  if (Number.isNaN(t)) throw new Error(`Saati anlayamadım: "${at}". "HH:MM" ya da "YYYY-MM-DDTHH:MM" ver.`);
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
  if (!ACTIONS.has(action)) throw new Error(`Bilinmeyen iş: ${action}`);
  if ((action === 'remind' || action === 'command') && !String(text).trim()) throw new Error('Ne hatırlatayım ya da ne yapayım? text boş.');
  if (!at && !until) throw new Error('Ne zaman? Bir saat (at), bir süre (in_minutes) ya da bir koşul (until) ver.');
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
  job.label = { what: whatLabel(job), when: capital(whenPart(job)) }; // JEVIS.app's menu shows these as they are
  saveJobs([...listJobs(), job]);
  return job;
}

/** What JEVIS says after setting a task. */
export function confirmText(job) {
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
  if (!jobs.length) return 'Bekleyen zamanlanmış iş yok.';
  return jobs.map((j, i) => `${i + 1}. ${describe(j)}${j.lastNote ? ` — son bakış: ${j.lastNote}` : ''} (id ${j.id})`).join('\n');
}

// ---------------------------------------------------------------------------
// Checking conditions
// ---------------------------------------------------------------------------

async function textCondition(u, text, where, strict) {
  if (u.contains) {
    const met = text.toLocaleLowerCase('tr').includes(String(u.contains).toLocaleLowerCase('tr'));
    return { met, note: met ? `"${u.contains}" göründü` : `"${u.contains}" henüz yok` };
  }
  const v = await jev.checkState(u.expect, { ...where, text: text.slice(0, 6000) });
  return { met: v.p >= (strict ? 0.75 : 0.6), note: `%${Math.round(v.p * 100)} "${u.expect}"` };
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
      note: status.map(x => `${x.t.name}: ${x.s ? stateText(x.s) : 'kapandı'}`).join(' · ')
    };
  }
  const strict = POWER.has(job.action);
  if (u.app) {
    const wanted = String(u.app).toLocaleLowerCase('tr');
    const running = (await desktop.apps()).find(a => a.name.toLocaleLowerCase('tr') === wanted || a.bundleId.toLowerCase() === wanted)
      || (await desktop.apps()).find(a => a.name.toLocaleLowerCase('tr').includes(wanted));
    if (u.closed) return { met: !running, note: running ? `${u.app} açık` : `${u.app} kapandı` };
    if (!running) return { met: false, note: `${u.app} açık değil` };
    const r = await desktop.read({ app: running.pid, remember: false });
    return textCondition(u, [r.window, ...r.texts, ...r.elements.map(e => e.name)].join('\n'), { app: r.app, window: r.window }, strict);
  }
  if (u.page) {
    const tab = await browser.tabText(u.page);
    return textCondition(u, `${tab.title}\n${tab.text}`, { url: tab.url, title: tab.title }, strict);
  }
  return { met: false, note: 'koşul anlaşılmadı' };
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

/** Makes sure something runs the tasks: the JEVIS app (its server) is opened in the background if needed. */
export async function ensureScheduler() {
  if (schedulerAlive()) return true;
  if (process.env.JEVIS_HOME || process.env.JEVIS_NO_TIMERS === '1') return false; // tests, throwaway homes
  const app = [`${APP_NAME}.app`, 'Inaro.app', 'Foxie.app', 'JEVIS.app'].map(name => path.join(os.homedir(), 'Applications', name)).find(p => fs.existsSync(p));
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

/** `run(text)` runs a JEVIS command (the server passes one that waits until nothing else runs). */
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
      alertUser(`Beklediğim şey 24 saatte olmadı, bıraktım: ${describe(job)}`, { title: TITLE, speak: false });
      continue;
    }
    if (woke && off) {
      updateJob(job.id, { notBefore: now + LATE_MS });
      alertUser(`Mac uykudan uyandı. Bekleyen bir iş var: ${describe(job)}. 10 dakika bir şey yapmayacağım; istemiyorsan "zamanlayıcıyı iptal et" de.`, { title: TITLE, speak: false });
      continue;
    }
    if (job.notBefore && now < job.notBefore) continue;
    if (job.at && now < job.at) continue;
    if (job.at && !job.until && off && now - job.at > LATE_MS) {
      removeJob(job.id);
      alertUser(`Mac uyuduğu için ${whenText(job.at)} yapılacak işi zamanında yapamadım, geç de yapmadım: ${describe(job)}`, { title: TITLE, speak: false });
      continue;
    }
    if (job.until) {
      if (now < (job.nextCheck || 0)) continue;
      let r;
      try { r = await checkCondition(job); } catch (err) { r = { met: false, note: `bakılamadı: ${err.message}` }; }
      const patch = { lastCheck: now, lastNote: r.note, nextCheck: now + job.every };
      // A Claude session that needs an answer can't finish: tell the user once (an iMessage if they don't come).
      if (r.waiting?.length && !job.waitAlert) {
        patch.waitAlert = alertUser(`${r.waiting.map(n => `"${n}"`).join(', ')} senden cevap bekliyor. O bitmeden ${HOLDING[job.action]} bekletiyorum.`, { title: TITLE, imessage: true, speak: false });
      } else if (!r.waiting?.length && job.waitAlert) {
        resolveAlert(job.waitAlert);
        patch.waitAlert = null;
      }
      if (!r.met) {
        updateJob(job.id, { ...patch, metSince: null });
        continue;
      }
      if (!job.metSince || now - job.metSince < stableMs()) {
        const since = job.metSince || now;
        updateJob(job.id, { ...patch, metSince: since, nextCheck: since + stableMs() });
        continue;
      }
      updateJob(job.id, patch);
      job.lastNote = r.note;
    }
    fire(job);
  }
}

function reasonOf(job) {
  if (job.until?.claude) return `Claude işleri bitti (${job.until.claude.map(s => s.name).join(', ')}).`;
  if (job.until) return `Beklediğin oldu (${job.lastNote}).`;
  return `Saat ${hhmm(job.at)} oldu.`;
}

async function fire(job) {
  firing.add(job.id);
  try {
    const reason = reasonOf(job);
    if (OFF.has(job.action) && job.countdown > 0) {
      const started = Date.now();
      const verb = job.action === 'restart' ? 'yeniden başlayacak' : 'kapanacak';
      const alertId = alertUser(`${reason} Mac ${job.countdown} saniye sonra ${verb}. İptal için ⌥Esc'ye bas ya da "dur" de.`, { title: TITLE, speak: false });
      updateJob(job.id, { firing: started });
      while (Date.now() - started < job.countdown * 1000) {
        await sleep(500);
        if (!listJobs().some(j => j.id === job.id) || stopRequestedSince(started)) {
          resolveAlert(alertId);
          removeJob(job.id);
          alertUser(job.action === 'restart' ? 'Yeniden başlatma iptal edildi.' : 'Kapatma iptal edildi.', { title: TITLE, speak: false });
          return;
        }
      }
      resolveAlert(alertId);
      if (!removeJob(job.id)) return; // cancelled at the last moment
      // The user finds out on the phone what happened while they were away.
      await Promise.race([sendIMessage(`${APP_NAME}: ${reason} Mac'i ${job.action === 'restart' ? 'yeniden başlatıyorum' : 'kapatıyorum'}.`), sleep(20000)]).catch(() => {});
      await power(job.action);
      return;
    }
    removeJob(job.id);
    if (POWER.has(job.action)) await power(job.action);
    else if (job.action === 'remind') alertUser(job.text, { title: 'Hatırlatma' });
    else if (runCommandFn) await runCommandFn(job.text, job);
    else {
      const { runCommand } = await import('./runner.js');
      await runCommand({ text: job.text, source: 'timer', chatId: job.chatId, switchChat: false });
    }
  } catch (err) {
    alertUser(`Zamanlanmış iş yapılamadı (${describe(job)}): ${err.message}`, { title: TITLE, imessage: true });
  } finally {
    firing.delete(job.id);
  }
}

// ---------------------------------------------------------------------------
// Understanding it in Turkish, without an LLM (the fast path uses this)
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
  const candidates = [];
  for (const hh of hours) {
    for (const day of tomorrow ? [1] : [0, 1]) {
      const d = new Date(now);
      d.setDate(d.getDate() + day);
      d.setHours(hh, min, 0, 0);
      if (d.getTime() > now + 5000) candidates.push(d.getTime());
    }
  }
  return candidates.length ? { at: Math.min(...candidates), match: m[0] } : null;
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

/**
 * Timers and power commands the fast path can do without an LLM:
 *   { type: 'list' } · { type: 'cancel' } · { type: 'negated', actions } ("bilgisayarı kapatma")
 *   { type: 'now', action } · { type: 'schedule', action, at?, claude? }
 *   { type: 'brain' }: it is about later / a condition / mixed, but too much for these rules
 *   null: not about timers or power at all.
 */
export function parseSchedule(text, now = Date.now()) {
  const t = ` ${String(text).toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim()} `;
  if (CANCEL.test(t)) return { type: 'cancel' };
  if (LIST.test(t)) return { type: 'list' };
  let rest = t;
  const rel = relative(rest);
  if (rel) rest = rest.replace(rel.match, ' ');
  const abs = rel ? null : absolute(rest, now, /yarın/u.test(rest));
  if (abs) rest = rest.replace(abs.match, ' ');
  const claude = CLAUDE_DONE.test(rest);
  const otherCondition = !claude && CONDITION.test(rest);
  const later = LATER.test(rest) || (/yarın/u.test(rest) && !abs);
  const positive = new Set();
  const negated = new Set();
  for (const [action, [yes, no]] of Object.entries(ACTION_RES)) {
    if (no.test(rest)) negated.add(action);
    if (yes.test(rest.replace(no, ' '))) positive.add(action);
  }
  const timed = Boolean(rel || abs || claude || otherCondition || later);
  if (!timed && !positive.size && !negated.size) return null;
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
