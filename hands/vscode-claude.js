// Claude Code sessions the user can watch, instead of Claude running in the
// background: Handry brings the project's VS Code window to the front, opens
// a new tab of the Claude Code extension with the task already in its message
// box (the extension's own vscode://anthropic.claude-code/open link), checks
// in the accessibility tree that the box really holds that text and presses
// the Send button next to it. Writing into a session already open there works
// the same way, with the session's id in the link. Which session a new tab
// became comes from Claude Code's own status files (claude-sessions.js).
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { JevisError } from '../core/errors.js';
import * as desktop from './desktop.js';
import { claudeSessions } from './claude-sessions.js';
import { resolvePath, recentProjects } from './files.js';
import * as overlay from './overlay.js';
import { alertUser, resolveAlert } from '../guard/notify.js';
import { APP_NAME } from '../core/brand.js';
import { T } from '../core/i18n.js';

const run = promisify(execFile);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const VSCODE = 'com.microsoft.VSCode';
const LINK = 'vscode://anthropic.claude-code/open';
const flat = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const lower = s => flat(s).toLocaleLowerCase('tr');
const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

/** A folder path ("~/Desktop/jev") or the name of a recent project ("jev") → its absolute path. */
export async function projectDir(project) {
  const raw = flat(project);
  if (!raw) throw new JevisError('BAD_ARGS', T('Hangi proje? Bir klasör yolu ya da proje adı ver.', 'Which project? Give a folder path or a project name.'));
  if (raw.includes('/') || raw.startsWith('~')) {
    const p = resolvePath(raw);
    if (!isDir(p)) throw new JevisError('NOT_FOUND', T(`Böyle bir klasör yok: ${raw}`, `No such folder: ${raw}`));
    return p;
  }
  const recent = await recentProjects({ days: 120, limit: 60 });
  const exact = recent.filter(r => lower(r.name) === lower(raw));
  const near = exact.length ? exact : recent.filter(r => lower(r.name).includes(lower(raw)));
  if (near.length === 1 || exact.length) return resolvePath(near[0].path);
  if (near.length > 1) throw new JevisError('AMBIGUOUS', T(`"${raw}" birden çok projeye uyuyor: ${near.map(r => r.path).join(', ')}. Klasör yolunu ver.`, `"${raw}" matches more than one project: ${near.map(r => r.path).join(', ')}. Give the folder path.`));
  throw new JevisError('NOT_FOUND', T(`"${raw}" adında yakın zamanda açılmış bir proje yok. Son projeler: ${recent.slice(0, 8).map(r => r.name).join(', ')}.`, `No recently opened project is called "${raw}". Recent projects: ${recent.slice(0, 8).map(r => r.name).join(', ')}.`));
}

/** Brings the VS Code window of dir to the front (VS Code opens it when it isn't open). */
async function projectWindow(dir) {
  await run('open', ['-a', 'Visual Studio Code', dir]);
  const base = path.basename(dir);
  for (let i = 0; i < 60; i++) {
    const f = await desktop.frontmost().catch(() => ({}));
    // "Claude Code — jev", "server.js — jev", or just "jev"
    if (f.bundleId === VSCODE && String(f.window || '').split(' — ').includes(base)) return f;
    await sleep(250);
  }
  throw new JevisError('NOT_FOUND', T(`VS Code'da "${base}" penceresi öne gelmedi; hiçbir şey yazmadım.`, `The "${base}" window didn't come to the front in VS Code; I didn't type anything.`));
}

/**
 * The message box in VS Code's front window that holds exactly text, and the Send button next to it; or, while
 * VS Code asks whether the extension may open the link (its own question, for the user), { asking: its Open button }.
 */
async function boxWith(pid, text) {
  const r = await desktop.read({ app: pid, remember: false });
  const box = r.elements.find(e => (e.role === 'TextArea' || e.role === 'TextField') && flat(e.value) === flat(text));
  if (!box) {
    const asking = r.texts.some(t => /extension to open this URI/i.test(t));
    return asking ? { asking: r.elements.find(e => e.role === 'Button' && e.name === 'Open') || {} } : null;
  }
  const mid = e => [e.x + e.w / 2, e.y + e.h / 2];
  const dist = e => Math.hypot(mid(e)[0] - mid(box)[0], mid(e)[1] - mid(box)[1]);
  const send = r.elements.filter(e => e.role === 'Button' && /^(send|gönder)/i.test(e.name || '')).sort((a, b) => dist(a) - dist(b))[0];
  return { box, send: send && dist(send) < 400 ? send : null };
}

/**
 * Waits for text to show up in a Claude message box, sends it, and makes sure the box emptied. When VS Code asks
 * first whether the Claude extension may open the link, the answer is the user's: they are told, the Open button is
 * circled, and the wait goes on for a while.
 */
