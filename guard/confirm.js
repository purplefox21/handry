// Asks the user before risky actions with a native macOS dialog. The dialog is
// shown by the OS, so nothing on a web page or in an LLM reply can answer it.
import { execFile } from 'node:child_process';
import { config } from '../core/config.js';

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasWord = (text, word) => new RegExp(`(^|[^\\p{L}])${escapeRe(word)}($|[^\\p{L}])`, 'iu').test(text);

/**
 * Should this element action be confirmed?
 * element: { name, role, ctx }, riskP: Jev's risk probability (or null).
 */
export function needsConfirm(element, riskP) {
  const c = config().confirm;
  if (!c.enabled) return { ask: false };
  const label = `${element.name || ''} ${element.ctx || ''}`;
  if (c.neverAsk.some(w => hasWord(label, w))) return { ask: false };
  const always = c.alwaysAsk.find(w => hasWord(label, w));
  if (always) return { ask: true, reason: `her zaman sorulacaklar listesinde: "${always}"` };
  const keyword = c.keywords.find(w => hasWord(element.name || '', w));
  if (keyword) return { ask: true, reason: `riskli kelime: "${keyword}"` };
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
