// Handry · © 2026 Berat Olekli (purplefox) · github.com/purplefox21/handry
// Handry app server: the chat UI, the Jev playground proxy and the run API.
// Listens on 127.0.0.1 only and every /api call needs the per-start token.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { ROOT, config, homeDir } from '../core/config.js';
import { jevOff } from '../core/jev.js';
import { findBinary } from '../brain/common.js';
import { runCommand } from '../core/runner.js';
import { listChats, peekChat, newChat, switchChat, deleteChat, IDLE_MS } from '../core/chats.js';
import { listBrains } from '../brain/index.js';
import { setupState, installClaude, loginClaude, dismissSetup } from '../core/setup.js';
import { guidePage } from '../core/guide.js';
import { requestStop } from '../guard/stop.js';
import { startScheduler, sortedJobs, jobView, cancelJobs } from '../core/timers.js';
import { APP, FOX, WAKE_LABEL, CREDIT, COPYRIGHT, HANDLE, AUTHOR_URL, REPO_URL, LINKEDIN_URL } from '../core/brand.js';
import { recentActions } from '../guard/log.js';
import { undo as undoFiles } from '../hands/files.js';
import { sttStatus, transcribe, stripWake } from '../voice/stt.js';
import { ttsStatus, speak, stopSpeaking } from '../voice/tts.js';
import { listRecipes, loadRecipe, saveFromRun, deleteRecipe } from '../core/recipes.js';
import { APP_NAME } from '../core/brand.js';
import { startPhoneCommands } from '../core/phone.js';
import { screenshot } from '../hands/desktop.js';
import { T, lang, languageSetting, macLanguage, setLanguage } from '../core/i18n.js';

const PORT = Number(process.env.PORT) || config().server.port || 4263;
process.env.JEVIS_UI_PORT = String(PORT); // browser hands skip this app's own tab
const HOST = '127.0.0.1';
const PUBLIC_DIR = path.join(ROOT, 'app', 'public');