async function sendWhenShown(pid, text, seconds = 15) {
  let found = null;
  let asked = null;
  let until = Date.now() + seconds * 1000;
  try {
    while (Date.now() < until) {
      found = await boxWith(pid, text);
      if (found && !found.asking) break;
      if (found?.asking && !asked) {
        asked = {
          alert: alertUser(T(`VS Code, Claude eklentisinin ${APP_NAME}'nin bağlantısını açmasına izin istiyor. Open'a basarsan devam ederim (bir daha sormasın istersen "Do not ask me again"i işaretle).`, `VS Code asks whether the Claude extension may open ${APP_NAME}'s link. Press Open and I'll go on (tick "Do not ask me again" so it doesn't ask again).`), { title: APP_NAME, imessage: true }),
          mark: found.asking.w ? await overlay.draw({ shape: 'circle', rect: found.asking, note: T('izin senin: Open', 'your call: Open'), seconds: 120 }).catch(() => null) : null
        };
        until = Date.now() + 120_000;
      }
      found = null;
      await sleep(400);
    }
  } finally {
    if (asked) { resolveAlert(asked.alert); if (asked.mark) overlay.clear(asked.mark); }
  }
  // No answer: Handry takes its own request back (Cancel only ever declines), so no stray question is left open.
  if (!found && asked) {
    const r = await desktop.read({ app: pid, remember: false }).catch(() => null);
    const cancel = r?.texts.some(t => /extension to open this URI/i.test(t)) && r.elements.find(e => e.role === 'Button' && e.name === 'Cancel');
    if (cancel) await desktop.pressPath(cancel.path, { pid, expect: 'Cancel' }).catch(() => {});
  }
  if (!found) {
    throw new JevisError(asked ? 'DENIED' : 'NOT_FOUND', asked
      ? T('VS Code\'un izin sorusuna Open denilmedi; Claude\'a hiçbir şey göndermedim.', 'Open wasn\'t pressed on VS Code\'s question; I sent nothing to Claude.')
      : T('Claude sekmesi açıldı ama yazı mesaj kutusunda görünmedi, göndermedim. VS Code bir şey soruyor olabilir (klasöre güven, giriş); ekrana bak.', 'The Claude tab opened but the text didn\'t show up in its message box, so I didn\'t send it. VS Code may be asking something (trust the folder, sign in); have a look at the screen.'));
  }
  if (found.send) {
    await desktop.pressPath(found.send.path, { pid, expect: found.send.name });
  } else {
    await desktop.focusPath(found.box.path, { pid });
    await desktop.key('return', { app: pid });
  }
  for (let i = 0; i < 20; i++) {
    await sleep(250);
    if (!(await boxWith(pid, text))?.box) return;
  }
  throw new JevisError('NOT_SENT', T('Gönder\'e basıldı ama yazı hâlâ mesaj kutusunda duruyor.', 'Send was pressed but the text is still in the message box.'));
}

/** A new VS Code Claude session in dir that was not there before, or null. */
async function newSessionIn(dir, before, seconds = 20) {
  for (const until = Date.now() + seconds * 1000; Date.now() < until; await sleep(500)) {
    const s = claudeSessions().find(x => !before.has(x.pid) && x.cwd === dir && x.where === 'VS Code');
    if (s) return s;
  }
  return null;
}

/**
 * Starts Claude Code on task in a new tab of project's VS Code window and sends it.
 * → { dir, window, session } (session: the claudeSessions() entry, or null if it could not be told apart).
 */
export async function startSession({ project, task }) {
  if (!flat(task)) throw new JevisError('BAD_ARGS', T('Claude\'a ne yazayım? task boş.', 'What should I tell Claude? task is empty.'));
  const dir = await projectDir(project);
  const before = new Set(claudeSessions().map(s => s.pid));
  const win = await projectWindow(dir);
  await run('open', [`${LINK}?prompt=${encodeURIComponent(task)}`]);
  await sendWhenShown(win.pid, task);
  return { dir, window: win.window, session: await newSessionIn(dir, before) };
}

/** The open Claude Code session called which (its name, project or id); throws when none or several match. */
export function findSession(which) {
  const all = claudeSessions().filter(s => !s.jevis);
  const w = lower(which);
  const byId = all.filter(s => s.sessionId === flat(which));
  const exact = all.filter(s => lower(s.name) === w);
  const hits = byId.length ? byId : exact.length ? exact : all.filter(s => lower(s.name).includes(w) || lower(s.project) === w);
  if (hits.length === 1) return hits[0];
  const list = all.map(s => `"${s.name}" (${s.project}, ${s.where})`).join(', ') || T('yok', 'none');
  if (!hits.length) throw new JevisError('NOT_FOUND', T(`"${which}" diye açık bir Claude Code oturumu yok. Açık olanlar: ${list}.`, `No open Claude Code session is called "${which}". Open ones: ${list}.`));
  throw new JevisError('AMBIGUOUS', T(`"${which}" birden çok oturuma uyuyor: ${hits.map(s => `"${s.name}"`).join(', ')}. Adını tam ver.`, `"${which}" matches more than one session: ${hits.map(s => `"${s.name}"`).join(', ')}. Give its full name.`));
}

/** Writes text into an open VS Code Claude session (its tab comes to the front) and sends it. */
export async function sendToSession({ session: which, text }) {
  if (!flat(text)) throw new JevisError('BAD_ARGS', T('Ne yazayım? text boş.', 'What should I write? text is empty.'));
  const s = findSession(which);
  if (s.where !== 'VS Code') throw new JevisError('NOT_SUPPORTED', T(`"${s.name}" oturumu VS Code'da değil (${s.where || 'başka bir yerde'}); ben sadece VS Code'daki Claude oturumlarına yazabiliyorum.`, `The "${s.name}" session isn't in VS Code (${s.where || 'somewhere else'}); I can only write to Claude sessions in VS Code.`));
  if (!s.cwd || !s.sessionId) throw new JevisError('NOT_FOUND', T(`"${s.name}" oturumunun klasörü bilinmiyor.`, `The folder of the "${s.name}" session isn't known.`));
  const win = await projectWindow(s.cwd);
  await run('open', [`${LINK}?session=${encodeURIComponent(s.sessionId)}&prompt=${encodeURIComponent(text)}`]);
  await sendWhenShown(win.pid, text);
  return { session: s, window: win.window };
}
