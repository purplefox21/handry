// JEVIS app server: the chat UI, the Jev playground proxy and the run API.
// Listens on 127.0.0.1 only and every /api call needs the per-start token.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT, config, homeDir } from '../core/config.js';
import { getApiKey } from '../core/jev.js';
import { runCommand } from '../core/runner.js';
import { listBrains } from '../brain/index.js';
import { requestStop } from '../guard/stop.js';
import { recentActions } from '../guard/log.js';
import { sttStatus, transcribe } from '../voice/stt.js';
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

async function handleRun(req, res) {
  if (activeRun) return sendJson(res, 409, { error: 'JEVIS şu an başka bir işi yapıyor. Bitmesini bekle ya da DURDUR\'a bas.' });
  const { text, brain: brainId = config().brain.default, sessionId, fast = true } = JSON.parse((await readBody(req)).toString() || '{}');
  if (!text?.trim()) return sendJson(res, 400, { error: 'Boş komut.' });

  res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' });
  const send = event => { if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`); };
  const controller = new AbortController();
  activeRun = { controller };
  try {
    send(await runCommand({ text, brainId, sessionId, fast, onEvent: send, signal: controller.signal }));
  } catch (err) {
    send({ type: 'error', message: controller.signal.aborted ? 'Durduruldu.' : err.message });
  } finally {
    activeRun = null;
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

async function handleSay(req, res) {
  const { text } = JSON.parse((await readBody(req)).toString() || '{}');
  speak(text || '');
  sendJson(res, 200, { ok: true });
}

// ---------------------------------------------------------------------------
// Jev playground proxy (Karar Laboratuvarı)
// ---------------------------------------------------------------------------

async function handleEvaluate(req, res) {
  const payload = JSON.parse((await readBody(req)).toString());
  let apiKey = req.headers.authorization?.replace('Bearer ', '');
  if (!apiKey) {
    try { apiKey = getApiKey(); } catch (err) { return sendJson(res, 400, { error: err.message }); }
  }
  const startTime = Date.now();
  const typesafeRes = await fetch('https://api.typesafe.ai/v1/systemone', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: payload.state, model: payload.model || 'jev-latest', questions: payload.questions })
  });
  const data = await typesafeRes.json();
  if (!typesafeRes.ok) {
    return sendJson(res, typesafeRes.status, { error: data.message || data.error || 'TypeSafe API hatası', details: data, status: typesafeRes.status });
  }
  sendJson(res, 200, { ...data, _client_latency_ms: Date.now() - startTime });
}

// ---------------------------------------------------------------------------

const ROUTES = {
  'POST /api/run': handleRun,
  'POST /api/stop': (req, res) => handleStop(res),
  'GET /api/brains': async (req, res) => sendJson(res, 200, { default: config().brain.default, brains: await listBrains() }),
  'GET /api/log': (req, res) => sendJson(res, 200, { actions: recentActions(30) }),
  'GET /api/voice': (req, res) => sendJson(res, 200, { stt: sttStatus(), tts: ttsStatus() }),
  'POST /api/voice': handleVoice,
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
  'POST /api/evaluate': handleEvaluate
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
      const html = fs.readFileSync(filePath, 'utf-8')
        .replace('</head>', `  <meta name="jevis-token" content="${SESSION_TOKEN}">\n</head>`);
      res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
      res.end(html);
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`🤖 JEVIS hazır: http://localhost:${PORT}`);
});

export { server, PORT, SESSION_TOKEN };