// A fresh secret per server start. It is embedded only in pages this server
// serves; without CORS headers no other website can read it, so other sites
// can't drive the API even though it listens on this machine.
const SESSION_TOKEN = crypto.randomBytes(24).toString('hex');
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// Rejects DNS-rebinding hosts and requests coming from other origins.
function isTrustedRequest(req) {
  if (!ALLOWED_HOSTS.has(req.headers.host)) return false;
  const origin = req.headers.origin;
  if (origin !== undefined && !ALLOWED_HOSTS.has(origin.replace(/^http:\/\//, ''))) return false;
  return true;
}

function hasValidToken(req) {
  const token = req.headers['x-jevis-token'];
  if (typeof token !== 'string' || token.length !== SESSION_TOKEN.length) return false;
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(SESSION_TOKEN));
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req, limit = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) { reject(new Error(T('İstek çok büyük', 'The request is too big'))); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Runs: one at a time; events stream to the page as NDJSON.
// ---------------------------------------------------------------------------

let activeRun = null;

// The last runs, so the chat window can show what was asked in the bar.
const HISTORY = [];
const remember = entry => { HISTORY.push(entry); if (HISTORY.length > 50) HISTORY.shift(); };

async function handleRun(req, res) {
  if (activeRun) return sendJson(res, 409, { error: T(`${APP_NAME} şu an başka bir işi yapıyor. Bitmesini bekle ya da DURDUR'a bas.`, `${APP_NAME} is busy with another task. Wait for it to finish or press STOP.`) });
  const { text, brain: brainId = config().brain.default, fast = true, model, effort, source = 'window', chatId } = JSON.parse((await readBody(req)).toString() || '{}');
  if (!text?.trim()) return sendJson(res, 400, { error: T('Boş komut.', 'The command is empty.') });

  res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' });
  const send = event => { if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`); };
  const controller = new AbortController();
  activeRun = { controller };
  const entry = { at: Date.now(), source, text, tools: 0 };
  const onEvent = ev => { if (ev.type === 'tool') entry.tools++; send(ev); };
  try {
    const done = await runCommand({ text, brainId, fast, model, effort, onEvent, signal: controller.signal, chatId, source });
    Object.assign(entry, { id: done.runId, answer: done.text, ms: done.ms, fast: done.fast, learnedReplay: done.learnedReplay, recipe: done.recipe, brain: done.brain, model: done.model, stopped: done.stopped, learned: done.learned });
    send(done);
  } catch (err) {
    entry.error = controller.signal.aborted ? T('Durduruldu.', 'Stopped.') : err.message;
    send({ type: 'error', message: entry.error });
  } finally {
    activeRun = null;
    remember(entry);
    res.end();
  }
}

function handleStop(res) {
  requestStop('arayüz');
  activeRun?.controller.abort();
  stopSpeaking();
  sendJson(res, 200, { stopped: true });
}

// ---------------------------------------------------------------------------
// Voice: 16 kHz WAV from the page → whisper.cpp → text; replies via `say`.
// ---------------------------------------------------------------------------

async function handleVoice(req, res) {
  const audio = await readBody(req);
  const file = path.join(homeDir('tmp'), `voice-${Date.now()}.wav`);
  fs.writeFileSync(file, audio);
  try {
    sendJson(res, 200, { text: await transcribe(file) });
  } finally {
    fs.rmSync(file, { force: true });
  }
}

// Handry.app records the voice itself and leaves a WAV in ~/.jevis/tmp.
async function handleVoiceFile(req, res) {
  const { file, wake } = JSON.parse((await readBody(req)).toString() || '{}');
  const dir = homeDir('tmp');
  const resolved = path.resolve(String(file || ''));
  if (path.dirname(resolved) !== dir || !/^voice-[\w-]+\.wav$/.test(path.basename(resolved)) || !fs.existsSync(resolved)) {
    return sendJson(res, 400, { error: T('Ses dosyası bulunamadı.', "Couldn't find the recording.") });
  }
  try {
    const text = await transcribe(resolved);
    sendJson(res, 200, { text: wake ? stripWake(text) : text });
  } finally {
    fs.rmSync(resolved, { force: true });
  }
}

async function handleSay(req, res) {
  const { text } = JSON.parse((await readBody(req)).toString() || '{}');
  speak(text || '');
  sendJson(res, 200, { ok: true });
}

// ---------------------------------------------------------------------------
// Language: "tr", "en" or "auto" (core/i18n.js). Handry.app notices a change
// and restarts itself with this server; the page waits for that, then reloads.
// ---------------------------------------------------------------------------

let byApp;
/** Did Handry.app start this server (so it restarts on a language change)? Not when it reuses `npm start`. */
function startedByApp() {
  if (byApp === undefined) {
    try {
      byApp = /\.app\/Contents\/MacOS\//.test(execFileSync('ps', ['-o', 'comm=', '-p', String(process.ppid)], { encoding: 'utf-8', timeout: 2000 }));
    } catch {
      byApp = false;
    }
  }
  return byApp;
}

async function handleLanguage(req, res) {
  const { language } = JSON.parse((await readBody(req)).toString() || '{}');
  if (!['tr', 'en', 'auto'].includes(language)) {
    return sendJson(res, 400, { error: T('language: "tr", "en" ya da "auto" olmalı.', 'language must be "tr", "en" or "auto".') });
  }
  const before = lang();
  const now = setLanguage(language);
  sendJson(res, 200, { language: now, restart: now !== before && startedByApp() });
}

// ---------------------------------------------------------------------------

const ROUTES = {
  'POST /api/run': handleRun,
  'POST /api/stop': (req, res) => handleStop(res),
  'GET /api/brains': async (req, res) => {
    const cc = config().brain.providers['claude-code'] || {};
    sendJson(res, 200, { default: config().brain.default, brains: await listBrains(), claudeCode: { model: cc.model, effort: cc.effort, models: cc.models || [], efforts: cc.efforts || [] } });
  },
  'GET /api/setup': async (req, res) => sendJson(res, 200, await setupState()),
  'POST /api/setup/install-claude': (req, res) => sendJson(res, 200, installClaude()),
  'POST /api/setup/login-claude': (req, res) => sendJson(res, 200, loginClaude()),
  'POST /api/setup/dismiss': (req, res) => sendJson(res, 200, dismissSetup()),
  'GET /api/log': (req, res) => sendJson(res, 200, { actions: recentActions(30) }),
  'GET /api/voice': (req, res) => sendJson(res, 200, { stt: sttStatus(), tts: ttsStatus() }),
  'POST /api/voice': handleVoice,
  'POST /api/voice/file': handleVoiceFile,
  'GET /api/history': (req, res) => sendJson(res, 200, { runs: HISTORY }),
  // Chats: the list, the current one (entries included), a new one, switching, deleting.
  'GET /api/chats': (req, res) => sendJson(res, 200, { current: peekChat()?.id || null, chats: listChats() }),
  'GET /api/chats/current': (req, res) => {
    const chat = peekChat();
    // A chat that went quiet 2 hours ago is shown until the next command starts a new one.
    sendJson(res, 200, { chat, stale: Boolean(chat && chat.entries.length && Date.now() - chat.updated >= IDLE_MS) });
  },
  'POST /api/chats/new': (req, res) => sendJson(res, 200, { chat: newChat() }),
  'POST /api/chats/switch': async (req, res) => sendJson(res, 200, { chat: switchChat(JSON.parse((await readBody(req)).toString()).id) }),
  'POST /api/chats/delete': async (req, res) => {
    deleteChat(JSON.parse((await readBody(req)).toString()).id);
    sendJson(res, 200, { ok: true });
  },
  // The action log (written by the code, not told by the AI): one day, newest first, and which days there are.
  'GET /api/log': (req, res) => {
    const dir = homeDir('logs');
    const days = fs.readdirSync(dir).filter(f => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).map(f => f.slice(0, 10)).sort().reverse();
    const asked = new URL(req.url, 'http://x').searchParams.get('day');
    const day = days.includes(asked) ? asked : days[0];
    let entries = [];
    if (day) {
      entries = fs.readFileSync(path.join(dir, `${day}.jsonl`), 'utf-8').split('\n').filter(Boolean)
        .map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean).reverse().slice(0, 2000);
    }
    sendJson(res, 200, { day: day || null, days: days.slice(0, 30), entries });
  },
  // The last file change (new folder, move, copy, to the Trash) turned back.
  'POST /api/files/undo': async (req, res) => {
    try {
      const r = await undoFiles();
      sendJson(res, 200, { ok: true, text: T(`Geri alındı: ${r.done.join('; ')}`, `Undone: ${r.done.join('; ')}`) });
    } catch (err) {
      sendJson(res, 200, { ok: false, text: err.message });
    }
  },
  // Timers and watches: the list (with what Handry saw last) and cancelling one or all.
  'GET /api/timers': (req, res) => sendJson(res, 200, { now: Date.now(), jobs: sortedJobs().map(jobView) }),
  'POST /api/timers/cancel': async (req, res) => {
    const { id, all } = JSON.parse((await readBody(req)).toString() || '{}');
    if (!id && !all) return sendJson(res, 400, { error: T('id ya da all ver.', 'Give an id or all.') });
    sendJson(res, 200, { cancelled: cancelJobs(all ? 'all' : id).map(jobView) });
  },
  'POST /api/say': handleSay,
  'GET /api/recipes': (req, res) => sendJson(res, 200, { recipes: listRecipes() }),
  'POST /api/recipes': async (req, res) => {
    const { name, runId, description } = JSON.parse((await readBody(req)).toString() || '{}');
    sendJson(res, 200, { recipe: saveFromRun(name, runId, { description }) });
  },
  'POST /api/recipes/show': async (req, res) => sendJson(res, 200, { recipe: loadRecipe(JSON.parse((await readBody(req)).toString()).name) }),
  'POST /api/recipes/delete': async (req, res) => {
    deleteRecipe(JSON.parse((await readBody(req)).toString()).name);
    sendJson(res, 200, { ok: true });
  },
  // "Is this really our server?" The app asks before reusing whatever answers on its port.
  'GET /api/ping': (req, res) => sendJson(res, 200, { jevis: true, name: APP_NAME, by: CREDIT, pid: process.pid }),
  // What Handry speaks now, what was chosen ("auto" follows the Mac), and the Mac's own language.
  'GET /api/language': (req, res) => sendJson(res, 200, { language: lang(), setting: languageSetting(), mac: macLanguage() }),
  'POST /api/language': handleLanguage,
  'GET /api/status': (req, res) => {
    sendJson(res, 200, {
      jev: !jevOff(),
      claude: Boolean(findBinary('claude')),
      chrome: fs.existsSync(config().browser.chromePath),
      voice: sttStatus().ok
    });
  }
};

export function registerRoute(key, handler) {
  ROUTES[key] = handler;
}

const server = http.createServer(async (req, res) => {
  if (!isTrustedRequest(req)) {
    sendJson(res, 403, { error: T(`Bu sunucuya sadece bu bilgisayardaki ${APP_NAME} arayüzünden erişilebilir.`, `Only ${APP_NAME}'s own window on this computer can use this server.`) });
    return;
  }
  const urlPath = req.url.split('?')[0];

  if (urlPath.startsWith('/api/')) {
    if (urlPath !== '/api/ping' && !hasValidToken(req)) return sendJson(res, 401, { error: T('Geçersiz oturum anahtarı. Sayfayı yenileyin.', 'The session key is not valid. Reload the page.') });
    const handler = ROUTES[`${req.method} ${urlPath}`];
    if (!handler) return sendJson(res, 404, { error: T('Bilinmeyen adres.', 'Unknown address.') });
    try {
      await handler(req, res);
    } catch (err) {
      if (!res.headersSent) sendJson(res, 500, { error: err.message });
      else res.end();
    }
    return;
  }

  if (urlPath === '/guide') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(guidePage());
  }
  const filePath = path.join(PUBLIC_DIR, urlPath === '/' ? '/index.html' : urlPath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    if (ext === '.html') {
      // The app's name (core/brand.js) goes into the page: {{APP}}, {{APP_DAT}}, {{FOX}}, who made it ({{COPYRIGHT}}, {{HANDLE}}), and a meta tag for the scripts
      // (with the language the page shows: common.js puts in the English texts).
      const brand = encodeURIComponent(JSON.stringify({ ...APP, fox: FOX.name, wake: WAKE_LABEL, lang: lang(), language: languageSetting() }));
      const html = fs.readFileSync(filePath, 'utf-8')
        .replaceAll('{{APP}}', APP.name).replaceAll('{{APP_DAT}}', APP.dative).replaceAll('{{APP_GEN}}', APP.genitive).replaceAll('{{FOX}}', FOX.name)
        .replaceAll('{{COPYRIGHT}}', COPYRIGHT).replaceAll('{{HANDLE}}', HANDLE).replaceAll('{{AUTHOR_URL}}', AUTHOR_URL).replaceAll('{{REPO_URL}}', REPO_URL)
        // the LinkedIn link only when there is one
        .replace(/<span class="linkedin"[^>]*>[\s\S]*?<\/span>/g, LINKEDIN_URL ? m => m.replaceAll('{{LINKEDIN_URL}}', LINKEDIN_URL) : '')
        .replace('</head>', `  <meta name="jevis-token" content="${SESSION_TOKEN}">\n  <meta name="app-brand" content="${brand}">\n</head>`);
      res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
      res.end(html);
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
    fs.createReadStream(filePath).pipe(res);
  });
});

// Scheduled "command" tasks run like a command from the user, once nothing else is running.
async function runScheduled(text, job = {}) {
  for (let i = 0; i < 300 && activeRun; i++) await new Promise(r => setTimeout(r, 2000));
  if (activeRun) throw new Error(T(`${APP_NAME} 10 dakikadır başka bir işle meşgul`, `${APP_NAME} has been busy with another task for 10 minutes`));
  const controller = new AbortController();
  activeRun = { controller };
  const entry = { at: Date.now(), source: 'timer', text, tools: 0 };
  try {
    const done = await runCommand({ text, source: 'timer', chatId: job.chatId, switchChat: false, signal: controller.signal, onEvent: ev => { if (ev.type === 'tool') entry.tools++; } });
    Object.assign(entry, { id: done.runId, answer: done.text, ms: done.ms, fast: done.fast, brain: done.brain });
  } finally {
    activeRun = null;
    remember(entry);
  }
}

// Commands texted from the phone ("Handry, …") run the same way, one at a time; the answer goes back by iMessage.
async function runPhone(text) {
  for (let i = 0; i < 300 && activeRun; i++) await new Promise(r => setTimeout(r, 2000));
  if (activeRun) throw new Error(T(`${APP_NAME} 10 dakikadır başka bir işle meşgul`, `${APP_NAME} has been busy with another task for 10 minutes`));
  const controller = new AbortController();
  activeRun = { controller };
  const entry = { at: Date.now(), source: 'phone', text, tools: 0 };
  try {
    const done = await runCommand({ text, source: 'phone', signal: controller.signal, onEvent: ev => { if (ev.type === 'tool') entry.tools++; } });
    Object.assign(entry, { id: done.runId, answer: done.text, ms: done.ms, fast: done.fast, brain: done.brain });
    return done;
  } finally {
    activeRun = null;
    remember(entry);
  }
}

// The app started this server. When the app is gone without saying goodbye (force quit, crash), go too: the next
// launch would otherwise find this one and keep talking to it, with the old code.
if (process.env.JEVIS_OWNED === '1') {
  const parent = process.ppid;
  setInterval(() => { if (process.ppid !== parent) process.exit(0); }, 2000).unref();
}

server.on('error', err => {
  if (err.code === 'EADDRINUSE') console.error(T(`${APP_NAME} başlamadı: ${PORT} portunu başka bir program kullanıyor (handry.config.json › server.port ile değiştirilebilir).`, `${APP_NAME} didn't start: another program is using port ${PORT} (you can change it in handry.config.json › server.port).`));
  else console.error(err);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(T(`🤖 ${APP_NAME} hazır: http://localhost:${PORT}`, `🤖 ${APP_NAME} is ready: http://localhost:${PORT}`));
  startScheduler({ run: runScheduled });
  if (config().phone?.commands !== false) startPhoneCommands({ run: runPhone, shoot: () => screenshot({ fullScreen: true }), log: m => console.log(m) });
});

export { server, PORT, SESSION_TOKEN };
