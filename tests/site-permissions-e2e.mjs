// "Bu sitede hep", new passwords and new windows, end to end.
// - Site permissions: a button the user said "always" to is not asked again on that site (and only there);
//   money, orders and deleting are never remembered; site_permissions lists and removes them.
// - browser_new_password: a strong password is typed into both fields and saved to the Keychain for this site
//   only; the value never reaches the log or the tool answer; an existing name isn't overwritten.
// - A multi-line value (recovery codes) is stored as one line.
// - browser_open new_window and browser_tabs to_window really use another Chrome window.
// Real Chrome in its own profile and port (the Handry Chrome you use is not touched), a local web server for the
// page (permissions are per host, file:// has none). Adds and removes test Keychain items.
// Usage: node tests/site-permissions-e2e.mjs
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'jevis-perm-'));
// "Archive" is asked on every site (alwaysAsk) and may be remembered: the "Bu sitede hep" flow uses it.
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ browser: { cdpPort: 9489, profileDir: path.join(home, 'chrome-profile') }, confirm: { alwaysAsk: ['Archive'] } }));
process.env.JEVIS_HOME = home;
process.env.JEVIS_TEST_CONFIRM = 'allow';
delete process.env.JEVIS_HUMAN;
const confirmLog = path.join(home, 'confirm.log');
const b = await import('../hands/browser.js');
const confirm = await import('../guard/confirm.js');
const vault = await import('../guard/vault.js');
const { callTool } = await import('../core/tools.js');
const call = async (name, args) => {
  const r = await callTool(name, args);
  return { ...r, text: r.content.filter(c => c.type === 'text').map(c => c.text).join('\n') };
};
const mode = (m, log = false) => {
  process.env.JEVIS_TEST_CONFIRM = m;
  if (log) process.env.JEVIS_TEST_CONFIRM_LOG = confirmLog; else delete process.env.JEVIS_TEST_CONFIRM_LOG;
};
const asked = () => (fs.existsSync(confirmLog) ? fs.readFileSync(confirmLog, 'utf-8').trim().split('\n').filter(Boolean).length : 0);

let passed = 0, total = 0;
async function check(name, fn) {
  total++;
  const started = Date.now();
  let ok = false, note = '';
  try { const r = await fn(); ok = r && typeof r === 'object' && 'ok' in r ? Boolean(r.ok) : Boolean(r); note = r?.note || ''; } catch (err) { note = err.stack?.split('\n').slice(0, 2).join(' ') || err.message; }
  if (ok) passed++;
  console.log(`${ok ? '✅' : '❌'} ${String(Date.now() - started).padStart(6)} ms  ${name}${note ? `\n          → ${note}` : ''}`);
}

