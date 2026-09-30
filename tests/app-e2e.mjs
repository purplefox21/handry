// Phase 5 end to end: app server API (fast path, Claude Code brain, busy
// guard, stop), the OpenAI-compatible adapter against a mock server, the chat
// UI and the compact bar, both driven through JEVIS's own browser hands.
// Usage: node tests/app-e2e.mjs   (uses the Claude subscription for two short runs)
import http from 'node:http';
import { spawn } from 'node:child_process';
import * as browser from '../hands/browser.js';
import * as desktop from '../hands/desktop.js';
import { config } from '../core/config.js';
import { makeBrain } from '../brain/openai-compatible.js';
import { clearStop } from '../guard/stop.js';

const PORT = 3921;
const BASE = `http://127.0.0.1:${PORT}`;
const FIXTURE = new URL('./fixtures/appstore-like.html', import.meta.url).href;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const serverProc = spawn(process.execPath, [new URL('../app/server.js', import.meta.url).pathname], {
  env: { ...process.env, PORT: String(PORT), JEVIS_TEST_CONFIRM: 'deny', JEVIS_NO_CHAT: '1' },
  stdio: ['ignore', 'pipe', 'inherit']
});
await new Promise(r => serverProc.stdout.once('data', r));
const token = (await (await fetch(`${BASE}/`)).text()).match(/name="jevis-token" content="([a-f0-9]+)"/)[1];
const headers = { 'Content-Type': 'application/json', 'X-Jevis-Token': token };

async function run(body, { onEvent } = {}) {
  const res = await fetch(`${BASE}/api/run`, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) return { status: res.status, error: (await res.json()).error, events: [] };
  const events = [];
  let buffer = '';
  for await (const chunk of res.body) {
    buffer += Buffer.from(chunk).toString();
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const ev = JSON.parse(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
      events.push(ev);
      onEvent?.(ev);
    }
  }
  return { status: 200, events, done: events.find(e => e.type === 'done'), route: events.find(e => e.type === 'route') };
}

let passed = 0;
let total = 0;
async function check(name, fn) {
  total++;
  const started = Date.now();
  let ok = false;
  let note = '';
  try { ok = Boolean(await fn()); } catch (err) { note = err.message; }
  if (ok) passed++;
  console.log(`${ok ? '✅' : '❌'} ${String(Date.now() - started).padStart(6)} ms  ${name}${note ? `  → ${note}` : ''}`);
}

