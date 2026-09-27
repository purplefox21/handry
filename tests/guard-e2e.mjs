// Phase 3 guards end to end: Keychain secrets with allowed sites, log redaction,
// login/2FA detection, wait_for_user, prompt-injection hiding, emergency stop,
// per-site confirm rules and approval screenshots.
// Usage: node tests/guard-e2e.mjs   (adds and removes a test Keychain item)
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { callTool } from '../core/tools.js';
import { config, homeDir } from '../core/config.js';
import * as browser from '../hands/browser.js';
import * as vault from '../guard/vault.js';
import { requestStop, clearStop } from '../guard/stop.js';
import { HIDDEN_MARK } from '../guard/page-guard.js';

const FIXTURES = new URL('./fixtures/', import.meta.url).pathname;
const SECRET = 'test-secret-123';

const server = http.createServer((req, res) => {
  const file = path.join(FIXTURES, path.normalize(req.url.split('?')[0]).replace(/^\/+/, ''));
  if (!file.startsWith(FIXTURES) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const HOST = `127.0.0.1:${server.address().port}`;
const BASE = `http://${HOST}`;

execFileSync('security', ['add-generic-password', '-a', 'jevis-test', '-s', 'jevis', '-w', SECRET, '-U']);
vault.registerSecret('jevis-test', [HOST]);

const call = async (name, args) => {
  const r = await callTool(name, args);
  return { ...r, text: r.content.filter(c => c.type === 'text').map(c => c.text).join('\n') };
};
const dom = async fn => (await browser.activePage()).evaluate(fn);

let passed = 0;
const results = [];
async function check(name, fn) {
  let ok = false;
  let note = '';
  try { ok = Boolean(await fn()); } catch (err) { note = err.message; }
  if (ok) passed++;
  results.push(name);
  console.log(`${ok ? '✅' : '❌'} ${name}${note ? `  → ${note}` : ''}`);
}

try {
  process.env.JEVIS_TEST_CONFIRM = 'deny';
  clearStop();

  await call('browser_open', { url: `${BASE}/login.html` });
  await call('browser_type', { target: 'Email', text: 'berat@example.com' });
  const fill = await call('browser_fill_secret', { target: 'Password', secret: 'jevis-test' });
  await check('Şifre Anahtar Zinciri\'nden alana yazıldı', () => !fill.isError && dom(() => document.getElementById('password').value === 'test-secret-123'));
  await check('Şifre araç cevabında görünmüyor', () => !fill.text.includes(SECRET));

  await call('browser_open', { url: `http://localhost:${HOST.split(':')[1]}/login.html` });
  const wrongSite = await call('browser_fill_secret', { target: 'Password', secret: 'jevis-test' });
  await check('İzinsiz sitede şifre yazılmadı', async () => wrongSite.isError && wrongSite.text.includes('sadece şu sitelerde') && await dom(() => document.getElementById('password').value === ''));

  await call('browser_open', { url: `${BASE}/login.html` });
  await call('browser_fill_secret', { target: 'Password', secret: 'jevis-test' });
  const signIn = await call('browser_click', { target: 'Sign In' });
  await check('Giriş sonrası 2FA sayfası "kullanıcı gerekli" diye işaretlendi', () => signIn.text.includes('Two-Factor') && signIn.text.includes('wait_for_user'));

  process.env.JEVIS_TEST_CONFIRM = 'allow';
  const waited = await call('wait_for_user', { message: 'Doğrulama kodunu gir.' });
  await check('wait_for_user kullanıcıyı bekleyip devam etti', () => waited.text.includes('tamamladı'));
  process.env.JEVIS_TEST_CONFIRM = 'deny';

  const today = new Date().toISOString().slice(0, 10);
  const logText = fs.readFileSync(path.join(homeDir('logs'), `${today}.jsonl`), 'utf-8');
  await check('Günlükte şifre yok', () => !logText.includes(SECRET) && logText.includes('browser_fill_secret'));

  await call('browser_open', { url: `${BASE}/injection.html` });
  const read = await call('browser_read', {});
  await check('Gizli talimat beyne gitmeden gizlendi', () => read.text.includes(HIDDEN_MARK) && !read.text.includes('attacker@evil.example'));
  await check('Normal içerik (plaj yazısı, "Click Save…") korunuyor', () => read.text.includes('Kabak Bay') && read.text.includes('Click Save to keep') && read.text.includes('Aya Yorgi'));

  requestStop('test');
  const stopped = await call('browser_read', {});
  await check('Acil durdurma: araç çalışmadı', () => stopped.isError && stopped.text.includes('acil durdurma'));
  clearStop();
  const resumed = await call('browser_read', { include_text: false });
  await check('Durdurma kaldırılınca devam etti', () => !resumed.isError);

  await call('browser_open', { url: `${BASE}/appstore-like.html` });
  await call('browser_type', { target: 'Name', text: 'Site Kuralı' });
  config().confirm.sites[HOST] = { neverAsk: ['Save'] };
  const save = await call('browser_click', { target: 'Save' });
  await check('Site kuralı: bu sitede "Save" onaysız', async () => !save.isError && await dom(() => document.getElementById('status').textContent === 'Changes saved.'));
  delete config().confirm.sites[HOST];

  process.env.JEVIS_TEST_CONFIRM = 'allow';
  const approved = await call('browser_click', { target: 'Add for Review' });
  const lastLog = fs.readFileSync(path.join(homeDir('logs'), `${today}.jsonl`), 'utf-8').trim().split('\n').pop();
  const shot = JSON.parse(lastLog).screenshot;
  await check('Onaylanan riskli işlemin kanıt ekran görüntüsü alındı', () => approved.text.includes('Kullanıcı onayladı') && shot && fs.existsSync(shot));
} finally {
  await vault.removeSecret('jevis-test');
  server.close();
}

console.log(`\n${passed}/${results.length} geçti`);
process.exit(passed === results.length ? 0 : 1);
