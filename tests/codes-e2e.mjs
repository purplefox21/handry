// Codes and the login window. Codes: the text parser (Turkish and English
// messages), the Messages database (a fake chat.db in a temp folder; the real
// one is never opened), the Gmail inbox (a page that looks like Gmail's rows),
// the confirmation ("Hayır" = nothing is read), and that the log never holds
// a code. Login window: the JEVIS profile Chrome is closed cleanly, reopens as
// a plain Chrome with no debugging port, and the cookie set before survives.
// Real Chrome in its own profile and port (the JEVIS Chrome you use is not touched).
// Usage: node tests/codes-e2e.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'jevis-codes-'));
const fakeDb = path.join(home, 'chat.db');
const inboxFile = path.join(home, 'inbox.html');
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({
  browser: { cdpPort: 9488, profileDir: path.join(home, 'chrome-profile') },
  codes: { smsDb: fakeDb, gmailUrl: new URL(`file://${inboxFile}`).href }
}));
process.env.JEVIS_HOME = home;
process.env.JEVIS_TEST_CONFIRM = 'allow';
process.env.JEVIS_TEST_NOTIFY = 'record';
const b = await import('../hands/browser.js');
const codes = await import('../hands/codes.js');
const { callTool } = await import('../core/tools.js');
const call = async (name, args) => {
  const r = await callTool(name, args);
  return { ...r, text: r.content.filter(c => c.type === 'text').map(c => c.text).join('\n') };
};

let passed = 0, total = 0;
async function check(name, fn) {
  total++;
  const started = Date.now();
  let ok = false, note = '';
  try { const r = await fn(); ok = Boolean(r?.ok ?? r); note = r?.note || ''; } catch (err) { note = err.stack?.split('\n').slice(0, 2).join(' ') || err.message; }
  if (ok) passed++;
  console.log(`${ok ? '✅' : '❌'} ${String(Date.now() - started).padStart(6)} ms  ${name}${note ? `\n          → ${note}` : ''}`);
}

// --- fake Messages database ---------------------------------------------------
const APPLE = 978307200;
const appleNs = agoSec => Math.floor((Date.now() / 1000 - agoSec - APPLE) * 1e9);
const blobHex = text => Buffer.concat([
  Buffer.from('streamtyped'), Buffer.from([0x81, 0xe8, 0x03, 0x84, 0x01, 0x40, 0x84, 0x84, 0x84]),
  Buffer.from('\x12NSAttributedString\x00'), Buffer.from('\x08NSObject\x00'), Buffer.from('\x08NSString'),
  Buffer.from([0x01, 0x94, 0x84, 0x01, 0x2b, Buffer.byteLength(text)]), Buffer.from(text), Buffer.from([0x86, 0x84])
]).toString('hex');
const q = s => `'${s.replace(/'/g, "''")}'`;
function makeDb() {
  fs.rmSync(fakeDb, { force: true });
  const rows = [
    // [text, attributedBody text, from me, seconds ago, sender]
    ['Haftalık sipariş özeti: 1250 TL', null, 0, 10, 'MAGAZA'],
    [null, 'G-482913 is your Google verification code', 0, 30, 'GOOGLE'],
    ['Onay kodunuz 123456. Kimseyle paylaşmayın.', null, 0, 120, 'GARANTI'],
    ['Kodum 555000 (kendi gönderdiğim)', null, 1, 20, 'ANNEM'],
    ['Eski doğrulama kodu 777888', null, 0, 600, 'ESKI']
  ];
  const sql = [
    'CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT);',
    'CREATE TABLE message (ROWID INTEGER PRIMARY KEY, text TEXT, attributedBody BLOB, date INTEGER, is_from_me INTEGER, handle_id INTEGER);',
    ...rows.map(([t, a, me, ago, sender], i) => `INSERT INTO handle VALUES (${i + 1}, ${q(sender)}); INSERT INTO message VALUES (${i + 1}, ${t === null ? 'NULL' : q(t)}, ${a === null ? 'NULL' : `X'${blobHex(a)}'`}, ${appleNs(ago)}, ${me}, ${i + 1});`)
  ].join('\n');
  execFileSync('/usr/bin/sqlite3', [fakeDb, sql]);
}