try {
  await check('Beyin listesi: Claude Code hazır', async () => {
    const data = await (await fetch(`${BASE}/api/brains`, { headers })).json();
    return data.brains.find(b => b.id === 'claude-code')?.available;
  });

  await check('Hızlı yol (sistem): "hesap makinesini aç" beyinsiz', async () => {
    const r = await run({ text: 'hesap makinesini aç' });
    const opened = (await desktop.apps()).some(a => a.bundleId === 'com.apple.calculator');
    if (opened) await desktop.quitApp('Hesap Makinesi');
    return r.route?.route === 'app_open' && r.done?.fast && opened;
  });

  await browser.open(FIXTURE);
  await check('Hızlı yol (sayfa): "fiyatlandırma bölümüne tıkla" beyinsiz', async () => {
    const r = await run({ text: 'fiyatlandırma bölümüne tıkla' });
    const log = await (await browser.activePage()).evaluate(() => window.__log);
    return r.route?.route === 'page_click' && r.done?.fast && log.includes('nav:pricing');
  });

  await check('Beyin (Claude Code): formu doldur', async () => {
    // fast: false, so JEVIS neither replays nor learns this task: the test is about the brain.
    const r = await run({ text: "Chrome'da açık test sayfasında Name alanına 'Sohbet Testi' yaz ve fiyatı $0.99 yap. Başka bir şeye dokunma.", fast: false });
    const tools = r.events.filter(e => e.type === 'tool').map(e => e.name);
    const page = await browser.activePage();
    const state = await page.evaluate(() => [document.getElementById('name').value, document.getElementById('price').value]);
    console.log(`        araçlar: ${tools.join(', ')} · ${(r.done?.ms / 1000).toFixed(1)} sn`);
    return r.done?.brain === 'claude-code' && state[0] === 'Sohbet Testi' && state[1] === '$0.99' && r.done?.sessionId;
  });

  await check('Aynı anda ikinci iş reddediliyor, DURDUR işi kesiyor', async () => {
    let firstTool = null;
    const long = run({ text: "Chrome'daki test sayfasındaki her bir alanı tek tek oku, her birinin değerini ayrı ayrı doğrula ve sonunda uzun bir rapor yaz.", fast: false },
      { onEvent: ev => { if (ev.type === 'tool' && !firstTool) firstTool = Date.now(); } });
    await sleep(1500);
    const busy = await run({ text: 'ikinci iş' });
    while (!firstTool) await sleep(200);
    const stopAt = Date.now();
    await fetch(`${BASE}/api/stop`, { method: 'POST', headers });
    const r = await long;
    const stoppedIn = Date.now() - stopAt;
    console.log(`        durdurma süresi: ${stoppedIn} ms`);
    return busy.status === 409 && stoppedIn < 5000 && (r.done?.stopped || r.events.some(e => e.type === 'error'));
  });

  clearStop(); // the stop above stays on until the user's next command
  await check('OpenAI uyumlu adaptör (sahte sunucu): araç çağırıp cevap veriyor', async () => {
    let calls = 0;
    const mock = http.createServer((req, res) => {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        calls++;
        const sent = JSON.parse(body || '{}');
        const hasToolResult = sent.messages?.some(m => m.role === 'tool');
        const message = hasToolResult
          ? { role: 'assistant', content: 'Sayfada Name alanı var.' }
          : { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'browser_verify', arguments: JSON.stringify({ expectation: 'the page has a Name field' }) } }] };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message }] }));
      });
    });
    await new Promise(r => mock.listen(0, '127.0.0.1', r));
    config().brain.providers.mock = { baseURL: `http://127.0.0.1:${mock.address().port}`, apiKeyEnv: '', model: 'mock' };
    const events = [];
    const out = await makeBrain('mock', 'Sahte').run({ text: 'Name alanı var mı?', onEvent: e => events.push(e) });
    mock.close();
    return calls === 2 && events.some(e => e.type === 'tool' && e.name === 'browser_verify') && events.some(e => e.type === 'tool_result' && e.text.startsWith('Evet')) && out.text === 'Sayfada Name alanı var.';
  });

  await check('Arayüz: sohbet kutusunu JEVIS\'in kendi elleriyle kullan', async () => {
    process.env.JEVIS_TEST_CONFIRM = 'allow'; // "Gönder" is a risky word; this test process answers its dialog
    await browser.open(`${BASE}/`, { newTab: true });
    await browser.type('Komut', 'hesap makinesini aç');
    await browser.click('Gönder');
    await browser.wait({ text: 'Bitti', ms: 20000 });
    const v = await browser.verify('the chat shows the command "hesap makinesini aç" and a finished fast-path answer that the calculator was opened');
    await browser.closeTab();
    if ((await desktop.apps()).some(a => a.bundleId === 'com.apple.calculator')) await desktop.quitApp('Hesap Makinesi');
    return v.yes;
  });

  await check('Çubuk: komut yaz, Enter, cevap; büyük pencerenin geçmişine düşüyor', async () => {
    await browser.open(`${BASE}/bar.html`, { newTab: true });
    await browser.type('Komut', 'şu an hangi şarkı çalıyor', { submit: true });
    await browser.wait({ text: 'Bitti', ms: 20000 });
    const page = await browser.activePage();
    const answer = await page.textContent('#answer');
    await browser.closeTab();
    const history = await (await fetch(`${BASE}/api/history`, { headers })).json();
    const last = history.runs.at(-1);
    console.log(`        cevap: ${answer}`);
    return /çal/.test(answer) && last?.source === 'bar' && last.text === 'şu an hangi şarkı çalıyor' && last.fast;
  });
} finally {
  serverProc.kill();
}

console.log(`\n${passed}/${total} geçti`);
process.exit(passed === total ? 0 : 1);
