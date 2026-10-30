// Commands from the phone by iMessage, and sending to the phone. A fake
// Messages database in a temp folder stands in for ~/Library/Messages/chat.db
// (the real one is never opened); iMessages are only recorded, not sent; a
// stand-in runner plays the brain. Checks: "Handry, …" from the user's own
// conversation runs and the answer goes back; nothing from before the start,
// no message without the name, nothing from someone else, nothing Handry sent
// itself, no double run when texting yourself shows a message twice; a slow
// task gets a "üzerindeyim"; "ekranı göster" sends a screenshot without the
// brain; phone_send sends text (always with the name in front) and a real
// screenshot of this Mac (recorded, not sent).
// Usage: node tests/phone-e2e.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'handry-phone-'));
const db = path.join(home, 'chat.db');
const ME = '+905551112233';
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ notify: { imessageTo: '+90 555 111 22 33' }, codes: { smsDb: db } }));
process.env.JEVIS_HOME = home;
process.env.JEVIS_TEST_NOTIFY = 'record';

execFileSync('/usr/bin/sqlite3', [db, [
  'CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT);',
  'CREATE TABLE chat (ROWID INTEGER PRIMARY KEY, chat_identifier TEXT);',
  'CREATE TABLE message (ROWID INTEGER PRIMARY KEY, text TEXT, attributedBody BLOB, date INTEGER, is_from_me INTEGER, handle_id INTEGER);',
  'CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER);',
  `INSERT INTO handle VALUES (1, '${ME}'), (2, '+905559998877');`,
  `INSERT INTO chat VALUES (1, '${ME}'), (2, '+905559998877');`
].join('\n')]);

const messages = await import('../guard/messages.js');
const phone = await import('../core/phone.js');
const { callTool } = await import('../core/tools.js');

const q = s => `'${String(s).replace(/'/g, "''")}'`;
let nextId = 1;
function insert(text, { fromMe = 1, who = 1, at = Date.now() } = {}) {
  const id = nextId++;
  execFileSync('/usr/bin/sqlite3', [db, `INSERT INTO message VALUES (${id}, ${q(text)}, NULL, ${messages.toAppleNs(at)}, ${fromMe}, ${who}); INSERT INTO chat_message_join VALUES (${who}, ${id});`]);
}
const log = path.join(home, 'notify-test.log');
const sent = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf-8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, ms = 6000) { const until = Date.now() + ms; for (;;) { const v = await fn(); if (v || Date.now() > until) return v; await sleep(100); } }

let passed = 0, total = 0;
async function check(name, fn) {
  total++;
  const started = Date.now();
  let ok = false, note = '';
  try { const r = await fn(); ok = r && typeof r === 'object' && 'ok' in r ? Boolean(r.ok) : Boolean(r); note = r?.note || ''; } catch (err) { note = err.stack?.split('\n').slice(0, 2).join(' ') || err.message; }
  if (ok) passed++;
  console.log(`${ok ? '✅' : '❌'} ${String(Date.now() - started).padStart(6)} ms  ${name}${note ? `\n          → ${note}` : ''}`);
}

// the stand-in brain: remembers what it was asked; "yavaş" takes a while
const ran = [];
const run = async command => { ran.push(command); if (/yavaş/.test(command)) await sleep(1500); return { text: `Yaptım: ${command}` }; };
const shots = [];
const shoot = async () => { const p = path.join(home, `shot-${shots.length}.jpg`); fs.writeFileSync(p, 'jpg'); shots.push(p); return { path: p }; };