// --- a page shaped like the Gmail inbox rows ------------------------------------
const hhmm = minsAgo => { const d = new Date(Date.now() - minsAgo * 60000); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const row = (sender, subject, snippet, time) => `<tr class="zA zE" role="row"><td><div class="yW"><span>${sender}</span></div></td><td><div class="y6"><span class="bog"><span>${subject}</span></span><span class="y2"> - ${snippet}</span></div></td><td class="xW"><span>${time}</span></td></tr>`;
function makeInbox(freshOk = true) {
  fs.writeFileSync(inboxFile, `<!doctype html><meta charset="utf-8"><title>Gelen Kutusu</title><div role="main"><table><tbody>
${row('Haber Bülteni', 'Haftalık bülten', 'Bu hafta 5 yeni yazı', hhmm(0))}
${freshOk ? row('Google', 'G-482913 is your Google verification code', 'Do not share this code', hhmm(1)) : ''}
${row('GitHub', '[GitHub] Your verification code', 'Your code is 771204', hhmm(2))}
${row('Banka', 'Giriş doğrulama kodu', 'Kodunuz 998877', '10 Eki')}
</tbody></table></div>`);
}

const logText = () => {
  const dir = path.join(home, 'logs');
  return fs.existsSync(dir) ? fs.readdirSync(dir).map(f => fs.readFileSync(path.join(dir, f), 'utf-8')).join('\n') : '';
};

try {
  // --- the text parser -------------------------------------------------------
  await check('Metinden kod ayıklama: Türkçe ve İngilizce mesajlar', () => {
    const cases = [
      ['Doğrulama kodunuz: 482913', '482913'],
      ['482913 doğrulama kodunuzdur. Kimseyle paylaşmayın.', '482913'],
      ['G-482913 is your Google verification code', '482913'],
      ['Your code is 4829', '4829'],
      ['Use 482 913 as your verification code', '482913'],
      ['Tek kullanımlık şifreniz 90311', '90311'],
      ['Onay kodu: 123456. Kod 10 dakika geçerlidir.', '123456'],
      ['Your security code expires in 10 minutes. Code: 654321', '654321'],
      ['Haftalık sipariş özeti: 1250 TL', null],
      ['Toplantı 21:04 te, kapı 5678', null],
      ['', null]
    ];
    const bad = cases.filter(([t, want]) => codes.extractCode(t) !== want).map(([t, want]) => `"${t}" → ${codes.extractCode(t)} (beklenen ${want})`);
    return { ok: !bad.length, note: bad.join(' | ') || `${cases.length}/${cases.length}` };
  });

  await check('attributedBody (yeni macOS) blobundan metin çıkar', () => {
    const t = 'Doğrulama kodunuz 246810 — Türkçe karakter: ğüşiöç';
    return codes.decodeAttributedBody(blobHex(t)) === t && codes.decodeAttributedBody('') === '';
  });

  await check('Gelen kutusu satırları: bugünün saati taze, tarih eski; saat yoksa/ilerideyse sayılmaz', () => {
    const now = new Date();
    now.setHours(15, 30, 0, 0);
    const rows = [
      { sender: 'Eski', subject: 'Kod 111222 doğrulama', snippet: '', time: '10 Eki' },
      { sender: 'Google', subject: 'G-482913 is your Google verification code', snippet: '', time: '15:28' }
    ];
    return codes.minutesAgoToday('15:28', now) === 2 && codes.minutesAgoToday('3:28 PM', now) === 2 && codes.minutesAgoToday('10 Eki', now) === null
      && codes.minutesAgoToday('16:45', now) === null
      && codes.findInboxCode(rows, { now })?.code === '482913'
      && codes.findInboxCode(rows, { now, withinMin: 1 }) === null
      && codes.findInboxCode(rows, { now, from: 'github' }) === null;
  });

  // --- SMS (Messages database) ----------------------------------------------
  makeDb();
  await check('SMS: en yeni taze kod (attributedBody içindeki), gönderen ile', async () => {
    const r = await call('verification_code', { source: 'sms' });
    return { ok: !r.isError && r.text.includes('482913') && r.text.includes('GOOGLE'), note: r.text };
  });
  await check('SMS: from süzgeci, kendi gönderdiğin ve eski mesajlar sayılmaz', async () => {
    const a = await call('verification_code', { source: 'sms', from: 'garanti' });
    const b2 = await call('verification_code', { source: 'sms', from: 'annem' });
    const c = await call('verification_code', { source: 'sms', from: 'eski' });
    return { ok: a.text.includes('123456') && !b2.text.includes('555000') && !c.text.includes('777888'), note: `${a.text.slice(0, 60)} | ${b2.text.slice(0, 50)}` };
  });
  await check('SMS: within_min=1 sadece son dakikadakini bulur', async () => {
    const a = await call('verification_code', { source: 'sms', within_min: 1 });
    const b2 = await call('verification_code', { source: 'sms', within_min: 1, from: 'garanti' });
    return a.text.includes('482913') && !b2.text.includes('123456') && /bulunamadı/.test(b2.text);
  });
  await check('SMS: kullanıcı "Hayır" derse hiçbir şey okunmaz', async () => {
    process.env.JEVIS_TEST_CONFIRM = 'deny';
    const r = await call('verification_code', { source: 'sms' });
    process.env.JEVIS_TEST_CONFIRM = 'allow';
    return { ok: r.isError && !/\d{6}/.test(r.text) && /izin vermedi/.test(r.text), note: r.text };
  });
  await check('SMS: veritabanı açılamazsa Tam Disk Erişimi anlatılır (dokunulmadan)', async () => {
    const err = await codes.findSmsCode({ db: path.join(home, 'yok.db') }).then(() => null, e => e);
    return { ok: err?.code === 'NO_ACCESS' && /Tam Disk Erişimi/.test(err.message), note: err?.message?.slice(0, 80) };
  });

  // --- Gmail inbox ----------------------------------------------------------
  makeInbox();
  await b.open(new URL('./fixtures/2fa.html', import.meta.url).href);
  await check('Gmail: en yeni taze kod; eski ve kodsuz satırlar atlanır', async () => {
    const r = await call('verification_code', { source: 'gmail' });
    return { ok: !r.isError && r.text.includes('482913') && r.text.includes('Google'), note: r.text };
  });
  await check('Gmail: from süzgeci, tarihli (eski) satır sayılmaz', async () => {
    const a = await call('verification_code', { source: 'gmail', from: 'github' });
    const c = await call('verification_code', { source: 'gmail', from: 'banka' });
    return { ok: a.text.includes('771204') && !c.text.includes('998877') && /bulunamadı/.test(c.text), note: `${a.text.slice(0, 50)} | ${c.text.slice(0, 50)}` };
  });
  await check('Gmail: kod alana yazılır, sekme eskisi gibi kalır', async () => {
    const r = await call('verification_code', { source: 'gmail', target: 'Verification code' });
    const page = await b.activePage();
    const value = await page.locator('input').inputValue();
    const tabs = (await page.context().pages()).length;
    return { ok: !r.isError && value === '482913' && page.url().includes('2fa.html') && tabs === 1, note: `alan: "${value}", sekme: ${tabs}` };
  });
  await check('Gmail: kod henüz gelmediyse wait_sec ile bekler ve gelince bulur', async () => {
    makeInbox(false);
    setTimeout(() => makeInbox(true), 2500);
    const t = Date.now();
    const r = await call('verification_code', { source: 'gmail', from: 'google', wait_sec: 40 });
    return { ok: r.text.includes('482913'), note: `${Date.now() - t} ms` };
  });
  await check('Kayıtta kodun kendisi yok, "kod okundu" notu var', () => {
    const log = logText();
    const leaked = ['482913', '123456', '771204'].filter(c => log.includes(c));
    return { ok: !leaked.length && /doğrulama kodu okundu \(sms/.test(log) && /doğrulama kodu okundu \(gmail/.test(log), note: leaked.length ? `kayıtta: ${leaked}` : '' };
  });

  // --- login window ---------------------------------------------------------
  const cookie = { name: 'handry_test', value: 'kalici', url: 'https://example.com/', expires: Math.floor(Date.now() / 1000) + 86400 };
  await check('Giriş penceresi: Chrome temiz kapanır, bağlantısız açılır, port yok', async () => {
    await (await b.activePage()).context().addCookies([cookie]);
    const closed = await b.closeChrome();
    const portDown = !(await b.chromeConnectable());
    await b.launchPlainChrome('about:blank');
    const pids = b.profileChromePids();
    const cmd = execFileSync('ps', ['-o', 'command=', '-p', String(pids[0])], { encoding: 'utf-8' });
    return { ok: closed && portDown && pids.length === 1 && !(await b.chromeConnectable()) && !/remote-debugging/.test(cmd), note: `${pids.length} ana süreç` };
  });
  await check('Giriş penceresi açıkken Handry Chrome\'u başlatmaya kalkmaz, anlaşılır hata verir', async () => {
    const err = await b.ensureChrome().then(() => null, e => e);
    return { ok: err?.code === 'NO_CHROME' && /bağlantısız/.test(err.message), note: err?.message?.slice(0, 90) };
  });
  await check('Giriş penceresi kapatılır, Chrome bağlantıyla geri gelir, çerez duruyor', async () => {
    const closed = await b.closePlainChrome();
    const gone = !b.profileChromePids().length;
    const page = await b.activePage();
    const cookies = await page.context().cookies('https://example.com/');
    return { ok: closed && gone && cookies.some(c => c.name === cookie.name && c.value === cookie.value), note: `${cookies.length} çerez` };
  });
  await check('login_window aracı uçtan uca: onay, kapat, aç, bekle, kapat, geri bağlan', async () => {
    const r = await call('login_window', { url: 'about:blank' }).catch(e => ({ text: e.message }));
    const up = await b.chromeConnectable();
    const none = !b.profileChromePids().length || up;
    return { ok: !r.isError && /kapandı/.test(r.text) && up && none, note: r.text };
  });
  await check('login_window: kullanıcı "Hayır" derse Chrome\'a dokunulmaz', async () => {
    process.env.JEVIS_TEST_CONFIRM = 'deny';
    const before = b.profileChromePids().join();
    const r = await call('login_window', {});
    process.env.JEVIS_TEST_CONFIRM = 'allow';
    return { ok: r.isError && /izin vermedi/.test(r.text) && b.profileChromePids().join() === before && await b.chromeConnectable(), note: r.text };
  });
} finally {
  await b.closeChrome().catch(() => {});
  fs.rmSync(home, { recursive: true, force: true });
}

console.log(`\n${passed}/${total} geçti`);
process.exit(passed === total ? 0 : 1);
