// Handry · © 2026 Berat Olekli (purplefox) · github.com/purplefox21/handry
// Approving from the phone by iMessage. A fake Messages database in a temp
// folder stands in for ~/Library/Messages/chat.db (the real one is never
// opened) and iMessages are only recorded, not sent. Checks: the question
// goes out with a code; only the bare code from the user's own conversation
// approves (Handry's own message, a wrong code, the right code from someone
// else don't); "hayır" refuses; no answer is a no; the screen stays locked
// for the hands while waiting; and an approval request is never read as an
// SMS code by verification_code. Then the same in English (JEVIS_LANG=en):
// the question in English, "no" refuses, the bare code approves.
// Usage: node tests/remote-approve-e2e.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'handry-remote-'));
const db = path.join(home, 'chat.db');
const ME = '+905551112233';
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({
  notify: { imessageTo: '+90 555 111 22 33' },
  codes: { smsDb: db },
  confirm: { remoteAfterSec: 0, remoteTimeoutSec: 8 }
}));
process.env.JEVIS_HOME = home;
process.env.JEVIS_TEST_NOTIFY = 'record';
process.env.JEVIS_TEST_CONFIRM = 'remote';

execFileSync('/usr/bin/sqlite3', [db, [
  'CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT);',
  'CREATE TABLE chat (ROWID INTEGER PRIMARY KEY, chat_identifier TEXT);',
  'CREATE TABLE message (ROWID INTEGER PRIMARY KEY, text TEXT, attributedBody BLOB, date INTEGER, is_from_me INTEGER, handle_id INTEGER);',
  'CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER);',
  `INSERT INTO handle VALUES (1, '${ME}'), (2, '+905559998877');`,
  `INSERT INTO chat VALUES (1, '${ME}'), (2, '+905559998877');`
].join('\n')]);

const messages = await import('../guard/messages.js');
const remote = await import('../guard/remote-approve.js');
const confirm = await import('../guard/confirm.js');
const codes = await import('../hands/codes.js');

const q = s => `'${String(s).replace(/'/g, "''")}'`;
let nextId = 1;
function insert(text, { fromMe = 1, who = 1, at = Date.now() } = {}) {
  const id = nextId++;
  execFileSync('/usr/bin/sqlite3', [db, `INSERT INTO message VALUES (${id}, ${q(text)}, NULL, ${messages.toAppleNs(at)}, ${fromMe}, ${who}); INSERT INTO chat_message_join VALUES (${who}, ${id});`]);
}
const sent = () => {
  const f = path.join(home, 'notify-test.log');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf-8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(l => l.imessage) : [];
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, ms = 5000) {
  const until = Date.now() + ms;
  for (;;) { const v = await fn(); if (v || Date.now() > until) return v; await sleep(100); }
}
const settle = (p, ms) => Promise.race([p, sleep(ms).then(() => 'bekliyor')]);
const ASK = 'Handry şunu yapmak istiyor:\n\n"Publish" öğesine tıklamak\n\nSayfa: Test\nNeden soruluyor: riskli kelime: "publish"\n\nİzin veriyor musun?';
const ASK_EN = 'Handry wants to do this:\n\nclick "Publish"\n\nPage: Test\nWhy I\'m asking: risky word: "publish"\n\nDo you allow it?';
/** Starts a question and returns { answer, code } once the iMessage with the code has gone out. */
async function ask(message = ASK) {
  const before = sent().length;
  const answer = confirm.confirmAction(message);
  const prompt = await waitFor(() => sent().slice(before).find(m => messages.isApprovalRequest(m.imessage)));
  return { answer, prompt, code: prompt?.imessage.match(/(?:sadece şunu yaz|reply with just): (\d{4})/)?.[1] };
}