const PAGE = `<!doctype html><meta charset="utf-8"><title>İzin testi</title><h1>İzin testi</h1>
<button onclick="clicks.archive++">Archive</button> <button onclick="clicks.send++">Send</button> <button onclick="clicks.buy++">Buy now</button>
<p><label>Password <input type="password" aria-label="Password"></label></p>
<p><label>Confirm password <input type="password" aria-label="Confirm password"></label></p>
<script>window.clicks = { archive: 0, send: 0, buy: 0 }</script>`;
const server = http.createServer((_, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(PAGE); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const A = `http://127.0.0.1:${port}/`;       // the site the user says "always" on
const B = `http://localhost:${port}/`;       // another site (another host)
const hostA = `127.0.0.1:${port}`;
const dom = async fn => (await b.activePage()).evaluate(fn);
const clicks = () => dom(() => ({ ...window.clicks }));
const winId = async page => {
  const s = await page.context().newCDPSession(page);
  try { return (await s.send('Browser.getWindowForTarget')).windowId; } finally { await s.detach().catch(() => {}); }
};
const TEST_SECRETS = ['jevis-test-newpw', 'jevis-test-newpw-old', 'jevis-test-multiline'];

try {
  // --- what may be remembered -------------------------------------------------
  await check('Hatırlanabilir ve hatırlanamaz düğmeler', () => {
    const yes = ['Save', 'Kaydet', 'Continue', 'Archive', 'Arşivle', 'Update'];
    const no = ['Ödeme yap', 'Delete account', 'Sil', 'Place order', 'Satın al', 'Buy now', 'Pay now', 'Çöp sepetine at', 'Transfer',
      // going out to other people
      'Send', 'Gönder', 'Publish', 'Yayınla', 'Yayımla', 'Submit for Review', 'Add for Review', 'Post', 'Share', 'Paylaş', 'Invite', 'Davet et', 'Release this version'];
    const wrong = [...yes.filter(n => !confirm.rememberable(n)), ...no.filter(n => confirm.rememberable(n))];
    return { ok: !wrong.length, note: wrong.join(', ') };
  });

  await check('İzin dosyası: ekle, büyük/küçük harf fark etmez, başka site yok, para düğmesi yazılmaz, kaldır', () => {
    confirm.allowOnSite('shop.example.com', 'Save changes');
    confirm.allowOnSite('shop.example.com', 'Buy now');
    const out = confirm.allowedOnSite('shop.example.com', 'SAVE CHANGES') && !confirm.allowedOnSite('other.example.com', 'Save changes')
      && !confirm.allowedOnSite('shop.example.com', 'Buy now') && confirm.sitePermissions().length === 1;
    const gone = confirm.removeSitePermission(1);
    return out && gone.name === 'Save changes' && confirm.sitePermissions().length === 0;
  });

  // --- in a real page ------------------------------------------------------------
  await b.open(A);
  await check('İlk tıklamada sorulur; "Bu sitede hep" dersen kaydedilir', async () => {
    mode('always', true);
    const r = await call('browser_click', { target: 'Archive' });
    return { ok: !r.isError && (await clicks()).archive === 1 && asked() === 1 && confirm.allowedOnSite(hostA, 'Archive'), note: `${asked()} soru, izin: ${confirm.allowedOnSite(hostA, 'Archive')}` };
  });
  await check('Bu sitede aynı düğme bir daha sorulmaz (cevap "Hayır" olsa bile)', async () => {
    mode('deny', true);
    const before = asked();
    const r = await call('browser_click', { target: 'Archive' });
    return { ok: !r.isError && (await clicks()).archive === 2 && asked() === before, note: r.text.split('\n')[0] };
  });
  await check('Başka sitede (aynı düğme) yine sorulur ve "Hayır" engeller', async () => {
    await b.open(B);
    mode('deny', true);
    const before = asked();
    const r = await call('browser_click', { target: 'Archive' });
    return { ok: r.isError && /izin vermedi/.test(r.text) && (await clicks()).archive === 0 && asked() === before + 1, note: r.text.split('\n')[0] };
  });
  await check('Dışarıya giden düğme ("Send") "hep" denince bile kaydedilmez, her seferinde sorulur', async () => {
    await b.open(A);
    mode('always', true);
    const first = await call('browser_click', { target: 'Send' });
    mode('deny', true);
    const before = asked();
    const second = await call('browser_click', { target: 'Send' });
    return { ok: !first.isError && second.isError && asked() === before + 1 && (await clicks()).send === 1 && !confirm.allowedOnSite(hostA, 'Send'), note: second.text.split('\n')[0] };
  });
  await check('Para düğmesi ("Buy now") "hep" denince bile kaydedilmez, her seferinde sorulur', async () => {
    await b.open(A);
    mode('always', true);
    const first = await call('browser_click', { target: 'Buy now' });
    mode('deny', true);
    const before = asked();
    const second = await call('browser_click', { target: 'Buy now' });
    return { ok: !first.isError && second.isError && asked() === before + 1 && (await clicks()).buy === 1 && !confirm.allowedOnSite(hostA, 'Buy now'), note: second.text.split('\n')[0] };
  });
  await check('site_permissions: listeler, kaldırınca "Archive" yine sorulur', async () => {
    // the "always" from the first check is still there (later checks opened the page again, the counters started over)
    const archived = (await clicks()).archive;
    const list = await call('site_permissions', {});
    const removed = await call('site_permissions', { remove: 1 });
    mode('deny', true);
    const r = await call('browser_click', { target: 'Archive' });
    return { ok: list.text.includes(hostA) && /yine sorulacak/.test(removed.text) && r.isError && (await clicks()).archive === archived, note: list.text.split('\n')[0] };
  });
  mode('allow');

  // --- new password -----------------------------------------------------------
  await b.open(A);
  const fields = () => dom(() => [...document.querySelectorAll('input[type=password]')].map(i => i.value));
  await check('browser_new_password: iki alana aynı güçlü şifre, Anahtar Zinciri\'ne bu site için', async () => {
    const r = await call('browser_new_password', { secret: 'jevis-test-newpw', targets: ['Password', 'Confirm password'] });
    const [p1, p2] = await fields();
    const stored = await vault.readSecret('jevis-test-newpw').catch(() => null);
    const strong = p1 && p1.length === 20 && /[A-Z]/.test(p1) && /[a-z]/.test(p1) && /\d/.test(p1) && /[-_!@#%]/.test(p1);
    const sites = vault.listSecrets().find(s => s.name === 'jevis-test-newpw')?.sites;
    return { ok: !r.isError && p1 === p2 && strong && stored === p1 && sites?.length === 1 && sites[0] === hostA && !r.text.includes(p1), note: `${r.isError ? r.text : `uzunluk ${p1?.length}, siteler ${sites}`}` };
  });
  await check('Şifre ne kayıtta ne araç cevabında geçiyor', async () => {
    const [p1] = await fields();
    const logDir = path.join(home, 'logs');
    const log = fs.existsSync(logDir) ? fs.readdirSync(logDir).filter(f => f.endsWith('.jsonl')).map(f => fs.readFileSync(path.join(logDir, f), 'utf-8')).join('\n') : '';
    return { ok: Boolean(p1) && !log.includes(p1) && /browser_new_password/.test(log), note: log.includes(p1) ? 'kayıtta var!' : '' };
  });
  await check('Aynı ad varsa üstüne yazmaz (EXISTS); replace ile eskisi "-old" olarak saklanır', async () => {
    const [before] = await fields();
    const again = await call('browser_new_password', { secret: 'jevis-test-newpw', targets: ['Password', 'Confirm password'] });
    const same = (await vault.readSecret('jevis-test-newpw')) === before;
    const rep = await call('browser_new_password', { secret: 'jevis-test-newpw', targets: ['Password', 'Confirm password'], replace: true });
    const [after] = await fields();
    const old = await vault.readSecret('jevis-test-newpw-old').catch(() => null);
    return { ok: again.isError && same && !rep.isError && after !== before && old === before && (await vault.readSecret('jevis-test-newpw')) === after, note: again.text.slice(0, 80) };
  });
  await check('Başka sitede replace denenirse reddedilir (sır sadece kendi sitesinde)', async () => {
    await b.open(B);
    const r = await call('browser_new_password', { secret: 'jevis-test-newpw', targets: ['Password', 'Confirm password'], replace: true });
    return { ok: r.isError && /sadece şu sitelerde/.test(r.text), note: r.text.slice(0, 100) };
  });
  await check('Çok satırlı değer (kurtarma kodları) tek satır olarak saklanır', async () => {
    vault.storeSecret('jevis-test-multiline', 'abcd-1111\nabcd-2222\r\n  abcd-3333 \n\n', ['example.com']);
    return (await vault.readSecret('jevis-test-multiline')) === 'abcd-1111 abcd-2222 abcd-3333';
  });

  // --- windows -----------------------------------------------------------------
  await check('browser_open new_window: gerçekten başka Chrome penceresi', async () => {
    await b.open(A);
    const first = await b.activePage();
    const w1 = await winId(first);
    const r = await call('browser_open', { url: B, new_window: true });
    const second = await b.activePage();
    const w2 = await winId(second);
    return { ok: !r.isError && second !== first && w1 !== w2 && second.url().startsWith(B), note: `pencere ${w1} → ${w2}` };
  });
  await check('browser_tabs to_window: sekme kendi penceresine geçer, eskisi kapanır, adres aynı', async () => {
    await call('browser_open', { url: `${A}?tab`, new_tab: true });
    const tab = await b.activePage();
    const w1 = await winId(tab);
    const url = tab.url();
    const r = await call('browser_tabs', { action: 'to_window' });
    const now = await b.activePage();
    const w2 = await winId(now);
    return { ok: !r.isError && tab.isClosed() && now.url() === url && w1 !== w2, note: `pencere ${w1} → ${w2}, ${r.text.split('\n')[0]}` };
  });
} finally {
  mode('allow');
  for (const name of TEST_SECRETS) await vault.removeSecret(name).catch(() => {});
  server.close();
  await b.closeChrome().catch(() => {});
  fs.rmSync(home, { recursive: true, force: true });
}

console.log(`\n${passed}/${total} geçti`);
process.exit(passed === total ? 0 : 1);
