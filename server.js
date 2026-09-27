import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT) || 3000;
const HOST = '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');

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

const server = http.createServer(async (req, res) => {
  if (!isTrustedRequest(req)) {
    sendJson(res, 403, { error: 'Bu sunucuya sadece bu bilgisayardaki JEVIS arayüzünden erişilebilir.' });
    return;
  }

  if (req.url.startsWith('/api/') && !hasValidToken(req)) {
    sendJson(res, 401, { error: 'Geçersiz oturum anahtarı. Sayfayı yenileyin.' });
    return;
  }

  // API Proxy endpoint
  if (req.url === '/api/evaluate' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
    });

    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        // Check JEV_KEY or TYPESAFE_API_KEY from headers or process.env or .env file
        let apiKey = req.headers['authorization']?.replace('Bearer ', '') || process.env.TYPESAFE_API_KEY || process.env.JEV_KEY;
        if (!apiKey) {
          try {
            const envContent = fs.readFileSync(path.join(__dirname, '.env'), 'utf-8');
            const match = envContent.match(/(?:JEV_KEY|TYPESAFE_API_KEY)=([^\r\n]+)/);
            if (match) apiKey = match[1].trim();
          } catch (e) {}
        }

        if (!apiKey) {
          sendJson(res, 400, {
            error: 'API Key eksik! Lütfen arayüzden TypeSafe API anahtarınızı girin veya TYPESAFE_API_KEY ortam değişkenini ayarlayın.'
          });
          return;
        }

        const startTime = Date.now();
        const typesafeRes = await fetch('https://api.typesafe.ai/v1/systemone', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            state: payload.state,
            model: payload.model || 'jev-latest',
            questions: payload.questions
          })
        });

        const elapsedMs = Date.now() - startTime;
        const data = await typesafeRes.json();

        if (!typesafeRes.ok) {
          sendJson(res, typesafeRes.status, {
            error: data.message || data.error || 'TypeSafe API hatası',
            details: data,
            status: typesafeRes.status
          });
          return;
        }

        sendJson(res, 200, { ...data, _client_latency_ms: elapsedMs });
      } catch (err) {
        sendJson(res, 500, { error: err.message });
      }
    });
    return;
  }

  // macOS Automation Endpoint
  if (req.url === '/api/macos/execute' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
    });

    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        const { dispatchCommand } = await import('./jev-dispatcher.js');
        const customKey = req.headers['authorization']?.replace('Bearer ', '');
        const result = await dispatchCommand(payload.command, customKey);
        sendJson(res, 200, result);
      } catch (err) {
        sendJson(res, 500, { error: err.message });
      }
    });
    return;
  }

  // Static File Serving
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/' || reqPath === '') {
    reqPath = '/index.html';
  }

  const filePath = path.join(PUBLIC_DIR, reqPath);

  // Prevent path traversal
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

    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`🚀 Jev Playground hazır: http://localhost:${PORT}`);
});
