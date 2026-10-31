// Handry · © 2026 Berat Olekli (purplefox) · github.com/purplefox21/handry
// Files and projects: folders, search, recently used files and apps
// (Spotlight), recently worked-on projects (VS Code + Claude Code) and what
// was done in a project (git + Claude Code session logs), and careful changes
// (new folder, move, copy, to the Trash, undo; see below). Everything stays
// inside the home folder; a file that would run as a program asks the user
// first before it is opened. Key and password files are
// never read, and secrets in texts are masked before they reach a brain.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { JevisError } from '../core/errors.js';
import { confirmAction } from '../guard/confirm.js';
import { HOME as JEVIS_HOME, ROOT as PROJECT } from '../core/config.js';
import { APP_NAME } from '../core/brand.js';
import { T } from '../core/i18n.js';

const execFileAsync = promisify(execFile);
const HOME = os.homedir();
const DAY = 24 * 60 * 60 * 1000;

// Folder names as people say them (Turkish or English) → the real folder.
const FOLDERS = {
  masaüstü: 'Desktop', masaustu: 'Desktop', desktop: 'Desktop', belgeler: 'Documents', dokümanlar: 'Documents', documents: 'Documents',
  indirilenler: 'Downloads', indirmeler: 'Downloads', downloads: 'Downloads', resimler: 'Pictures', pictures: 'Pictures',
  müzik: 'Music', music: 'Music', filmler: 'Movies', movies: 'Movies', uygulamalar: 'Applications'
};

const SECRET_FILE = /(^|\/)(\.env[^/]*|[^/]*\.(pem|key|p8|p12|pfx|keychain|keychain-db|keystore|jks|mobileprovision|kdbx)|id_(rsa|dsa|ecdsa|ed25519)[^/]*|\.netrc|\.npmrc|\.pypirc|\.git-credentials|credentials[^/]*|[^/]*secret[^/]*)$/i;
const SECRET_DIR = /\/(\.ssh|\.gnupg|\.aws|\.kube|\.docker|\.jevis|Library\/Keychains|keys|secrets|credentials|certs|certificates)(\/|$)/i;
// Opening these runs code (or installs something).
const RUNS_CODE = /\.(app|command|sh|bash|zsh|csh|tool|terminal|scpt|scptd|applescript|workflow|action|pkg|mpkg|dmg|jar|py|rb|pl|php|js|mjs|cjs|exe|bin|run|osascript)$/i;
const TERMINALS = /terminal|iterm|warp|ghostty|kitty|alacritty|wezterm|hyper/i;
// Paths that are noise in "recent" and search results.
const NOISE = /\/(Library|node_modules|\.git|\.cache|\.Trash|DerivedData|Pods|build|dist|\.next|\.venv|venv|__pycache__)\/|\/\.[^/]+\/|\.app\/./;