let passed = 0, total = 0;
async function check(name, fn) {
  total++;
  const started = Date.now();
  let ok = false, note = '';
  try { const r = await fn(); ok = r && typeof r === 'object' && 'ok' in r ? Boolean(r.ok) : Boolean(r); note = r?.note || ''; } catch (err) { note = err.stack?.split('\n').slice(0, 2).join(' ') || err.message; }
  if (ok) passed++;
  console.log(`${ok ? '✅' : '❌'} ${String(Date.now() - started).padStart(6)} ms  ${name}${note ? `\n          → ${note}` : ''}`);
}

try {
  await check('Adres eşleşmesi: aynı numara farklı yazılış, Apple ID büyük/küçük harf, başka numara değil', () =>
    messages.sameAddress('+90 555 111 22 33', ME) && messages.sameAddress('05551112233', ME) && messages.sameAddress('Ben@iCloud.com', 'ben@icloud.com')
    && !messages.sameAddress('+905559998877', ME) && !messages.sameAddress('', ''));

  await check('Cevap okuma: sadece kodun kendisi onay, kısa "hayır" ret, gerisi hiçbir şey', () => {
    const v = t => remote.verdictOf(t, '4821');
    const cases = [['4821', 'yes'], ['evet 4821', 'yes'], ['4821 evet', 'yes'], [' 4821. ', 'yes'], ['Hayır', 'no'], ['hayir', 'no'], ['iptal', 'no'],
      ['48210', null], ['kod 4821 mi?', null], ['4822', null], ['evet', null], [remote.promptText(ASK, '4821'), null], ['Handry: 4821', null]];
    const bad = cases.filter(([t, want]) => v(t) !== want).map(([t, want]) => `"${t.slice(0, 30)}" → ${v(t)} (beklenen ${want})`);
    return { ok: !bad.length, note: bad.join(' | ') };
  });

  await check('Telefona sorulabilir mi: adres + okunabilen veritabanı; adres ya da erişim yoksa hayır', async () => {
    const ok = await remote.remoteReady({ fresh: true });
    const noAddress = await remote.remoteReady({ to: '', fresh: true });
    const noAccess = await remote.remoteReady({ db: path.join(home, 'yok.db'), fresh: true });
    await remote.remoteReady({ fresh: true });
    return { ok: ok.ok && !noAddress.ok && !noAccess.ok, note: `${noAddress.reason} | ${noAccess.reason}` };
  });

  await check('Soru iMessage ile gidiyor: ne yapılacağı, 4 haneli kod, "hayır" seçeneği; Mac sorusu metne girmiyor', async () => {
    const { answer, prompt, code } = await ask();
    insert('hayır');
    await answer;
    const t = prompt?.imessage || '';
    return { ok: Boolean(code) && /"Publish" öğesine tıklamak/.test(t) && /Reddetmek için: hayır/.test(t) && !/İzin veriyor musun/.test(t) && sameTo(prompt), note: t.split('\n')[0] };
  });
  function sameTo(m) { return m?.to === '+90 555 111 22 33'; }

  await check('Kodu kendine yazınca onaylanıyor; Handry\'nin kendi mesajı onay sayılmıyor; beklerken eller ekrana dokunmuyor', async () => {
    const { answer, prompt, code } = await ask();
    const lockedWhileWaiting = confirm.dialogOpen();
    insert(prompt.imessage);                // Handry's own question in the same conversation
    insert(prompt.imessage, { fromMe: 0 }); // and as texting yourself can show it: received
    const early = await settle(answer, 3000);
    insert(code);
    const result = await settle(answer, 5000);
    const ack = await waitFor(() => sent().some(m => m.imessage.includes('Onaylandı')), 2000);
    return { ok: lockedWhileWaiting && early === 'bekliyor' && result === true && ack && !confirm.dialogOpen(), note: `beklerken kilit: ${lockedWhileWaiting}, kendi mesajıyla: ${early}, kodla: ${result}` };
  });

  await check('"Hayır" yazınca reddediliyor ve telefona haber gidiyor', async () => {
    const { answer } = await ask();
    insert('Hayır');
    const result = await settle(answer, 5000);
    const ack = await waitFor(() => sent().some(m => m.imessage.includes('Reddedildi')), 2000);
    return { ok: result === false && ack, note: `sonuç ${result}` };
  });

  await check('Yanlış kod ve başkasından gelen doğru kod onaylamıyor; cevap gelmezse süre sonunda hayır', async () => {
    const { answer, code } = await ask();
    insert(String(((Number(code) - 1000 + 1) % 9000) + 1000)); // a wrong code from the user
    insert(code, { fromMe: 0, who: 2 });                        // the right code from someone else
    const result = await settle(answer, 12000);
    const told = await waitFor(() => sent().some(m => m.imessage.includes('Cevap gelmedi')), 2000);
    return { ok: result === false && told && !confirm.dialogOpen(), note: `sonuç ${result}` };
  });

  await check('verification_code onay mesajını SMS kodu sanmıyor', async () => {
    insert(`${messages.APPROVAL_MARK}:\n\nDoğrulama kodun: 482913\n\nOnaylamak için sadece şunu yaz: 4821`, { fromMe: 0 });
    const found = await codes.findSmsCode({ db });
    insert('Doğrulama kodunuz: 556677', { fromMe: 0, who: 2 });
    const real = await codes.findSmsCode({ db });
    return { ok: found === null && real?.code === '556677', note: `onay mesajından: ${found?.code ?? 'yok'}, gerçek SMS: ${real?.code}` };
  });

  // English: the same rules, the texts in English.
  process.env.JEVIS_LANG = 'en';

  await check('English: replies are read the same way; "no" refuses, approving still takes the bare code', () => {
    const v = t => remote.verdictOf(t, '4821');
    const cases = [['4821', 'yes'], ['No', 'no'], ['no.', 'no'], ['cancel', 'no'], ['Hayır', 'no'],
      ['yes', null], ['yes 4821', null], ['ok', null], ['nothing', null], [remote.promptText(ASK_EN, '4821'), null], ['Handry: 4821', null]];
    const bad = cases.filter(([t, want]) => v(t) !== want).map(([t, want]) => `"${t.slice(0, 30)}" → ${v(t)} (expected ${want})`);
    return { ok: !bad.length, note: bad.join(' | ') };
  });

  await check('English: the question goes out in English with the code and "no"; the Mac question stays out; "no" refuses', async () => {
    const { answer, prompt, code } = await ask(ASK_EN);
    const t = prompt?.imessage || '';
    insert('no');
    const result = await settle(answer, 5000);
    const ack = await waitFor(() => sent().some(m => m.imessage.includes('Refused')), 2000);
    return {
      ok: Boolean(code) && t.startsWith('Handry: approval needed') && /click "Publish"/.test(t) && /To refuse: no/.test(t) && !/Do you allow it/.test(t) && !/Onaylamak/.test(t)
        && sameTo(prompt) && result === false && ack,
      note: `${t.split('\n')[0]} · result ${result}`
    };
  });

  await check('English: the bare code approves; Handry\'s own question does not', async () => {
    const { answer, prompt, code } = await ask(ASK_EN);
    insert(prompt.imessage);
    insert(prompt.imessage, { fromMe: 0 });
    const early = await settle(answer, 3000);
    insert(code);
    const result = await settle(answer, 5000);
    const ack = await waitFor(() => sent().some(m => m.imessage.includes('Approved')), 2000);
    return { ok: early === 'bekliyor' && result === true && ack && !confirm.dialogOpen(), note: `own message: ${early}, code: ${result}` };
  });

  await check('English: verification_code doesn\'t take the approval request for an SMS code', async () => {
    insert(`${messages.approvalMark('en')}\n\nYour verification code: 482913\n\nTo approve, reply with just: 4821`, { fromMe: 0 });
    const found = await codes.findSmsCode({ db }); // the newest real one is still the SMS from above
    return { ok: found?.code === '556677', note: `found: ${found?.code ?? 'none'} (482913 would be from the approval request)` };
  });
} finally {
  fs.rmSync(home, { recursive: true, force: true });
}

console.log(`\n${passed}/${total} geçti`);
process.exit(passed === total ? 0 : 1);
