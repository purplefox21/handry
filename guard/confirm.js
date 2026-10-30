// Asks the user before risky actions with a native macOS dialog. The dialog is
// shown by the OS, so nothing on a web page or in an LLM reply can answer it.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { config, HOME } from '../core/config.js';
import { APP_NAME } from '../core/brand.js';
import { actionKind } from '../core/jev.js';
import { remoteReady, startRemote } from './remote-approve.js';

// While one of these dialogs is up, the hands must not touch the screen: a
// click could otherwise answer "Evet" itself. The mark is a file, so it holds
// for every process (other Claude sessions use the tools too).
const PENDING = () => path.join(HOME, 'confirming.json');
const alive = pid => { try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; } };

function markDialog(seconds) {
  try { fs.mkdirSync(HOME, { recursive: true }); fs.writeFileSync(PENDING(), JSON.stringify({ pid: process.pid, until: Date.now() + (seconds + 5) * 1000 })); } catch {}
}

function unmarkDialog() {
  try { if (JSON.parse(fs.readFileSync(PENDING(), 'utf-8')).pid === process.pid) fs.rmSync(PENDING(), { force: true }); } catch {}
}

/** Is a confirmation or "waiting for you" dialog open right now (in any process)? */
export function dialogOpen() {
  try {
    const { pid, until } = JSON.parse(fs.readFileSync(PENDING(), 'utf-8'));
    return until > Date.now() && alive(pid);
  } catch {
    return false;
  }
}

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
  if (always) return { ask: true, hard: true, reason: `her zaman sorulacaklar listesinde: "${always}"` };
  // Strong words always ask. Soft ones ("sil", "delete") ask unless Jev is
  // nearly sure it's harmless, like "Tümünü Sil" on a calculator.
  const keyword = c.keywords.find(w => hasWord(element.name || '', w));
  if (keyword) return { ask: true, hard: true, reason: `riskli kelime: "${keyword}"` };
  const soft = c.softKeywords.find(w => hasWord(element.name || '', w));
  if (soft && (riskP === null || riskP === undefined || riskP >= c.keywordFloor)) return { ask: true, reason: `riskli kelime: "${soft}"` };
  if (riskP !== null && riskP !== undefined && riskP >= c.riskThreshold) {
    return { ask: true, reason: `Jev bu işlemi riskli buldu (%${Math.round(riskP * 100)})` };
  }
  return { ask: false };
}

/**
 * A soft verdict (a soft keyword like "sil", or Jev's broad risk question) is looked at once more: what kind of
 * action is it really, on this page? Harmless, undoable things (saving a draft, removing an item from a form) go
 * through without asking. Money, permanent deletes, sending or publishing, access changes, and anything Jev is
 * unsure about still ask. Strong keywords and "always ask" words never get here. confirm.kindCheck: false turns it off.
 */
export async function harmlessByKind(verdict, action) {
  if (!verdict.ask || verdict.hard || config().confirm.kindCheck === false) return false;
  return (await actionKind(action)) === 'diger';
}

/**
 * Shows "<app name> … İzin veriyor musun?" and resolves true only on "Evet".
 * No answer within the timeout counts as "Hayır". When the phone can be asked
 * (notify.imessageTo set, Messages readable), an unanswered dialog also goes to
 * the phone as an iMessage with a code (guard/remote-approve.js), the wait grows
 * to confirm.remoteTimeoutSec, and the first answer, Mac or phone, wins.
 * JEVIS_TEST_CONFIRM=deny|allow|always skips the dialog in automated tests;
 * remote skips only the dialog, so the phone path can be tested.
 */
export async function confirmAction(message, { timeoutSec = config().confirm.timeoutSec, remember = null } = {}) {
  // Tests can read what the dialog would have said.
  if (process.env.JEVIS_TEST_CONFIRM && process.env.JEVIS_TEST_CONFIRM_LOG) fs.appendFileSync(process.env.JEVIS_TEST_CONFIRM_LOG, `${JSON.stringify(message)}\n`);
  if (process.env.JEVIS_TEST_CONFIRM === 'deny') return false;
  if (process.env.JEVIS_TEST_CONFIRM === 'allow') return true;
  if (process.env.JEVIS_TEST_CONFIRM === 'always') {
    if (remember) allowOnSite(remember.host, remember.name);
    return true;
  }
  const dialogShown = process.env.JEVIS_TEST_CONFIRM !== 'remote';
  const phone = (await remoteReady()).ok;
  if (!dialogShown && !phone) return false;
  const waitSec = phone ? Math.max(1, Number(config().confirm.remoteTimeoutSec) || 600) : timeoutSec;
  // remember: { host, name } — a third button, "Bu sitede hep": the same button on this site is not asked again
  const buttons = remember ? '{"Hayır", "Bu sitede hep", "Evet"}' : '{"Hayır", "Evet"}';
  const script = [
    'on run argv',
    `set r to display dialog (item 1 of argv) with title (item 3 of argv) buttons ${buttons} default button "Hayır" cancel button "Hayır" with icon caution giving up after ((item 2 of argv) as integer)`,
    'if gave up of r then return "timeout"',
    'return button returned of r',
    'end run'
  ].join('\n');
  markDialog(waitSec);
  return new Promise(resolve => {
    let done = false, dialog = null, remote = null, timer = null;
    const finish = (ok, how) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      dialog?.kill();
      remote?.stop(how);
      unmarkDialog();
      resolve(ok);
    };
    if (dialogShown) {
      dialog = execFile('osascript', ['-e', script, message, String(waitSec), APP_NAME], (err, stdout) => {
        if (done) return;
        const answer = err ? '' : stdout.trim();
        if (answer === 'Bu sitede hep' && remember) allowOnSite(remember.host, remember.name);
        finish(answer === 'Evet' || answer === 'Bu sitede hep', answer === 'timeout' ? 'timeout' : 'mac');
      });
    }
    if (phone) remote = startRemote({ message, onAnswer: ok => finish(ok, 'phone') });
    timer = setTimeout(() => finish(false, 'timeout'), (waitSec + 2) * 1000);
  });
}