let watcher;
try {
  await check('Adla başlayan mesajdan komut ayıklanıyor; adsız mesaj komut değil', () => {
    const cases = [['Handry, sesi kıs', 'sesi kıs'], ['hey handry müziği durdur', 'müziği durdur'], ['Hendri: ekranı göster', 'ekranı göster'], ['HANDRY sesi aç', 'sesi aç'],
      ['sesi kıs', null], ['Handry', null], ['Handryyy sesi kıs', null], ['bugün Handry ile çalıştım', null]];
    const bad = cases.filter(([t, want]) => phone.commandOf(t) !== want).map(([t, want]) => `"${t}" → ${phone.commandOf(t)} (beklenen ${want})`);
    return { ok: !bad.length, note: bad.join(' | ') };
  });

  await check('"Ekranı göster" türü istekler ayırt ediliyor, "ekranı kilitle" değil', () => {
    const yes = ['ekranı göster', 'ekran görüntüsü at', 'ss at', 'screenshot', 'bana ekranı gönder', 'ekran'];
    const no = ['ekranı kilitle', 'ekranı kapat', 'ekran parlaklığını aç', 'sesi kıs', 'ekranı kaydet'];
    const bad = [...yes.filter(t => !phone.wantsScreen(t)), ...no.filter(t => phone.wantsScreen(t))];
    return { ok: !bad.length, note: bad.join(', ') };
  });

  insert('Handry, eski bir komut', { at: Date.now() - 1000 }); // before the start: never runs
  watcher = phone.startPhoneCommands({ run, shoot, db, everyMs: 200, ackAfterMs: 800 });
  await sleep(500);

  await check('Kendine "Handry, …" yazınca çalışıyor ve cevap telefona gidiyor; başlamadan önceki mesaj çalışmıyor', async () => {
    insert('Handry, sesi kıs');
    const reply = await waitFor(() => sent().find(m => m.imessage === 'Handry: Yaptım: sesi kıs'));
    return { ok: Boolean(reply) && ran.length === 1 && ran[0] === 'sesi kıs', note: `çalışanlar: ${JSON.stringify(ran)}` };
  });

  await check('Aynı mesajın ikinci kopyası, adsız mesaj, başkasının mesajı ve Handry\'nin kendi mesajı çalışmıyor', async () => {
    const before = ran.length;
    insert('Handry, müziği durdur');
    insert('Handry, müziği durdur', { fromMe: 0 });       // texting yourself: the same message shows up received too
    insert('sesi aç');                                    // no name: a note to self
    insert('Handry, ekranı kilitle', { fromMe: 0, who: 2 }); // someone else
    insert('Handry: Yaptım: sesi kıs');                   // Handry's own answer
    insert(`${messages.APPROVAL_MARK}:\n\nHandry, sesi aç`); // an approval request
    await waitFor(() => sent().some(m => m.imessage === 'Handry: Yaptım: müziği durdur'));
    await sleep(800);
    await watcher.idle();
    const now = ran.slice(before);
    return { ok: now.length === 1 && now[0] === 'müziği durdur', note: `çalışanlar: ${JSON.stringify(now)}` };
  });

  await check('Uzun süren işte önce "üzerindeyim", sonra cevap', async () => {
    insert('Handry, yavaş bir iş yap');
    const answer = await waitFor(() => sent().find(m => m.imessage === 'Handry: Yaptım: yavaş bir iş yap'));
    const all = sent().map(m => m.imessage);
    const ackAt = all.indexOf('Handry: Tamam, üzerindeyim…');
    return { ok: Boolean(answer) && ackAt >= 0 && ackAt < all.indexOf(answer.imessage), note: ackAt >= 0 ? '' : 'üzerindeyim gitmedi' };
  });

  await check('"Handry ekranı göster" beyne gitmeden ekran görüntüsü gönderiyor', async () => {
    const before = ran.length;
    insert('Handry ekranı göster');
    const file = await waitFor(() => sent().find(m => m.imessageFile));
    return { ok: Boolean(file) && file.imessageFile === shots[0] && ran.length === before && file.to === '+90 555 111 22 33', note: file?.imessageFile };
  });

  watcher.stop();

  await check('phone_send: yazı her zaman "Handry:" ile, gerçek ekran görüntüsü kaydediliyor (gönderilmiyor)', async () => {
    const before = sent().length;
    const r = await callTool('phone_send', { text: '4821', screenshot: 'screen' });
    const now = sent().slice(before);
    const file = now.find(m => m.imessageFile);
    const textMsg = now.find(m => m.imessage);
    const real = file && fs.existsSync(file.imessageFile) && fs.statSync(file.imessageFile).size > 1000;
    return { ok: !r.isError && real && textMsg?.imessage === 'Handry: 4821', note: r.content.map(c => c.text).join(' ') };
  });
} finally {
  watcher?.stop();
  fs.rmSync(home, { recursive: true, force: true });
}

console.log(`\n${passed}/${total} geçti`);
process.exit(passed === total ? 0 : 1);