/** Hides keys and passwords in a text (API keys, tokens, "password=…"). */
export function redact(text) {
  const hidden = T('[gizli]', '[hidden]');
  return String(text)
    .replace(/\b(sk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g, hidden)
    .replace(/((?:api[_-]?key|secret|token|password|passwd|pwd|şifre|parola|jev_key|typesafe_api_key|client_secret|private_key)["']?\s*[=:]\s*["']?)[^\s"',;]+/gi, `$1${hidden}`)
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, T('[gizli anahtar]', '[hidden key]'))
    .replace(/\b[A-Fa-f0-9]{40,}\b/g, hidden);
}

export const tilde = p => (p === HOME ? '~' : p.startsWith(HOME + path.sep) ? `~/${p.slice(HOME.length + 1)}` : p);

/** "~/Desktop/x", "Masaüstü/x", "/Users/…" → an absolute path inside the home folder. */
export function resolvePath(input = '~') {
  let p = String(input ?? '~').trim().replace(/^["'“”]+|["'“”]+$/g, '').normalize('NFC');
  if (p === '' || p === '~') p = HOME;
  else if (p.startsWith('~/')) p = path.join(HOME, p.slice(2));
  else if (!path.isAbsolute(p)) {
    const [first, ...rest] = p.split('/');
    p = path.join(HOME, FOLDERS[first.toLocaleLowerCase('tr')] || first, ...rest);
  }
  p = path.resolve(p);
  let real = p;
  try { real = fs.realpathSync(p); } catch {}
  if (real !== HOME && !real.startsWith(HOME + path.sep)) throw new JevisError('OUTSIDE_HOME', T(`${APP_NAME} sadece ev klasöründeki (~) dosyalarla çalışır.`, `${APP_NAME} only works with files in your home folder (~).`));
  return p;
}

const statOf = p => { try { return fs.statSync(p); } catch { return null; } };
const readdir = d => { try { return fs.readdirSync(d); } catch { return []; } };

/** "az önce", "5 dk önce", "3 saat önce", "dün", "4 gün önce", "12 Eyl" (English: "just now", "5 min ago", "3 hours ago", "yesterday", "4 days ago", "Sep 12") */
export function ago(ms) {
  if (!ms) return '';
  const diff = Date.now() - ms;
  if (diff < 60e3) return T('az önce', 'just now');
  if (diff < 3600e3) { const n = Math.round(diff / 60e3); return T(`${n} dk önce`, `${n} min ago`); }
  if (diff < DAY) { const n = Math.round(diff / 3600e3); return T(`${n} saat önce`, `${n} ${n === 1 ? 'hour' : 'hours'} ago`); }
  if (diff < 2 * DAY) return T('dün', 'yesterday');
  if (diff < 14 * DAY) { const n = Math.round(diff / DAY); return T(`${n} gün önce`, `${n} days ago`); }
  return new Date(ms).toLocaleDateString(T('tr-TR', 'en-US'), { day: 'numeric', month: 'short' });
}

/** "3 items", "1 item" (English only; Turkish nouns stay singular after a number). */
const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

const sizeText = n => (n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(0)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(1)} GB`);

/** A folder's contents, newest first. */
export function list(dir, { hidden = false, limit = 200 } = {}) {
  const p = resolvePath(dir);
  const st = statOf(p);
  if (!st) throw new JevisError('NOT_FOUND', T(`Böyle bir klasör yok: ${tilde(p)}`, `No such folder: ${tilde(p)}`));
  if (!st.isDirectory()) throw new JevisError('NOT_DIR', T(`${tilde(p)} bir dosya, klasör değil.`, `${tilde(p)} is a file, not a folder.`));
  const items = readdir(p).filter(n => hidden || !n.startsWith('.')).map(name => {
    const s = statOf(path.join(p, name));
    return s && { name, dir: s.isDirectory() && !name.endsWith('.app'), app: name.endsWith('.app'), size: s.size, modified: s.mtimeMs };
  }).filter(Boolean).sort((a, b) => b.modified - a.modified);
  return { path: tilde(p), total: items.length, items: items.slice(0, limit) };
}

/** Spotlight query → [{ path, used }] (by last-used date). */
async function spotlight(dirs, query) {
  const { stdout } = await execFileAsync('mdfind', [...dirs.flatMap(d => ['-onlyin', d]), '-attr', 'kMDItemLastUsedDate', query], { timeout: 20000, maxBuffer: 50 * 1024 * 1024 });
  return stdout.split('\n').map(line => line.match(/^(.*?)\s+kMDItemLastUsedDate = (\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d) ([+-]\d{4})$/)).filter(Boolean)
    .map(m => ({ path: m[1], used: Date.parse(`${m[2]}T${m[3]}${m[4].slice(0, 3)}:${m[4].slice(3)}`) }));
}

/** Recently used files, apps or projects. */
export async function recent(kind = 'files', { days = 7, limit = 30 } = {}) {
  const d = Math.max(1, Math.min(Number(days) || 7, 365));
  if (kind === 'projects') return { kind, days: d, items: (await recentProjects({ days: d, limit })) };
  if (kind === 'apps') {
    const found = await spotlight(['/Applications', '/System/Applications', path.join(HOME, 'Applications')], `kMDItemContentType == "com.apple.application-bundle" && kMDItemLastUsedDate >= $time.today(-${d})`);
    const items = found.sort((a, b) => b.used - a.used).slice(0, limit).map(f => ({ name: path.basename(f.path, '.app'), path: f.path, used: f.used }));
    return { kind, days: d, items };
  }
  const found = await spotlight([HOME], `kMDItemLastUsedDate >= $time.today(-${d}) && kMDItemContentType != "public.folder" && kMDItemContentType != "com.apple.application-bundle"`);
  const items = found.filter(f => !NOISE.test(f.path)).sort((a, b) => b.used - a.used).slice(0, limit).map(f => ({ name: path.basename(f.path), path: tilde(f.path), used: f.used }));
  return { kind: 'files', days: d, items };
}

/** Files and folders whose name contains `query`, newest first. */
export async function search(query, { dir = '~', limit = 40 } = {}) {
  const p = resolvePath(dir);
  const { stdout } = await execFileAsync('mdfind', ['-onlyin', p, '-name', String(query)], { timeout: 20000, maxBuffer: 50 * 1024 * 1024 });
  const paths = stdout.split('\n').filter(f => f && !NOISE.test(f));
  const items = paths.slice(0, 500).map(f => { const s = statOf(f); return s && { name: path.basename(f), path: tilde(f), dir: s.isDirectory(), modified: s.mtimeMs }; })
    .filter(Boolean).sort((a, b) => b.modified - a.modified).slice(0, limit);
  return { query, path: tilde(p), total: paths.length, items };
}

/** The text of a file (plain text, or Word/RTF/HTML through textutil). */
export async function read(target, { maxChars = 20000 } = {}) {
  const p = resolvePath(target);
  if (SECRET_FILE.test(p) || SECRET_DIR.test(tilde(p).replace(/^~/, ''))) throw new JevisError('SECRET', T('Bu dosya şifre ya da anahtar içerebilir; Handry onu okumaz.', `This file may hold passwords or keys; ${APP_NAME} doesn't read it.`));
  const st = statOf(p);
  if (!st) throw new JevisError('NOT_FOUND', T(`Böyle bir dosya yok: ${tilde(p)}`, `No such file: ${tilde(p)}`));
  if (st.isDirectory()) throw new JevisError('NOT_FILE', T(`${tilde(p)} bir klasör; files_list ile bak.`, `${tilde(p)} is a folder; look at it with files_list.`));
  if (st.size > 20 * 1024 * 1024) throw new JevisError('TOO_BIG', T(`Dosya çok büyük (${sizeText(st.size)}).`, `The file is too big (${sizeText(st.size)}).`));
  let text;
  if (/\.(docx?|rtf|rtfd|odt|html?|webarchive)$/i.test(p)) {
    text = (await execFileAsync('textutil', ['-convert', 'txt', '-stdout', p], { maxBuffer: 50 * 1024 * 1024 })).stdout;
  } else {
    const buf = fs.readFileSync(p);
    if (buf.subarray(0, 8000).includes(0)) throw new JevisError('BINARY', T('Bu bir metin dosyası değil (resim, PDF, video ya da program olabilir). Görmek için files_open ile açıp desktop_screenshot kullan.', "This isn't a text file (it may be an image, PDF, video or program). To see it, open it with files_open and use desktop_screenshot."));
    text = buf.toString('utf-8');
  }
  return { path: tilde(p), chars: text.length, truncated: text.length > maxChars, text: redact(text.slice(0, maxChars)) };
}

/** Opens a file or folder (with its default app, or with `app`). */
export async function open(target, { app } = {}) {
  const p = resolvePath(target);
  const st = statOf(p);
  if (!st) throw new JevisError('NOT_FOUND', T(`Böyle bir dosya ya da klasör yok: ${tilde(p)}`, `No such file or folder: ${tilde(p)}`));
  const runs = st.isFile() && (RUNS_CODE.test(p) || (st.mode & 0o111) !== 0) || p.endsWith('.app');
  if (runs && (!app || TERMINALS.test(app))) {
    const ok = await confirmAction(T(`${APP_NAME} şunu açmak istiyor:\n\n${tilde(p)}${app ? `\n(${app} ile)` : ''}\n\nBu dosya açılınca program ya da komut olarak çalışabilir. İzin veriyor musun?`, `${APP_NAME} wants to open this:\n\n${tilde(p)}${app ? `\n(with ${app})` : ''}\n\nOpening this file can run it as a program or a command. Do you allow it?`));
    if (!ok) throw new JevisError('DENIED', T(`Kullanıcı izin vermedi: ${tilde(p)} açılmadı.`, `The user didn't allow it: ${tilde(p)} was not opened.`));
  }
  await execFileAsync('open', [...(app ? ['-a', app] : []), p], { timeout: 20000 });
  return { opened: tilde(p), app: app || null };
}

// ---------------------------------------------------------------------------
// Projects: VS Code windows and Claude Code sessions
// ---------------------------------------------------------------------------

const VSCODE = path.join(HOME, 'Library', 'Application Support', 'Code', 'User');
const CLAUDE_PROJECTS = process.env.JEVIS_CLAUDE_PROJECTS_DIR || path.join(HOME, '.claude', 'projects');
const newest = files => Math.max(0, ...files.map(f => statOf(f)?.mtimeMs || 0));

/** The first "cwd" in a Claude Code log. */
function cwdOf(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(128 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const m = buf.subarray(0, n).toString('utf-8').match(/"cwd":("(?:[^"\\]|\\.)*")/);
    return m ? JSON.parse(m[1]).normalize('NFC') : null;
  } catch {
    return null;
  }
}

/** Claude Code log folders: [{ dir, cwd, logs: [file…], last }]. */
function claudeFolders() {
  return readdir(CLAUDE_PROJECTS).map(d => {
    const dir = path.join(CLAUDE_PROJECTS, d);
    const logs = readdir(dir).filter(f => f.endsWith('.jsonl')).map(f => path.join(dir, f));
    if (!logs.length) return null;
    const cwd = logs.map(cwdOf).find(Boolean);
    return cwd && { dir, cwd, logs, last: newest(logs) };
  }).filter(Boolean);
}

function vscodeOpenFolders() {
  try {
    const state = JSON.parse(fs.readFileSync(path.join(VSCODE, 'globalStorage', 'storage.json'), 'utf-8')).windowsState || {};
    return new Set([state.lastActiveWindow, ...(state.openedWindows || [])].map(w => w?.folder).filter(f => f?.startsWith('file://')).map(f => decodeURIComponent(new URL(f).pathname).normalize('NFC')));
  } catch {
    return new Set();
  }
}

/** Folders worked on lately, from VS Code and Claude Code, newest first. */
export async function recentProjects({ days = 30, limit = 20 } = {}) {
  const since = Date.now() - days * DAY;
  const byPath = new Map();
  const add = (p, used, source) => {
    if (!p || !p.startsWith(HOME + path.sep) || p.startsWith(path.join(HOME, '.jevis')) || !statOf(p)?.isDirectory()) return;
    const e = byPath.get(p) || { path: p, used: 0, sources: new Set() };
    e.used = Math.max(e.used, used);
    e.sources.add(source);
    byPath.set(p, e);
  };
  // VS Code keeps one storage folder per opened folder and touches it when used.
  const storage = path.join(VSCODE, 'workspaceStorage');
  for (const d of readdir(storage)) {
    try {
      const { folder } = JSON.parse(fs.readFileSync(path.join(storage, d, 'workspace.json'), 'utf-8'));
      if (folder?.startsWith('file://')) add(decodeURIComponent(new URL(folder).pathname).normalize('NFC'), newest([path.join(storage, d), path.join(storage, d, 'state.vscdb')]), 'VS Code');
    } catch {}
  }
  for (const f of claudeFolders()) add(f.cwd, f.last, 'Claude Code');
  const open = vscodeOpenFolders();
  return [...byPath.values()].filter(e => e.used >= since).sort((a, b) => b.used - a.used).slice(0, limit)
    .map(e => ({ name: path.basename(e.path), path: tilde(e.path), used: e.used, sources: [...e.sources], openInVsCode: open.has(e.path) }));
}

function readRange(file, start, end) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(end - start);
  fs.readSync(fd, buf, 0, buf.length, start);
  fs.closeSync(fd);
  return buf.toString('utf-8');
}

const textOf = content => (typeof content === 'string' ? content : Array.isArray(content) ? content.filter(c => c.type === 'text').map(c => c.text).join('\n') : '');
const oneLine = (s, n) => { const t = String(s).replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** What a Claude Code session was about: title, the user's requests and Claude's last answers. */
function sessionSummary(file) {
  const size = statOf(file).size;
  // Big logs: the start (first request) and the last few MB (recent work) are enough.
  const MB = 1024 * 1024;
  const chunks = size <= 8 * MB ? [readRange(file, 0, size)] : [readRange(file, 0, 256 * 1024), readRange(file, size - 6 * MB, size).replace(/^[^\n]*\n/, '')];
  let title = '';
  let started = null;
  let lines = null;
  const prompts = [];
  const replies = [];
  for (const line of chunks.join('\n').split('\n')) {
    if (!line.includes('"type":"')) continue;
    if (line.includes('"type":"ai-title"')) { try { title = JSON.parse(line).aiTitle || title; } catch {} continue; }
    if (line.includes('"type":"cost-state"')) { try { const c = JSON.parse(line); lines = { added: c.totalLinesAdded || 0, removed: c.totalLinesRemoved || 0 }; } catch {} continue; }
    const isUser = line.includes('"type":"user"');
    const isReply = line.includes('"type":"assistant"') && line.includes('"type":"text"');
    if (!isUser && !isReply) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.isSidechain || e.isMeta || e.isCompactSummary) continue;
    if (!started && e.timestamp) started = Date.parse(e.timestamp);
    // what the user typed, without the blocks the editor adds in front of it (browser instructions, reminders, the open file)
    const text = textOf(e.message?.content).replace(/<(browser_instruction|system-reminder|ide_selection|ide_opened_file)>[\s\S]*?<\/\1>/g, '').trim();
    if (!text) continue;
    if (e.type === 'user' && (e.origin?.kind === 'human' || e.origin === undefined) && !/^(<|\[Request interrupted|This session is being continued)/.test(text)) {
      if (prompts.at(-1)?.text !== text) prompts.push({ text, at: Date.parse(e.timestamp) });
    } else if (e.type === 'assistant') {
      replies.push({ text, at: Date.parse(e.timestamp) });
    }
  }
  return {
    id: path.basename(file, '.jsonl'),
    title: redact(title),
    started,
    last: statOf(file).mtimeMs,
    lines,
    firstPrompt: prompts[0] ? redact(oneLine(prompts[0].text, 240)) : '',
    lastPrompts: prompts.slice(1).slice(-4).map(p => redact(oneLine(p.text, 240))),
    lastReply: replies.length ? redact(oneLine(replies.at(-1).text, 900)) : ''
  };
}

/** One Claude Code session's summary (title, requests, last answer) by its id, or null. */
export function sessionReport(sessionId) {
  if (!/^[\w-]+$/.test(String(sessionId))) return null;
  for (const d of readdir(CLAUDE_PROJECTS)) {
    const file = path.join(CLAUDE_PROJECTS, d, `${sessionId}.jsonl`);
    if (statOf(file)) return sessionSummary(file);
  }
  return null;
}

/** What was done in a project: git history and the Claude Code sessions run in it. */
export async function projectActivity(dir, { sessions = 3, commits = 10 } = {}) {
  const p = resolvePath(dir);
  if (!statOf(p)?.isDirectory()) throw new JevisError('NOT_FOUND', T(`Böyle bir klasör yok: ${tilde(p)}`, `No such folder: ${tilde(p)}`));
  const out = { path: tilde(p), git: null, sessions: [] };
  // trimEnd: status lines start with a space (" M file").
  const git = (...args) => execFileAsync('git', ['-C', p, ...args], { timeout: 10000, maxBuffer: 10 * 1024 * 1024 }).then(r => r.stdout.trimEnd());
  try {
    const [branch, log, status] = await Promise.all([
      git('rev-parse', '--abbrev-ref', 'HEAD'),
      git('log', `-${Math.min(Number(commits) || 10, 50)}`, '--pretty=format:%h\t%at\t%s'),
      git('status', '--porcelain')
    ]);
    out.git = {
      branch,
      commits: log ? log.split('\n').map(l => { const [hash, at, subject] = l.split('\t'); return { hash, when: ago(Number(at) * 1000), subject: redact(subject) }; }) : [],
      changed: status ? status.split('\n').map(l => l.slice(3)) : []
    };
  } catch {}
  // Sessions started in this folder or inside it.
  const logs = claudeFolders().filter(f => f.cwd === p || f.cwd.startsWith(p + path.sep)).flatMap(f => f.logs)
    .map(f => ({ f, t: statOf(f).mtimeMs })).sort((a, b) => b.t - a.t).slice(0, Math.min(Number(sessions) || 3, 10));
  out.sessions = logs.map(({ f }) => sessionSummary(f));
  return out;
}

// ---------------------------------------------------------------------------
// Text for the brain
// ---------------------------------------------------------------------------

export function formatList(r) {
  if (!r.items.length) return T(`${r.path}: boş.`, `${r.path}: empty.`);
  return [T(`${r.path} (${r.total} öğe${r.total > r.items.length ? `, ilk ${r.items.length}` : ''}, en yeni önce):`, `${r.path} (${count(r.total, 'item')}${r.total > r.items.length ? `, first ${r.items.length}` : ''}, newest first):`),
    ...r.items.map(i => `${i.dir ? '📁' : i.app ? '🧩' : '📄'} ${i.name}${i.dir ? '/' : ''} — ${ago(i.modified)}${i.dir || i.app ? '' : ` · ${sizeText(i.size)}`}`)].join('\n');
}

export function formatRecent(r) {
  const lastDays = r.days === 1 ? 'the last day' : `the last ${r.days} days`;
  if (!r.items.length) return T(`Son ${r.days} günde kayıt yok.`, `Nothing in ${lastDays}.`);
  if (r.kind === 'projects') {
    return [T(`Son ${r.days} günde üzerinde çalışılan projeler (en yeni önce):`, `Projects worked on in ${lastDays} (newest first):`),
      ...r.items.map(i => `📁 ${i.name} — ${i.path} · ${ago(i.used)} · ${i.sources.join(' + ')}${i.openInVsCode ? T(' · VS Code\'da açık', ' · open in VS Code') : ''}`)].join('\n');
  }
  const head = r.kind === 'apps' ? T(`Son ${r.days} günde kullanılan uygulamalar:`, `Apps used in ${lastDays}:`) : T(`Son ${r.days} günde açılan dosyalar:`, `Files opened in ${lastDays}:`);
  return [head, ...r.items.map(i => `${r.kind === 'apps' ? '🧩' : '📄'} ${i.name} — ${ago(i.used)}${r.kind === 'apps' ? '' : ` · ${i.path}`}`)].join('\n');
}

export function formatSearch(r) {
  if (!r.items.length) return T(`"${r.query}" ${r.path} içinde bulunamadı.`, `"${r.query}" wasn't found in ${r.path}.`);
  return [T(`"${r.query}" için ${r.total} sonuç${r.total > r.items.length ? ` (en yeni ${r.items.length})` : ''}:`, `${count(r.total, 'result')} for "${r.query}"${r.total > r.items.length ? ` (newest ${r.items.length})` : ''}:`),
    ...r.items.map(i => `${i.dir ? '📁' : '📄'} ${i.path} — ${ago(i.modified)}`)].join('\n');
}

export function formatActivity(r) {
  const lines = [T(`Proje: ${r.path}`, `Project: ${r.path}`)];
  if (r.git) {
    const changed = r.git.changed.length ? `(${r.git.changed.slice(0, 8).join(', ')}${r.git.changed.length > 8 ? '…' : ''})` : '';
    lines.push(T(`Git: dal ${r.git.branch} · ${r.git.changed.length ? `${r.git.changed.length} kaydedilmemiş değişiklik ${changed}` : 'kaydedilmemiş değişiklik yok'}`,
      `Git: branch ${r.git.branch} · ${r.git.changed.length ? `${count(r.git.changed.length, 'uncommitted change')} ${changed}` : 'no uncommitted changes'}`));
    if (r.git.commits.length) lines.push(T('Son commitler:', 'Recent commits:'), ...r.git.commits.map(c => `- ${c.hash} (${c.when}) ${c.subject}`));
  } else {
    lines.push(T('Git: bu klasör bir git deposu değil.', "Git: this folder isn't a git repository."));
  }
  if (!r.sessions.length) lines.push('', T('Bu klasörde Claude Code oturumu bulunamadı.', 'No Claude Code session was found in this folder.'));
  r.sessions.forEach((s, i) => {
    const title = s.title || T('(başlıksız)', '(untitled)');
    lines.push('', T(`Claude Code oturumu ${i + 1}: "${title}" — son hareket ${ago(s.last)}${s.started ? `, başlangıç ${ago(s.started)}` : ''}${s.lines ? ` · +${s.lines.added}/-${s.lines.removed} satır` : ''}`,
      `Claude Code session ${i + 1}: "${title}" — last activity ${ago(s.last)}${s.started ? `, started ${ago(s.started)}` : ''}${s.lines ? ` · +${s.lines.added}/-${s.lines.removed} lines` : ''}`));
    if (s.firstPrompt) lines.push(T(`  İlk istek: ${s.firstPrompt}`, `  First request: ${s.firstPrompt}`));
    if (s.lastPrompts.length) lines.push(T('  Son istekler:', '  Last requests:'), ...s.lastPrompts.map(p => `  - ${p}`));
    if (s.lastReply) lines.push(T(`  Claude'un son cevabı: ${s.lastReply}`, `  Claude's last answer: ${s.lastReply}`));
  });
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Changing files: a new folder, move / rename, copy, to the Trash, undo.
// Nothing is ever deleted for good: things go to the Trash (Finder's "Put
// Back" works). Only inside the home folder, never in Library, hidden folders
// or key folders, never the standard folders themselves (Desktop, Documents…)
// or this project. Never overwrites. Bigger steps ask the user first: a folder
// or more than 3 items to the Trash, a git project moved or thrown away, more
// than 20 items at once. Each change goes to a journal so "geri al" can turn
// the last one back.
// ---------------------------------------------------------------------------

const JOURNAL = () => path.join(JEVIS_HOME, 'files-journal.jsonl');
const STANDARD = new Set(['', 'Desktop', 'Documents', 'Downloads', 'Pictures', 'Music', 'Movies', 'Applications', 'Library', 'Public'].map(n => path.join(HOME, n)));

/** May this path be changed (created, moved, copied to, thrown away)? Throws if not. */
function changeable(p, { source = false } = {}) {
  const rel = path.relative(HOME, p);
  const testRoot = process.env.JEVIS_FILES_TEST_ROOT;
  const inTest = testRoot && (p === testRoot || p.startsWith(testRoot + path.sep));
  if (!inTest) {
    if (rel === 'Library' || rel.startsWith(`Library${path.sep}`) || rel.split(path.sep).some(part => part.startsWith('.'))) {
      throw new JevisError('PROTECTED', T(`${tilde(p)}: sistem ve gizli klasörlere dokunmam (Library, .ssh, .config…).`, `${tilde(p)}: I don't touch system and hidden folders (Library, .ssh, .config…).`));
    }
    if (SECRET_DIR.test(p) || SECRET_FILE.test(p)) throw new JevisError('PROTECTED', T(`${tilde(p)}: anahtar ve şifre dosyalarına dokunmam.`, `${tilde(p)}: I don't touch key and password files.`));
  }
  if (source && STANDARD.has(p)) throw new JevisError('PROTECTED', T(`${tilde(p)} ana klasörlerden biri; onu taşımam ya da çöpe atmam.`, `${tilde(p)} is one of the main folders; I don't move it or put it in the Trash.`));
  if (source && (p === PROJECT || PROJECT.startsWith(p + path.sep) || p.startsWith(PROJECT + path.sep + '.git'))) {
    throw new JevisError('PROTECTED', T(`${tilde(p)}: asistanın kendi dosyaları; onları taşımam ya da çöpe atmam.`, `${tilde(p)}: the assistant's own files; I don't move them or put them in the Trash.`));
  }
}

const isGitProject = p => statOf(path.join(p, '.git')) !== null;

function countFiles(p, limit = 5000) {
  let n = 0;
  const walk = d => {
    for (const name of readdir(d)) {
      if (n >= limit) return;
      const full = path.join(d, name);
      const st = statOf(full);
      if (st?.isDirectory()) walk(full); else n++;
    }
  };
  if (statOf(p)?.isDirectory()) walk(p); else n = 1;
  return n;
}

function journal(entry) {
  const line = { id: `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 4)}`, at: Date.now(), ...entry };
  fs.mkdirSync(JEVIS_HOME, { recursive: true });
  fs.appendFileSync(JOURNAL(), `${JSON.stringify(line)}\n`);
  return line;
}

function journalEntries() {
  try { return fs.readFileSync(JOURNAL(), 'utf-8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; }
}

/** what: [Turkish ("3 öğeyi … taşımak"), English ("move 3 items into …")]. */
async function askFirst([what, whatEn], items) {
  const list = items.slice(0, 12).map(p => `• ${tilde(p)}`).join('\n') + (items.length > 12 ? T(`\n… ve ${items.length - 12} tane daha`, `\n… and ${items.length - 12} more`) : '');
  const ok = await confirmAction(T(`${APP_NAME} şunu yapmak istiyor: ${what}\n\n${list}\n\nİzin veriyor musun?`, `${APP_NAME} wants to ${whatEn}:\n\n${list}\n\nDo you allow it?`));
  if (!ok) throw new JevisError('DENIED', T(`Kullanıcı izin vermedi: ${what} yapılmadı.`, `The user didn't allow it, so nothing was done (${whatEn}).`));
}

/** Moves within the home folder; across disks it copies, then removes the original. */
function moveOne(from, to) {
  try {
    fs.renameSync(from, to);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    fs.cpSync(from, to, { recursive: true, errorOnExist: true, force: false });
    fs.rmSync(from, { recursive: true });
  }
}

export async function makeFolder(target) {
  const p = resolvePath(target);
  changeable(p);
  if (statOf(p)) throw new JevisError('EXISTS', T(`Zaten var: ${tilde(p)}`, `Already exists: ${tilde(p)}`));
  fs.mkdirSync(p, { recursive: true });
  journal({ op: 'mkdir', path: p });
  return { made: tilde(p) };
}

/** Where each of `sources` would go: into `dest` if it is a folder (or several are moved), else to `dest` itself (a rename). */
function destinations(sources, dest) {
  const intoFolder = statOf(dest)?.isDirectory() || sources.length > 1;
  return sources.map(s => [s, intoFolder ? path.join(dest, path.basename(s)) : dest]);
}

function prepare(from, to) {
  const sources = [].concat(from).map(resolvePath);
  const dest = resolvePath(to);
  for (const s of sources) {
    if (!statOf(s)) throw new JevisError('NOT_FOUND', T(`Böyle bir dosya ya da klasör yok: ${tilde(s)}`, `No such file or folder: ${tilde(s)}`));
    changeable(s, { source: true });
  }
  changeable(dest);
  const pairs = destinations(sources, dest);
  for (const [s, t] of pairs) {
    if (t === s) throw new JevisError('SAME', T(`${tilde(s)} zaten orada.`, `${tilde(s)} is already there.`));
    if (t.startsWith(s + path.sep)) throw new JevisError('INSIDE_ITSELF', T(`${tilde(s)} kendi içine taşınamaz.`, `${tilde(s)} can't be moved into itself.`));
    if (statOf(t)) throw new JevisError('EXISTS', T(`Orada aynı adla bir şey var: ${tilde(t)}. Üstüne yazmıyorum; başka bir ad ver.`, `Something with the same name is already there: ${tilde(t)}. I don't overwrite; give another name.`));
  }
  return { sources, dest, pairs };
}

export async function move(from, to) {
  const { sources, dest, pairs } = prepare(from, to);
  const projects = sources.filter(isGitProject);
  if (projects.length || sources.length > 20) await askFirst([`${sources.length} öğeyi ${tilde(dest)} içine taşımak${projects.length ? ' (git projesi var)' : ''}`, `move ${count(sources.length, 'item')} into ${tilde(dest)}${projects.length ? ' (a git project among them)' : ''}`], sources);
  let made = null;
  if (sources.length > 1 && !statOf(dest)) { fs.mkdirSync(dest, { recursive: true }); made = dest; }
  for (const [s, t] of pairs) moveOne(s, t);
  journal({ op: 'move', pairs, made });
  return { moved: pairs.map(([s, t]) => [tilde(s), tilde(t)]) };
}

export async function copy(from, to) {
  const { sources, dest, pairs } = prepare(from, to);
  const files = sources.reduce((n, s) => n + countFiles(s), 0);
  if (sources.length > 20 || files > 500) await askFirst([`${files} dosyayı ${tilde(dest)} içine kopyalamak`, `copy ${count(files, 'file')} into ${tilde(dest)}`], sources);
  let made = null;
  if (sources.length > 1 && !statOf(dest)) { fs.mkdirSync(dest, { recursive: true }); made = dest; }
  for (const [s, t] of pairs) fs.cpSync(s, t, { recursive: true, errorOnExist: true, force: false });
  journal({ op: 'copy', pairs, made });
  return { copied: pairs.map(([s, t]) => [tilde(s), tilde(t)]) };
}

/** To the Trash (never deleted for good); Finder's "Put Back" and files_undo bring it back. */
export async function trash(targets) {
  const paths = [].concat(targets).map(resolvePath);
  for (const p of paths) {
    if (!statOf(p)) throw new JevisError('NOT_FOUND', T(`Böyle bir dosya ya da klasör yok: ${tilde(p)}`, `No such file or folder: ${tilde(p)}`));
    changeable(p, { source: true });
  }
  const folders = paths.filter(p => statOf(p).isDirectory());
  if (folders.length || paths.length > 3) {
    const files = paths.reduce((n, p) => n + countFiles(p), 0);
    const git = paths.some(isGitProject);
    await askFirst([`${paths.length} öğeyi Çöp Sepeti'ne atmak (${files} dosya${git ? ', git projesi var' : ''})`, `put ${count(paths.length, 'item')} in the Trash (${count(files, 'file')}${git ? ', a git project among them' : ''})`], paths);
  }
  const { stdout } = await execFileAsync('/usr/bin/trash', ['-v', ...paths], { timeout: 60000 });
  const pairs = [...stdout.matchAll(/Moved "(.+)" to "(.+)"/g)].map(m => [m[1], m[2]]);
  journal({ op: 'trash', pairs });
  return { trashed: pairs.map(([s]) => tilde(s)) };
}

/** Turns the last file change back (from this journal; one step at a time). */
export async function undo() {
  const entries = journalEntries();
  const undone = new Set(entries.filter(e => e.op === 'undo').map(e => e.of));
  const last = [...entries].reverse().find(e => e.op !== 'undo' && !undone.has(e.id));
  if (!last) throw new JevisError('NOTHING', T('Geri alınacak bir dosya işi yok.', 'There is no file change to undo.'));
  const done = [];
  if (last.op === 'mkdir') {
    if (readdir(last.path).length) throw new JevisError('NOT_EMPTY', T(`${tilde(last.path)} artık boş değil; geri almıyorum.`, `${tilde(last.path)} isn't empty anymore; I'm not undoing it.`));
    fs.rmdirSync(last.path);
    done.push(T(`${tilde(last.path)} kaldırıldı`, `${tilde(last.path)} removed`));
  } else if (last.op === 'move' || last.op === 'trash') {
    for (const [s, t] of [...last.pairs].reverse()) {
      if (statOf(s)) throw new JevisError('EXISTS', T(`${tilde(s)} yerinde artık başka bir şey var; geri almıyorum.`, `Something else is at ${tilde(s)} now; I'm not undoing it.`));
      if (!statOf(t)) throw new JevisError('NOT_FOUND', T(`${tilde(t)} artık yok; geri alınamıyor.`, `${tilde(t)} is gone; it can't be undone.`));
      fs.mkdirSync(path.dirname(s), { recursive: true });
      moveOne(t, s);
      done.push(T(`${tilde(s)} geri geldi`, `${tilde(s)} is back`));
    }
    if (last.made && !readdir(last.made).length) fs.rmdirSync(last.made);
  } else if (last.op === 'copy') {
    const copies = last.pairs.map(([, t]) => t).filter(t => statOf(t));
    if (copies.length) await execFileAsync('/usr/bin/trash', copies, { timeout: 60000 });
    if (last.made && !readdir(last.made).length) fs.rmdirSync(last.made);
    done.push(T(`${copies.length} kopya Çöp Sepeti'ne atıldı`, `${copies.length === 1 ? '1 copy' : `${copies.length} copies`} put in the Trash`));
  }
  journal({ op: 'undo', of: last.id });
  return { undone: last.op, done };
}