// ---------------------------------------------------------------------------
// Site permissions: "Bu sitede hep". One button on one site (its words); never money, deleting, or
// anything that goes out to other people.
// ---------------------------------------------------------------------------

const PERMISSIONS = () => path.join(HOME, 'site-permissions.json');
const readPermissions = () => { try { return JSON.parse(fs.readFileSync(PERMISSIONS(), 'utf-8')); } catch { return []; } };
const sameName = (a, b) => String(a || '').trim().toLocaleLowerCase('tr') === String(b || '').trim().toLocaleLowerCase('tr');

/**
 * Never remembered, asked every time: money and orders, deleting, and what goes out to other people
 * (sending, publishing, posting, sharing, inviting, submitting for review, releasing).
 */
export const rememberable = name => !/(öde|ödeme|satın|sipariş|pay|purchase|buy|checkout|order|sil|delete|remove|kaldır|çöp|trash|transfer|send|gönder|submit|publish|yayınla|yayımla|post|share|paylaş|invite|davet|review|release)/i.test(String(name || ''));

export function allowOnSite(host, name) {
  if (!host || !name || !rememberable(name)) return;
  const list = readPermissions().filter(p => !(p.host === host && sameName(p.name, name)));
  list.push({ host, name: String(name).trim(), at: new Date().toISOString() });
  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(PERMISSIONS(), JSON.stringify(list, null, 2));
}

export const allowedOnSite = (host, name) => rememberable(name) && readPermissions().some(p => p.host === host && sameName(p.name, name));
export const sitePermissions = () => readPermissions();
export function removeSitePermission(index) {
  const list = readPermissions();
  const [gone] = list.splice(index - 1, 1);
  fs.writeFileSync(PERMISSIONS(), JSON.stringify(list, null, 2));
  return gone;
}

/**
 * Pauses until the user has done something by hand (log in, type a 2FA code,
 * solve a CAPTCHA). Resolves 'done', 'cancel' or 'timeout'.
 */
export function waitForUser(message, { timeoutSec = config().guard.waitForUserTimeoutSec, until = null } = {}) {
  if (process.env.JEVIS_TEST_CONFIRM === 'allow') return Promise.resolve('done');
  if (process.env.JEVIS_TEST_CONFIRM === 'deny') return Promise.resolve('cancel');
  // No default button: an Enter meant for the web page must not say "done".
  const script = [
    'on run argv',
    'set r to display dialog (item 1 of argv) with title (item 3 of argv) buttons {"Vazgeç", "Tamam"} cancel button "Vazgeç" with icon note giving up after ((item 2 of argv) as integer)',
    'if gave up of r then return "timeout"',
    'return button returned of r',
    'end run'
  ].join('\n');
  const text = `${message}\n\n${until ? 'Bitirince kendiliğinden devam ederim; istersen "Tamam"a da basabilirsin.' : 'Bitince "Tamam"a bas.'}`;
  return new Promise(resolve => {
    let finished = false;
    let dialog = null;
    let timer = null;
    const finish = answer => {
      if (finished) return;
      finished = true;
      clearInterval(timer);
      dialog?.kill();
      if (dialog) unmarkDialog();
      resolve(answer);
    };
    // Tests: no dialog at all, only the page can end the wait.
    if (process.env.JEVIS_TEST_CONFIRM !== 'watch') {
      markDialog(timeoutSec);
      dialog = execFile('osascript', ['-e', script, text, String(timeoutSec), `${APP_NAME} seni bekliyor`], (err, stdout) => {
        if (finished) return;
        if (err) return finish('cancel');
        finish(stdout.trim() === 'timeout' ? 'timeout' : 'done');
      });
    }
    // until(): checked at once, then every second; true when the page shows the user is done.
    if (until) {
      const started = Date.now();
      const look = async () => {
        if (finished) return;
        if (Date.now() - started > timeoutSec * 1000) return finish('timeout');
        if (await until().catch(() => false)) finish('done');
      };
      look();
      timer = setInterval(look, 1000);
    }
  });
}
