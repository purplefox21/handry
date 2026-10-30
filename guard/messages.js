// The Messages database on this Mac (~/Library/Messages/chat.db), read only:
// one-time codes the user got by SMS (hands/codes.js) and approvals the user
// texted back from the phone (guard/remote-approve.js). Reading it needs Full
// Disk Access for the app that runs Handry; only the user can grant that.
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { config, expandHome } from '../core/config.js';
import { JevisError } from '../core/errors.js';
import { APP_NAME } from '../core/brand.js';

export const APPLE_EPOCH = 978307200; // Messages counts from 2001-01-01
export const toAppleNs = ms => Math.floor((ms / 1000 - APPLE_EPOCH) * 1e9);
export const fromAppleNs = ns => (Number(ns) / 1e9 + APPLE_EPOCH) * 1000;

/** How Handry's approval requests start; code searches skip them, so the approval code is never taken for an SMS code. */
export const APPROVAL_MARK = `${APP_NAME} onay istiyor`;

export const NO_ACCESS = `Mesajlar veritabanı açılamadı. Tam Disk Erişimi gerekiyor: Sistem Ayarları › Gizlilik ve Güvenlik › Tam Disk Erişimi altında ${APP_NAME}'yi (ya da Claude Code'u çalıştıran Terminal / VS Code uygulamasını) aç, sonra o uygulamayı yeniden başlat. Bu izni sadece kullanıcı verir.`;

export const messagesDb = (db = config().codes?.smsDb || '~/Library/Messages/chat.db') => expandHome(db);

/** Runs a read-only query; rows as objects. NO_ACCESS when the database can't be opened. */
export function query(sql, db = messagesDb()) {
  const file = expandHome(db);
  if (!fs.existsSync(file)) return Promise.reject(new JevisError('NO_ACCESS', `${NO_ACCESS} (Dosya ${file} görünmüyor.)`));
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/sqlite3', ['-readonly', '-json', file, sql], { maxBuffer: 8 * 1024 * 1024, timeout: 10000 }, (err, stdout, stderr) => {
      if (err) {
        const why = `${stderr || err.message}`;
        if (/unable to open|authorization|not permitted|permission/i.test(why)) return reject(new JevisError('NO_ACCESS', NO_ACCESS));
        return reject(new JevisError('SMS_READ', `Mesajlar okunamadı: ${why.split('\n')[0]}`));
      }
      try { resolve(stdout.trim() ? JSON.parse(stdout) : []); } catch { reject(new JevisError('SMS_READ', 'Mesajlar veritabanı beklenmedik bir cevap verdi.')); }
    });
  });
}

/** Can the database be read right now (file there, Full Disk Access given)? */
export async function canRead(db = messagesDb()) {
  try { await query('SELECT 1 AS ok FROM message LIMIT 1;', db); return true; } catch { return false; }
}

/** Newer macOS keeps a message's text in a binary "attributedBody" blob (given as hex) instead of the text column. */
export function decodeAttributedBody(hex) {
  if (!hex) return '';
  const buf = Buffer.from(hex, 'hex');
  const marker = buf.indexOf('NSString');
  if (marker < 0) return '';
  let i = buf.indexOf(Buffer.from([0x01, 0x2b]), marker);
  if (i < 0) return '';
  i += 2;
  let len = buf[i++];
  if (len === 0x81) { len = buf.readUInt16LE(i); i += 2; }
  else if (len === 0x82) { len = buf.readUInt32LE(i); i += 4; }
  return buf.subarray(i, i + len).toString('utf-8');
}

/** "+90 555 111 22 33", "05551112233" and "+905551112233" are one number; Apple IDs compare without case. */
export function sameAddress(a, b) {
  const norm = s => {
    const t = String(s || '').trim().toLowerCase();
    if (t.includes('@')) return t.replace(/^mailto:/, '');
    const digits = t.replace(/\D/g, '');
    return digits.length >= 10 ? digits.slice(-10) : digits;
  };
  const x = norm(a);
  return Boolean(x) && x === norm(b);
}
