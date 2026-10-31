// İki adımlı doğrulama kodu (TOTP, RFC 6238): kasadaki anahtardan 6 haneli kod üretir.
// Anahtar "JBSWY3DPEHPK3PXP" gibi base32 ya da otpauth://totp/...?secret=... bağlantısı olabilir.
// Kod sadece alana yazılır, beyne (LLM'e) gösterilmez.
import crypto from 'node:crypto';
import { T } from '../core/i18n.js';

const ALFABE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32(metin) {
  const temiz = String(metin).toUpperCase().replace(/[\s=-]/g, '');
  let bitler = '';
  for (const h of temiz) {
    const i = ALFABE.indexOf(h);
    if (i < 0) throw new Error(T('TOTP anahtarı geçerli bir base32 değil.', 'The TOTP key is not valid base32.'));
    bitler += i.toString(2).padStart(5, '0');
  }
  const bayt = [];
  for (let i = 0; i + 8 <= bitler.length; i += 8) bayt.push(parseInt(bitler.slice(i, i + 8), 2));
  return Buffer.from(bayt);
}

/** Anahtardan şu anki kod. otpauth bağlantısındaki digits / period / algorithm dikkate alınır. */
export function totp(anahtar, zaman = Date.now()) {
  let gizli = String(anahtar).trim();
  let hane = 6;
  let sure = 30;
  let algoritma = 'sha1';
  if (gizli.startsWith('otpauth://')) {
    const u = new URL(gizli);
    gizli = u.searchParams.get('secret') || '';
    hane = Number(u.searchParams.get('digits')) || 6;
    sure = Number(u.searchParams.get('period')) || 30;
    algoritma = (u.searchParams.get('algorithm') || 'SHA1').toLowerCase();
  }
  const sayac = Buffer.alloc(8);
  sayac.writeBigUInt64BE(BigInt(Math.floor(zaman / 1000 / sure)));
  const h = crypto.createHmac(algoritma, base32(gizli)).update(sayac).digest();
  const o = h[h.length - 1] & 0x0f;
  const kod = ((h.readUInt32BE(o) & 0x7fffffff) % 10 ** hane).toString().padStart(hane, '0');
  return kod;
}
