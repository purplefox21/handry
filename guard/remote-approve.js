// Approving from the phone. When the Mac's confirmation dialog gets no answer
// for a while (confirm.remoteAfterSec), the user gets an iMessage with a
// 4-digit code. Texting back exactly that code approves; "hayır" refuses.
// The reply is read from the Messages database (texting yourself shows up there).
//
// Why it can't approve itself: the code goes only into the iMessage, never to
// the brain; a reply counts only if it is the bare code (Handry's own message
// carries it in a sentence, every other iMessage Handry sends starts with
// "Handry:"); and while the question is open the desktop tools don't touch the
// screen, so nothing can type the code into Messages.
import crypto from 'node:crypto';
import { config } from '../core/config.js';
import { APP_NAME } from '../core/brand.js';
import { sendIMessage } from './notify.js';
import { APPROVAL_MARK, canRead, decodeAttributedBody, fromAppleNs, messagesDb, query, sameAddress, toAppleNs } from './messages.js';

const settings = () => ({ remote: true, remoteAfterSec: 20, remoteTimeoutSec: 600, ...(config().confirm || {}) });
const address = () => config().notify?.imessageTo || '';

let readyCache = { at: 0, value: null };

/** Can a question go to the phone now? { ok, reason }. The database check is remembered for a minute. */
export async function remoteReady({ to = address(), db = messagesDb(), fresh = false } = {}) {
  if (settings().remote === false) return { ok: false, reason: 'confirm.remote kapalı' };
  if (!to) return { ok: false, reason: 'iMessage adresi yok: node cli.js notify set <telefon ya da Apple ID>' };
  if (fresh || Date.now() - readyCache.at > 60_000 || readyCache.db !== db) {
    readyCache = { at: Date.now(), db, value: await canRead(db) };
  }
  return readyCache.value ? { ok: true } : { ok: false, reason: 'Mesajlar okunamıyor (Tam Disk Erişimi gerekiyor)' };
}

/** 'yes' for the bare code ("4821", "evet 4821", "4821 evet"), 'no' for a short refusal, else null. */
export function verdictOf(text, code) {
  const t = String(text || '').trim().toLocaleLowerCase('tr').replace(/[.!]+$/, '');
  if (new RegExp(`^(evet\\s+)?${code}(\\s+evet)?$`).test(t)) return 'yes';
  if (t.length <= 20 && /^(hayır|hayir|red|reddet|iptal|no)\b/.test(t)) return 'no';
  return null;
}

/** The question as it goes to the phone: what Handry wants to do, without the dialog's closing question. */
export function promptText(message, code) {
  const what = String(message).replace(/\n*İzin veriyor musun\?\s*$/, '').replace(/\n*Devam edeyim mi\?\s*$/, '').trim().slice(0, 700);
  return `${APPROVAL_MARK}:\n\n${what}\n\nOnaylamak için sadece şunu yaz: ${code}\nReddetmek için: hayır`;
}

/** Messages in the user's own conversation since `sinceMs` (both directions: texting yourself can show up either way). */
async function repliesSince(sinceMs, to, db) {
  const rows = await query(`SELECT m.ROWID AS id, m.date AS date, COALESCE(m.text,'') AS text, hex(m.attributedBody) AS body, COALESCE(h.id,'') AS handle, COALESCE(c.chat_identifier,'') AS chat
    FROM message m LEFT JOIN handle h ON h.ROWID = m.handle_id
    LEFT JOIN chat_message_join cmj ON cmj.message_id = m.ROWID LEFT JOIN chat c ON c.ROWID = cmj.chat_id
    WHERE m.date > ${toAppleNs(sinceMs)} ORDER BY m.date ASC LIMIT 50;`, db);
  return rows
    .filter(r => sameAddress(r.handle, to) || sameAddress(r.chat, to))
    .map(r => ({ id: r.id, at: fromAppleNs(r.date), text: r.text || decodeAttributedBody(r.body) }));
}

/**
 * After afterSec without an answer, texts the question to the phone and watches for the reply.
 * onAnswer(true|false) is called once. stop(how) ends it; if the question already went out,
 * the phone is told it was answered on the Mac.
 */
export function startRemote({ message, onAnswer, afterSec = settings().remoteAfterSec, to = address(), db = messagesDb() }) {
  let stopped = false, sent = false, poller = null;
  const code = String(crypto.randomInt(1000, 10000));
  const finish = ok => {
    if (stopped) return;
    stopped = true;
    clearInterval(poller);
    sendIMessage(`${APP_NAME}: ${ok ? '✅ Onaylandı, devam ediyorum.' : '⛔ Reddedildi, yapmıyorum.'}`, to).catch(() => {});
    onAnswer(ok);
  };
  const timer = setTimeout(async () => {
    if (stopped) return;
    const since = Date.now() - 1000;
    try {
      await sendIMessage(promptText(message, code), to);
    } catch {
      return; // no iMessage: the Mac dialog is still there
    }
    sent = true;
    let busy = false;
    poller = setInterval(async () => {
      if (stopped || busy) return;
      busy = true;
      try {
        for (const r of await repliesSince(since, to, db)) {
          const v = verdictOf(r.text, code);
          if (v) return finish(v === 'yes');
        }
      } catch {} finally { busy = false; }
    }, 2000);
  }, Math.max(0, afterSec) * 1000);
  return {
    get sent() { return sent; },
    stop(how) {
      if (stopped) return;
      stopped = true;
      clearTimeout(timer);
      clearInterval(poller);
      if (sent && how === 'mac') sendIMessage(`${APP_NAME}: Mac'te cevaplandı, bir şey yazmana gerek yok.`, to).catch(() => {});
      if (sent && how === 'timeout') sendIMessage(`${APP_NAME}: Cevap gelmedi, yapmadım.`, to).catch(() => {});
    }
  };
}
