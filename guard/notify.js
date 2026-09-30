// Getting the user's attention when JEVIS needs them (a login, a 2FA code, a
// CAPTCHA, an answer): a macOS notification, JEVIS saying it out loud, the
// JEVIS bar dropping down with the message (JEVIS.app watches
// ~/.jevis/attention.json), and, if the wait is still on after a minute, an
// iMessage to the user's own iPhone (config: notify.imessageTo, kept in
// ~/.jevis/config.json because it is a phone number or Apple ID).
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { HOME, config } from '../core/config.js';
import { speak } from '../voice/tts.js';

export const ATTENTION_FILE = path.join(HOME, 'attention.json');
const pendingMessages = new Map(); // alert id → iMessage timer
const lastSaid = new Map(); // message → when it was last spoken (no repeats)

const settings = () => ({ imessageTo: '', imessageAfterSec: 60, speak: true, ...(config().notify || {}) });

/**
 * Tells the user right away; with imessage, texts their iPhone too if the
 * alert isn't resolved within notify.imessageAfterSec. speak: false keeps it
 * quiet (e.g. at night). Returns the alert id.
 */
export function alertUser(message, { title = 'JEVIS', imessage = false, speak: sayIt } = {}) {
  const id = `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const entry = { id, at: Date.now(), title, message };
  try {
    fs.mkdirSync(HOME, { recursive: true });
    fs.writeFileSync(ATTENTION_FILE, JSON.stringify(entry));
  } catch {}
  const s = settings();
  // Tests: write down what would have been said (the iMessage timer still runs; sendIMessage records too).
  if (process.env.JEVIS_TEST_NOTIFY === 'record') {
    fs.appendFileSync(path.join(HOME, 'notify-test.log'), `${JSON.stringify({ ...entry, imessage })}\n`);
  } else {
    // speak: false is for quiet moments (e.g. a timer at night): no sound with the notification either.
    const shown = sayIt === false ? 'display notification (item 2 of argv) with title (item 1 of argv)' : 'display notification (item 2 of argv) with title (item 1 of argv) sound name "Glass"';
    execFile('osascript', ['-e', 'on run argv', '-e', shown, '-e', 'end run', title, message], () => {});
    if ((sayIt ?? s.speak) && Date.now() - (lastSaid.get(message) || 0) > 60000) {
      lastSaid.set(message, Date.now());
      speak(message).catch(() => {});
    }
  }
  if (imessage && s.imessageTo) {
    pendingMessages.set(id, setTimeout(() => {
      pendingMessages.delete(id);
      sendIMessage(`JEVIS: ${message}`).catch(() => {});
    }, s.imessageAfterSec * 1000));
  }
  return id;
}

/** The user dealt with it: no iMessage, and the bar can let go of it. */
export function resolveAlert(id) {
  clearTimeout(pendingMessages.get(id));
  pendingMessages.delete(id);
  try {
    const current = JSON.parse(fs.readFileSync(ATTENTION_FILE, 'utf-8'));
    if (current.id === id) fs.writeFileSync(ATTENTION_FILE, JSON.stringify({ ...current, resolved: true }));
  } catch {}
}

/** An iMessage from this Mac's Messages account to `to` (the user's own number or Apple ID). */
export function sendIMessage(text, to = settings().imessageTo) {
  if (!to) return Promise.reject(new Error('iMessage adresi ayarlı değil: node cli.js notify set <telefon ya da Apple ID>'));
  if (process.env.JEVIS_TEST_NOTIFY === 'record') {
    fs.appendFileSync(path.join(HOME, 'notify-test.log'), `${JSON.stringify({ imessage: text, to })}\n`);
    return Promise.resolve();
  }
  const script = [
    'on run argv',
    'tell application "Messages"',
    '  set svc to 1st account whose service type = iMessage',
    '  send (item 1 of argv) to participant (item 2 of argv) of svc',
    'end tell',
    'end run'
  ].join('\n');
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script, text, to], { timeout: 30000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`iMessage gönderilemedi: ${(stderr || err.message).replace(/^.*execution error: /s, '').trim()}`));
      else resolve();
    });
  });
}

/** "sso.godaddy.com" → "GoDaddy"-ish name to say out loud: the main part of the domain. */
export function siteName(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (!host) return 'Bu sayfa';
    const parts = host.split('.');
    const known = { appstoreconnect: 'App Store Connect', firebase: 'Firebase', github: 'GitHub', godaddy: 'GoDaddy', google: 'Google', apple: 'Apple' };
    const main = parts.length > 2 && ['co', 'com', 'org', 'net', 'gov'].includes(parts.at(-2)) ? parts.at(-3) : parts.at(-2) || parts[0];
    const hit = parts.find(p => known[p]);
    return known[hit] || known[main] || main;
  } catch {
    return 'site';
  }
}
