// Asks the user before risky actions with a native macOS dialog. The dialog is
// shown by the OS, so nothing on a web page or in an LLM reply can answer it.
import { execFile } from 'node:child_process';
import { config } from '../core/config.js';

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasWord = (text, word) => new RegExp(`(^|[^\\p{L}])${escapeRe(word)}($|[^\\p{L}])`, 'iu').test(text);

/**
 * Should this element action be confirmed?
 * element: { name, role, ctx }, riskP: Jev's risk probability (or null),
 * host: current site; confirm.sites[host] can add alwaysAsk / neverAsk words.
 */
export function needsConfirm(element, riskP, host = '') {
  const c = config().confirm;
  if (!c.enabled) return { ask: false };
  const site = Object.entries(c.sites || {}).find(([h]) => host === h || host.endsWith(`.${h}`))?.[1] || {};
  const neverAsk = [...c.neverAsk, ...(site.neverAsk || [])];
  const alwaysAsk = [...c.alwaysAsk, ...(site.alwaysAsk || [])];
  const label = `${element.name || ''} ${element.ctx || ''}`;
  const always = alwaysAsk.find(w => hasWord(label, w));
  if (!always && neverAsk.some(w => hasWord(label, w))) return { ask: false };
  if (always) return { ask: true, reason: `her zaman sorulacaklar listesinde: "${always}"` };
  // Strong words always ask. Soft ones ("sil", "delete") ask unless Jev is
  // nearly sure it's harmless, like "Tümünü Sil" on a calculator.
  const keyword = c.keywords.find(w => hasWord(element.name || '', w));
  if (keyword) return { ask: true, reason: `riskli kelime: "${keyword}"` };
  const soft = c.softKeywords.find(w => hasWord(element.name || '', w));
  if (soft && (riskP === null || riskP === undefined || riskP >= c.keywordFloor)) return { ask: true, reason: `riskli kelime: "${soft}"` };
  if (riskP !== null && riskP !== undefined && riskP >= c.riskThreshold) {
    return { ask: true, reason: `Jev bu işlemi riskli buldu (%${Math.round(riskP * 100)})` };
  }
  return { ask: false };
}

/**
 * Shows "JEVIS … İzin veriyor musun?" and resolves true only on "Evet".
 * No answer within the timeout counts as "Hayır".
 * JEVIS_TEST_CONFIRM=deny|allow skips the dialog in automated tests.
 */
export function confirmAction(message, { timeoutSec = config().confirm.timeoutSec } = {}) {
  if (process.env.JEVIS_TEST_CONFIRM === 'deny') return Promise.resolve(false);
  if (process.env.JEVIS_TEST_CONFIRM === 'allow') return Promise.resolve(true);
  const script = [
    'on run argv',
    'set r to display dialog (item 1 of argv) with title "JEVIS" buttons {"Hayır", "Evet"} default button "Hayır" cancel button "Hayır" with icon caution giving up after ((item 2 of argv) as integer)',
    'if gave up of r then return "timeout"',
    'return button returned of r',
    'end run'
  ].join('\n');
  return new Promise(resolve => {
    execFile('osascript', ['-e', script, message, String(timeoutSec)], (err, stdout) => {
      resolve(!err && stdout.trim() === 'Evet');
    });
  });
}

/**
 * Pauses until the user has done something by hand (log in, type a 2FA code,
 * solve a CAPTCHA). Resolves 'done', 'cancel' or 'timeout'.
 */
export function waitForUser(message, { timeoutSec = config().guard.waitForUserTimeoutSec } = {}) {
  if (process.env.JEVIS_TEST_CONFIRM === 'allow') return Promise.resolve('done');
  if (process.env.JEVIS_TEST_CONFIRM === 'deny') return Promise.resolve('cancel');
  const script = [
    'on run argv',
    'set r to display dialog (item 1 of argv) with title "JEVIS seni bekliyor" buttons {"Vazgeç", "Tamam"} default button "Tamam" cancel button "Vazgeç" with icon note giving up after ((item 2 of argv) as integer)',
    'if gave up of r then return "timeout"',
    'return button returned of r',
    'end run'
  ].join('\n');
  const text = `${message}\n\nBitince "Tamam"a bas.`;
  return new Promise(resolve => {
    execFile('osascript', ['-e', script, text, String(timeoutSec)], (err, stdout) => {
      if (err) return resolve('cancel');
      resolve(stdout.trim() === 'timeout' ? 'timeout' : 'done');
    });
  });
}
