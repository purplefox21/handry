// One-time codes the user gets by SMS or e-mail ("we sent you a code"):
// the newest fresh one is read for the user so they don't have to look at the
// phone. Only the code and who sent it come back, never other messages.
// SMS: the Messages database on this Mac (iPhone text forwarding must be on;
// the app that runs this needs Full Disk Access, which only the user grants).
// E-mail: the Gmail inbox in the Handry Chrome (the user is logged in there).
import { config } from '../core/config.js';
import { JevisError } from '../core/errors.js';
import { APPLE_EPOCH, APPROVAL_MARK, decodeAttributedBody, messagesDb, query, toAppleNs } from '../guard/messages.js';
import * as browser from './browser.js';

export { decodeAttributedBody };

const sleep = ms => new Promise(r => setTimeout(r, ms));

// A message only counts as a code message when it talks about a code.
const KEYWORD = /(kod|code|otp|doğrulama|dogrulama|verification|verify|şifre|sifre|password|passcode|\bpin\b|güvenlik|guvenlik|security|onay|confirm)/i;
const NEAR = '(?:kod\\w*|code|otp|pin|passcode|password|şifre\\w*|sifre\\w*|verification|doğrulama\\w*|dogrulama\\w*)';

/** The code in a message text, or null. "Doğrulama kodunuz: 482913", "G-482913 is your Google verification code", "482 913". */
export function extractCode(text) {
  let t = String(text || '').replace(/\s+/g, ' ');
  if (!KEYWORD.test(t)) return null;
  t = t.replace(/\b(\d{3})[ -](\d{3})\b/g, '$1$2');
  const after = t.match(new RegExp(`${NEAR}\\D{0,40}?\\b(\\d{4,8})\\b`, 'i'));
  if (after) return after[1];
  const before = t.match(new RegExp(`\\b(\\d{4,8})\\b\\D{0,40}?${NEAR}`, 'i'));
  if (before) return before[1];
  return t.match(/\b(\d{6})\b/)?.[1] || null;
}

const clean = s => String(s || '').replace(/[^\p{L}\p{N} .,+@_-]/gu, '').trim().slice(0, 40);
// Turkish lower-casing turns "I" into "ı": fold both sides so "GARANTI" matches "garanti".
const fold = s => String(s).toLocaleLowerCase('tr').replace(/ı/g, 'i').replace(/̇/g, '');
const matchesFrom = (hint, ...parts) => !hint || fold(parts.join(' ')).includes(fold(hint));

/** The newest fresh code among the last messages: { code, from, ageSec } or null. */
export async function findSmsCode({ withinMin = 5, from, db = messagesDb() } = {}) {
  const cutoff = toAppleNs(Date.now() - withinMin * 60 * 1000);
  const rows = await query(`SELECT m.date AS date, COALESCE(m.text,'') AS text, hex(m.attributedBody) AS body, COALESCE(h.id,'') AS sender FROM message m LEFT JOIN handle h ON h.ROWID = m.handle_id WHERE m.is_from_me = 0 AND m.date > ${cutoff} ORDER BY m.date DESC LIMIT 40;`, db);
  for (const r of rows) {
    const body = r.text || decodeAttributedBody(r.body);
    // Handry's own approval request carries a code too (texting yourself can show it as received)
    if (body.startsWith(APPROVAL_MARK)) continue;
    if (!matchesFrom(from, r.sender, body)) continue;
    const code = extractCode(body);
    if (code) return { code, from: clean(r.sender), ageSec: Math.max(0, Math.round(Date.now() / 1000 - (r.date / 1e9 + APPLE_EPOCH))) };
  }
  return null;
}

/** "21:04" or "9:04 PM" → minutes ago today; anything else (a date) is older than today → null. */
export function minutesAgoToday(label, now = new Date()) {
  const m = String(label || '').trim().match(/^(\d{1,2})[:.](\d{2})\s*(AM|PM|ÖÖ|ÖS)?$/i);
  if (!m) return null;
  let h = Number(m[1]);
  const pm = m[3] && /^(PM|ÖS)$/i.test(m[3]);
  const am = m[3] && /^(AM|ÖÖ)$/i.test(m[3]);
  if (pm && h < 12) h += 12;
  if (am && h === 12) h = 0;
  const then = new Date(now);
  then.setHours(h, Number(m[2]), 0, 0);
  const diff = (now - then) / 60000;
  return diff < -1 ? null : Math.max(0, Math.round(diff)); // a time later than now isn't from today
}

/** Newest fresh code among inbox rows ({ sender, subject, snippet, time }): { code, from, ageMin } or null. */
export function findInboxCode(rows, { withinMin = 5, from, now = new Date() } = {}) {
  for (const r of rows) {
    const age = minutesAgoToday(r.time, now);
    if (age === null || age > withinMin) continue;
    if (!matchesFrom(from, r.sender, r.subject)) continue;
    const code = extractCode(`${r.subject} ${r.snippet}`);
    if (code) return { code, from: clean(r.sender), ageMin: age };
  }
  return null;
}

function inboxRowsInPage() {
  const rows = [...document.querySelectorAll('tr.zA, [role="main"] tr[role="row"]')].slice(0, 15);
  return rows.map(tr => ({
    sender: tr.querySelector('.yW')?.innerText || '',
    subject: tr.querySelector('.bog')?.innerText || '',
    snippet: (tr.querySelector('.y2')?.innerText || '').replace(/^\s*-\s*/, ''),
    time: tr.querySelector('.xW')?.innerText || ''
  }));
}

/** Looks at the Gmail inbox in a temporary tab of the Handry Chrome. */
export async function findGmailCode({ withinMin = 5, from, url = config().codes?.gmailUrl || 'https://mail.google.com/mail/u/0/#inbox' } = {}) {
  const rows = await browser.withTempPage(url, async page => {
    await page.waitForSelector('tr.zA, [role="main"] tr[role="row"]', { timeout: 15000 }).catch(() => {});
    if (/accounts\.google\.com/.test(page.url())) throw new JevisError('NOT_LOGGED_IN', "Gmail'e Handry'nin Chrome'unda giriş yapılmamış. Önce login_window aracıyla bir kere giriş yap.");
    return page.evaluate(inboxRowsInPage);
  });
  return findInboxCode(rows, { withinMin, from });
}

/**
 * Looks for a code and keeps looking up to waitSec for one that has not arrived yet.
 * source: 'sms' | 'gmail'. Returns { code, from, ageSec } or null.
 */
export async function waitForCode({ source, withinMin = 5, from, waitSec = 0, ...opts }) {
  const started = Date.now();
  for (;;) {
    const found = source === 'sms'
      ? await findSmsCode({ withinMin, from, ...opts })
      : await findGmailCode({ withinMin, from, ...opts });
    if (found) return { ...found, ageSec: found.ageSec ?? found.ageMin * 60 };
    if (Date.now() - started + 4000 > waitSec * 1000) return null;
    await sleep(source === 'sms' ? 2000 : 5000);
  }
}
