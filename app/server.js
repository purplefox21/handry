// JEVIS app server: the chat UI, the Jev playground proxy and the run API.
// Listens on 127.0.0.1 only and every /api call needs the per-start token.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT, config, homeDir } from '../core/config.js';
import { getApiKey } from '../core/jev.js';
import { findBinary } from '../brain/common.js';
import { runCommand } from '../core/runner.js';
import { listChats, peekChat, newChat, switchChat, deleteChat, IDLE_MS } from '../core/chats.js';
import { listBrains } from '../brain/index.js';
import { requestStop } from '../guard/stop.js';
import { startScheduler, sortedJobs, jobView, cancelJobs } from '../core/timers.js';
import { APP, FOX, WAKE_LABEL } from '../core/brand.js';
import { recentActions } from '../guard/log.js';
import { sttStatus, transcribe, stripWake } from '../voice/stt.js';
import { ttsStatus, speak, stopSpeaking } from '../voice/tts.js';
import { listRecipes, loadRecipe, saveFromRun, deleteRecipe } from '../core/recipes.js';

const PORT = Number(process.env.PORT) || config().server.port || 3000;
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
      if (size > limit) { reject(new Error('İstek çok büyük')); req.destroy(); return; }
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
  if (activeRun) return sendJson(res, 409, { error: 'JEVIS şu an başka bir işi yapıyor. Bitmesini bekle ya da DURDUR\'a bas.' });
  const { text, brain: brainId = config().brain.default, fast = true, model, effort, source = 'window', chatId } = JSON.parse((await readBody(req)).toString() || '{}');
  if (!text?.trim()) return sendJson(res, 400, { error: 'Boş komut.' });

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
    entry.error = controller.signal.aborted ? 'Durduruldu.' : err.message;
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

// JEVIS.app records the voice itself and leaves a WAV in ~/.jevis/tmp.
async function handleVoiceFile(req, res) {
  const { file, wake } = JSON.parse((await readBody(req)).toString() || '{}');
  const dir = homeDir('tmp');
  const resolved = path.resolve(String(file || ''));
  if (path.dirname(resolved) !== dir || !/^voice-[\w-]+\.wav$/.test(path.basename(resolved)) || !fs.existsSync(resolved)) {
    return sendJson(res, 400, { error: 'Ses dosyası bulunamadı.' });
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

const ROUTES = {
  'POST /api/run': handleRun,
  'POST /api/stop': (req, res) => handleStop(res),
  'GET /api/brains': async (req, res) => {
    const cc = config().brain.providers['claude-code'] || {};
    sendJson(res, 200, { default: config().brain.default, brains: await listBrains(), claudeCode: { model: cc.model, effort: cc.effort, models: cc.models || [], efforts: cc.efforts || [] } });
  },
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
  // Timers and watches: the list (with what JEVIS saw last) and cancelling one or all.
  'GET /api/timers': (req, res) => sendJson(res, 200, { now: Date.now(), jobs: sortedJobs().map(jobView) }),
  'POST /api/timers/cancel': async (req, res) => {
    const { id, all } = JSON.parse((await readBody(req)).toString() || '{}');
    if (!id && !all) return sendJson(res, 400, { error: 'id ya da all ver.' });
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
  'GET /api/status': (req, res) => {
    let jev = true;
    try { getApiKey(); } catch { jev = false; }
    sendJson(res, 200, {
      jev,
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
    sendJson(res, 403, { error: 'Bu sunucuya sadece bu bilgisayardaki JEVIS arayüzünden erişilebilir.' });
    return;
  }
  const urlPath = req.url.split('?')[0];

  if (urlPath.startsWith('/api/')) {
    if (!hasValidToken(req)) return sendJson(res, 401, { error: 'Geçersiz oturum anahtarı. Sayfayı yenileyin.' });
    const handler = ROUTES[`${req.method} ${urlPath}`];
    if (!handler) return sendJson(res, 404, { error: 'Bilinmeyen adres.' });
    try {
      await handler(req, res);
    } catch (err) {
      if (!res.headersSent) sendJson(res, 500, { error: err.message });
      else res.end();
    }
    return;
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
      // The app's name (core/brand.js) goes into the page: {{APP}}, {{APP_DAT}}, {{FOX}}, and a meta tag for the scripts.
      const brand = encodeURIComponent(JSON.stringify({ ...APP, fox: FOX.name, wake: WAKE_LABEL }));
      const html = fs.readFileSync(filePath, 'utf-8')
        .replaceAll('{{APP}}', APP.name).replaceAll('{{APP_DAT}}', APP.dative).replaceAll('{{FOX}}', FOX.name)
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
  if (activeRun) throw new Error('JEVIS 10 dakikadır başka bir işle meşgul');
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

server.listen(PORT, HOST, () => {
  console.log(`🤖 JEVIS hazır: http://localhost:${PORT}`);
  startScheduler({ run: runScheduled });
});

export { server, PORT, SESSION_TOKEN };
