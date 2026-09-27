import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer(async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
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
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'API Key eksik! Lütfen arayüzden TypeSafe API anahtarınızı girin veya TYPESAFE_API_KEY ortam değişkenini ayarlayın.'
          }));
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
          res.writeHead(typesafeRes.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: data.message || data.error || 'TypeSafe API hatası',
            details: data,
            status: typesafeRes.status
          }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ...data,
          _client_latency_ms: elapsedMs
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
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

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
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

    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Jev Playground hazır: http://localhost:${PORT}`);
});
