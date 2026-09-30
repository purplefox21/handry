// Faz 10 end to end: login alerts (and the iMessage a minute later, recorded
// instead of sent), browser_sessions against a local site with a login,
// browser_fill, Claude teaching JEVIS (jevis_teach → jevis_do without a
// brain), site notes, downloads, saving a value from the page, the approval
// dialog listing what was typed, tables, and numbered screenshots.
// Works in a throwaway JEVIS home; the Keychain check adds and removes a test entry.
// Usage: node tests/faz10-e2e.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';

process.env.JEVIS_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'jevis-faz10-'));
process.env.JEVIS_TEST_CONFIRM = 'allow';
process.env.JEVIS_TEST_NOTIFY = 'record';
process.env.JEVIS_RUN_ID = `test-faz10-${Date.now()}`;
const { callTool } = await import('../core/tools.js');
const { config } = await import('../core/config.js');
const browser = await import('../hands/browser.js');
const vault = await import('../guard/vault.js');

const DNS = new URL('./fixtures/dns-like.html', import.meta.url).href;
const STORE = new URL('./fixtures/appstore-like.html', import.meta.url).href;
const LOGIN = new URL('./fixtures/login.html', import.meta.url).href;
const HOME = process.env.JEVIS_HOME;
const work = fs.mkdtempSync(path.join(os.homedir(), 'Library', 'Caches', 'jevis-faz10-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const call = async (name, args) => {
  const r = await callTool(name, args);
  return { ...r, text: r.content.filter(c => c.type === 'text').map(c => c.text).join('\n') };
};
const notes = () => { try { return fs.readFileSync(path.join(HOME, 'notify-test.log'), 'utf-8').trim().split('\n').filter(Boolean).map(JSON.parse); } catch { return []; } };
const dom = async fn => (await browser.activePage()).evaluate(fn);

let passed = 0;
let total = 0;
async function check(name, fn) {
  total++;
  const started = Date.now();
  let ok = false;
  let note = '';
  try { const r = await fn(); ok = Boolean(r?.ok ?? r); note = r?.note || ''; } catch (err) { note = err.message; }
  if (ok) passed++;
  console.log(`${ok ? '✅' : '❌'} ${String(Date.now() - started).padStart(6)} ms  ${name}${note ? `\n          → ${String(note).split('\n').slice(0, 4).join('\n            ')}` : ''}`);
}

// A small site with a login: /account sends you to /login until /enter sets the cookie.
const site = http.createServer((req, res) => {
  const inside = /session=1/.test(req.headers.cookie || '');
  if (req.url === '/enter') { res.writeHead(302, { 'Set-Cookie': 'session=1; Path=/', Location: '/account' }); return res.end(); }
  if (req.url === '/account' && !inside) { res.writeHead(302, { Location: '/login' }); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  if (req.url === '/login') return res.end('<title>Giriş</title><h1>Giriş yap</h1><label>E-posta <input name=e></label><label>Şifre <input type=password name=p></label><button>Giriş</button>');
  res.end('<title>Hesabım</title><h1>Hesabım</h1><p>Alan adlarınız: ornek.com</p><button>Kaydet</button>');
});
await new Promise(r => site.listen(0, '127.0.0.1', r));
const SITE = `http://127.0.0.1:${site.address().port}`;

try {
  // 10.1 — logins
  await check('Giriş sayfası okununca kullanıcıya hemen haber veriliyor', async () => {
    await call('browser_open', { url: LOGIN });
    const r = await call('browser_read', { include_text: true });
    const alert = notes().find(n => /giriş/i.test(n.message || ''));
    return { ok: /haber verildi/.test(r.text) && alert && !alert.imessage, note: alert?.message };
  });

  await check('wait_for_user 1 dk (testte 1 sn) sürerse iMessage, çabuk biterse iMessage yok', async () => {
    Object.assign(config().notify, { imessageTo: 'test@example.invalid', imessageAfterSec: 1 });
    process.env.JEVIS_TEST_CONFIRM = 'watch';
    await call('browser_open', { url: `${DNS}?login=1` });
    const slow = await call('wait_for_user', { message: 'Giriş yap', until_text: 'Hoş geldin', timeout_sec: 10 });
    const afterSlow = notes().filter(n => n.imessage && n.to).length;
    const quick = await call('wait_for_user', { message: 'Giriş yap', until_text: 'Hoş geldin', timeout_sec: 10 });
    await sleep(1500);
    const afterQuick = notes().filter(n => n.imessage && n.to).length;
    process.env.JEVIS_TEST_CONFIRM = 'allow';
    return { ok: /tamamladı/.test(slow.text) && /tamamladı/.test(quick.text) && afterSlow === 1 && afterQuick === 1, note: `iMessage: yavaşta ${afterSlow}, hızlıda ${afterQuick - afterSlow}` };
  });

  await check('browser_sessions: giriş yapılmamış siteyi bulup söylüyor', async () => {
    const r = await call('browser_sessions', { sites: [`${SITE}/account`] });
    return { ok: /giriş gerekiyor/.test(r.text) && notes().some(n => /Şunlara giriş yapman gerekiyor/.test(n.message || '')), note: r.text };
  });

  await check('browser_sessions: giriş yapılınca "açık"', async () => {
    await call('browser_open', { url: `${SITE}/enter` });
    const r = await call('browser_sessions', { sites: [`${SITE}/account`] });
    return { ok: /: açık/.test(r.text), note: r.text };
  });

  // 10.3 — site notes
  await check('Site notu kaydediliyor ve site okununca geri geliyor', async () => {
    await call('site_note', { note: 'Kaydet düğmesi sayfanın en altında.' });
    const r = await call('browser_read', { include_text: false });
    return { ok: /önceki oturumlardan notlar/.test(r.text) && /en altında/.test(r.text), note: r.text.split('\n').slice(0, 2).join(' / ') };
  });

  // 10.2 — batch fill
  await check('browser_fill: yaş derecelendirme soruları (seçenek düğmeleri) tek çağrıda', async () => {
    await call('browser_open', { url: STORE });
    await call('browser_click', { target: 'Age Rating Edit' });
    const r = await call('browser_fill', { fields: { 'Cartoon or Fantasy Violence': 'None', 'Simulated Gambling': 'Infrequent/Mild' } });
    const s = await dom(() => [document.querySelector('[name=violence]:checked')?.value, document.querySelector('[name=gambling]:checked')?.value]);
    await call('browser_click', { target: 'Done' });
    return { ok: s[0] === 'none' && s[1] === 'mild', note: `${r.text.split('\n')[0]} · ${s.join(', ')}` };
  });

  // 10.3 — teaching (the fill below is the task being taught)
  await check('jevis_teach: Claude bir işi öğretiyor (değişkenleriyle)', async () => {
    await call('jevis_teach', { command: 'hazırlık', last_steps: 1 }).catch(() => {}); // start the lesson from here
    await call('browser_open', { url: STORE });
    await call('browser_fill', { fields: { Name: 'Kuzey Işığı', Price: '$0.99' } });
    const r = await call('jevis_teach', { command: 'Test formunda adı Kuzey Işığı yap ve fiyatı $0.99 seç' });
    return { ok: /Öğrendim/.test(r.text) && /\[x1\]/.test(r.text), note: r.text };
  });

  await check('Öğretilen iş jevis_do ile Claude\'suz, başka değerlerle yapılıyor', async () => {
    await call('browser_open', { url: 'about:blank' });
    const r = await call('jevis_do', { command: 'Test formunda adı Güney Rüzgarı yap ve fiyatı $4.99 seç' });
    const s = await dom(() => [document.getElementById('name')?.value, document.getElementById('price')?.value]);
    return { ok: /Yapıldı \(öğrenilmiş iş/.test(r.text) && s[0] === 'Güney Rüzgarı' && s[1] === '$4.99', note: `${r.text.split('\n')[0]} · ${s.join(' / ')}` };
  });

  // 10.5 — the approval lists what was typed
  await check('Onay penceresinde bu sayfada girilen değerler görünüyor', async () => {
    const log = path.join(HOME, 'confirm.log');
    process.env.JEVIS_TEST_CONFIRM_LOG = log;
    process.env.JEVIS_TEST_CONFIRM = 'deny';
    await call('browser_open', { url: STORE });
    await call('browser_fill', { fields: { Name: 'Onay Testi', Price: '$1.99' } });
    await call('browser_click', { target: 'Add for Review' });
    delete process.env.JEVIS_TEST_CONFIRM_LOG;
    process.env.JEVIS_TEST_CONFIRM = 'allow';
    const message = fs.existsSync(log) ? JSON.parse(fs.readFileSync(log, 'utf-8').trim().split('\n').at(-1)) : '';
    return { ok: /Name: Onay Testi/.test(message) && /Price: \$1\.99/.test(message), note: message.split('\n').filter(l => l.startsWith('•')).join(' · ') };
  });

  // 10.6 — tables
  await check('browser_table: DNS kayıtları JSON satırları olarak', async () => {
    await call('browser_open', { url: DNS });
    const r = await call('browser_table', { which: 'DNS kayıtları' });
    return { ok: r.text.includes('{"Tür":"A","Ad":"ornek","Değer":"203.0.113.10","TTL":"1/2 Saat"}'), note: r.text.split('\n').slice(0, 3).join(' / ') };
  });

  await check('browser_table: <div>lerle çizilmiş liste de okunuyor', async () => {
    const r = await call('browser_table', { which: 'Yönlendirmeler' });
    return { ok: r.text.includes('["blog.example","yeni.example/blog","302"]'), note: r.text.split('\n').slice(0, 3).join(' / ') };
  });

  // 10.4 — downloads and values
  await check('browser_download: dosya istenen klasöre, ikincisi üstüne yazılmadan', async () => {
    const a = await call('browser_download', { target: 'google-services.json dosyasını indir', save_to: `${work}/android/app/` });
    const b = await call('browser_download', { target: 'google-services.json dosyasını indir', save_to: `${work}/android/app/` });
    const first = path.join(work, 'android', 'app', 'google-services.json');
    const second = path.join(work, 'android', 'app', 'google-services (2).json');
    return { ok: !a.isError && !b.isError && fs.existsSync(first) && fs.existsSync(second) && fs.readFileSync(first, 'utf-8').includes('jevis-test'), note: `${a.text.split('\n')[0]} · ${b.text.split('\n')[0]}` };
  });

  await check('browser_save_value: git\'e giren .env reddediliyor, .gitignore\'lu olana yazılıyor', async () => {
    execFileSync('git', ['init', '-q', work]);
    const refused = await call('browser_save_value', { target: 'Web API anahtarı', to: 'env', name: 'FIREBASE_API_KEY', env_file: `${work}/.env` });
    fs.writeFileSync(path.join(work, '.gitignore'), '.env\n');
    const saved = await call('browser_save_value', { target: 'Web API anahtarı', to: 'env', name: 'FIREBASE_API_KEY', env_file: `${work}/.env` });
    const env = fs.readFileSync(path.join(work, '.env'), 'utf-8');
    return { ok: refused.isError && /gitignore/.test(refused.text) && !saved.isError && env.includes('FIREBASE_API_KEY=AIzaSyTESTKEY1234567890abcdefgHIJKLMN'), note: `${refused.text.split('\n')[0]} · ${saved.text}` };
  });

  await check('browser_save_value: Anahtar Zinciri\'ne yazılıyor (test kaydı silinir)', async () => {
    const r = await call('browser_save_value', { target: 'Web API anahtarı', to: 'keychain', name: 'jevis-test-savevalue' });
    const value = await vault.readSecret('jevis-test-savevalue').catch(() => '');
    await vault.removeSecret('jevis-test-savevalue');
    return { ok: !r.isError && value === 'AIzaSyTESTKEY1234567890abcdefgHIJKLMN', note: r.text };
  });

  // 10.7 — numbered screenshot
  await check('Numaralı ekran görüntüsü: liste geliyor, işaretler sayfada kalmıyor, #numara ile tıklanıyor', async () => {
    await call('browser_open', { url: DNS });
    const shot = await callTool('browser_screenshot', { marks: true });
    const legend = shot.content.find(c => c.type === 'text').text;
    const saveId = legend.match(/#(\S+) \[button\] Kaydet/)?.[1];
    const leftover = await dom(() => Boolean(document.getElementById('__jevis_marks')));
    const c = await call('browser_click', { target: `#${saveId}` });
    const status = await dom(() => document.getElementById('status').textContent);
    return { ok: saveId && !leftover && shot.content.some(x => x.type === 'image') && !c.isError && status.startsWith('Kaydedildi'), note: `#${saveId} → ${status}` };
  });
} finally {
  site.close();
  fs.rmSync(work, { recursive: true, force: true });
  fs.rmSync(HOME, { recursive: true, force: true });
}

console.log(`\n${passed}/${total} geçti`);
process.exit(passed === total ? 0 : 1);
