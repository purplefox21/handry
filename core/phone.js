// Commands from the phone by iMessage. The user texts themselves "Handry, sesi
// kıs" / "Handry, turn the volume down" (or "Hey Handry …"); Handry does it like
// a command from the bar and texts the answer back ("Handry: …"). "Handry ekranı
// göster" / "Handry, show me the screen" sends a screenshot without asking an LLM.
//
// What counts: only the user's own conversation (notify.imessageTo), only
// messages that start with the name (so notes to self stay notes), only
// messages that arrive after Handry started (nothing old is replayed), and
// nothing Handry sent itself. Risky steps still ask, and away from the Mac that
// question comes to the phone with a code (guard/remote-approve.js).
// It runs in the app server, which needs Full Disk Access to read Messages;
// only the user can give that.
import { config } from './config.js';
import { APP_NAME } from './brand.js';
import { isApprovalRequest, decodeAttributedBody, fromAppleNs, messagesDb, query, sameAddress } from '../guard/messages.js';
import { sendIMessage, sendIMessageFile } from '../guard/notify.js';
import { T } from './i18n.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const firstLine = t => String(t || '').split('\n')[0];
const NAME = /^\s*(?:hey\s+)?(?:handry|hendri|hendry)(?=$|[\s,:;.!?-])[\s,:;.!?-]*/i;

/** The command in a message that starts with the name ("Handry, sesi kıs" → "sesi kıs"), else null. */
export function commandOf(text) {
  const m = String(text || '').match(NAME);
  if (!m) return null;
  return String(text).slice(m[0].length).trim() || null;
}

/** "ekranı göster", "ekran görüntüsü at", "ss at", "show me the screen": a screenshot, no LLM needed. Not "ekranı kilitle" / "lock the screen". */
export function wantsScreen(command) {
  const t = String(command || '').toLocaleLowerCase('tr').trim().replace(/[.!?]+$/, '');
  if (/^(ss|screenshot|ekran|ekranı|ekran görüntüsü)$/.test(t)) return true;
  if (/(ekran|\bss\b|screenshot)/.test(t) && /(göster|gönder|yolla|\bat\b|\bal\b|çek)/.test(t) && !/(kilitle|kapat|parlak|karart|uyut|kayd)/.test(t)) return true;
  const e = String(command || '').toLowerCase().trim().replace(/[.!?]+$/, '');
  if (/^(the\s+)?(screen|screen\s*shot)$/.test(e)) return true;
  return /\b(screen|screen\s*shot|ss)\b/.test(e) && /\b(show|send|take|grab|snap|share|text)\b|what'?s on/.test(e) && !/\b(lock|turn|shut|switch|bright|dim|sleep|record|saver|wallpaper|time)/.test(e);
}

/**
 * Watches Messages for commands and runs them one at a time.
 * run(text) → { text } does a command (the app server's runner); shoot() → { path } takes a screenshot.
 * Returns { stop }.
 */
export function startPhoneCommands({ run, shoot, to = config().notify?.imessageTo, db = messagesDb(), everyMs = 2500, log = () => {}, ackAfterMs = 4000 } = {}) {
  if (!to) {
    log(T('Telefondan komut kapalı: iMessage adresi yok (node cli.js notify set …).', 'Phone commands are off: no iMessage address (node cli.js notify set …).'));
    return { stop() {} };
  }
  let lastId = null, stopped = false, timer = null, failing = false, working = false;
  const queue = [];
  const recent = []; // { key, at }: texting yourself can show one message twice (sent and received)

  async function work() {
    working = true;
    while (queue.length && !stopped) {
      const command = queue.shift();
      const ack = setTimeout(() => sendIMessage(`${APP_NAME}: ${T('Tamam, üzerindeyim…', 'OK, I’m on it…')}`, to).catch(() => {}), ackAfterMs);
      try {
        if (wantsScreen(command)) {
          const shot = await shoot();
          clearTimeout(ack);
          await sendIMessageFile(shot.path, to);
        } else {
          const out = await run(command);
          clearTimeout(ack);
          await sendIMessage(`${APP_NAME}: ${String(out?.text || T('Tamam.', 'OK.')).trim().slice(0, 1500)}`, to);
        }
      } catch (err) {
        clearTimeout(ack);
        await sendIMessage(`${APP_NAME}: ${T('Olmadı', 'That did not work')}: ${firstLine(err.message).slice(0, 300)}`, to).catch(() => {});
      }
    }
    working = false;
  }

  async function poll() {
    try {
      if (lastId === null) {
        // start after the newest message: nothing from before Handry started runs
        const [r] = await query('SELECT COALESCE(MAX(ROWID), 0) AS id FROM message;', db);
        lastId = r?.id ?? 0;
      } else {
        const rows = await query(`SELECT m.ROWID AS id, m.date AS date, COALESCE(m.text,'') AS text, hex(m.attributedBody) AS body, COALESCE(h.id,'') AS handle, COALESCE(c.chat_identifier,'') AS chat
          FROM message m LEFT JOIN handle h ON h.ROWID = m.handle_id
          LEFT JOIN chat_message_join cmj ON cmj.message_id = m.ROWID LEFT JOIN chat c ON c.ROWID = cmj.chat_id
          WHERE m.ROWID > ${lastId} ORDER BY m.ROWID ASC LIMIT 50;`, db);
        for (const r of rows) {
          lastId = Math.max(lastId, r.id);
          if (!(sameAddress(r.handle, to) || sameAddress(r.chat, to))) continue;
          const text = r.text || decodeAttributedBody(r.body);
          if (!text || text.startsWith(`${APP_NAME}:`) || isApprovalRequest(text)) continue;
          const command = commandOf(text);
          if (!command) continue;
          const at = fromAppleNs(r.date);
          if (Date.now() - at > 5 * 60 * 1000) continue;
          const key = command.toLocaleLowerCase('tr');
          if (recent.some(x => x.key === key && Math.abs(x.at - at) < 5000)) continue;
          recent.push({ key, at });
          if (recent.length > 50) recent.shift();
          if (queue.length < 5) queue.push(command);
        }
        if (!working && queue.length) work();
      }
      if (failing) log(T('Telefondan komut: Mesajlar yine okunabiliyor.', 'Phone commands: Messages can be read again.'));
      failing = false;
    } catch (err) {
      if (!failing) log(T(`Telefondan komut: Mesajlar okunamıyor (${err.code || firstLine(err.message)}); dakikada bir yeniden denenecek.`, `Phone commands: can't read Messages (${err.code || firstLine(err.message)}); trying again every minute.`));
      failing = true;
    } finally {
      if (!stopped) timer = setTimeout(poll, failing ? 60000 : everyMs);
    }
  }

  poll();
  return {
    stop() { stopped = true; clearTimeout(timer); },
    /** Tests: wait until the queue is empty and nothing runs. */
    async idle(ms = 10000) { const until = Date.now() + ms; while ((working || queue.length) && Date.now() < until) await sleep(50); }
  };
}
