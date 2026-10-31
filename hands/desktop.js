// Handry · © 2026 Berat Olekli (purplefox) · github.com/purplefox21/handry
// Desktop hands: any Mac app through its accessibility tree (bin/jevis-ax).
// Same idea as the browser: list the controls, let Jev pick the one the
// instruction means, press it. Terminals and app-quitting keys need consent.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { ROOT, config, homeDir, loadState, saveState } from '../core/config.js';
import { JevisError } from '../core/errors.js';
import { desktopHumanOn } from './human.js';
import * as jev from '../core/jev.js';
import { needsConfirm, confirmAction, dialogOpen, harmlessByKind } from '../guard/confirm.js';
import { isStopped } from '../guard/stop.js';
import { APP_NAME } from '../core/brand.js';
import { T } from '../core/i18n.js';
import * as overlay from './overlay.js';

const execFileAsync = promisify(execFile);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pct = p => Math.round((p || 0) * 100);
const clean = s => String(s ?? '').replace(/[‎‏‪-‮]/g, '').replace(/\s+/g, ' ').trim();

const HELPER = path.join(ROOT, 'bin', 'jevis-ax');
const SOURCE = path.join(ROOT, 'hands', 'ax-helper', 'main.swift');

// Typing here runs shell commands, so the user sees the text first.
const SHELL_APPS = new Set(['com.apple.Terminal', 'com.googlecode.iterm2', 'dev.warp.Warp-Stable', 'com.github.wez.wezterm', 'net.kovidgoyal.kitty', 'co.zeit.hyper', 'io.alacritty', 'com.mitchellh.ghostty']);
const DANGEROUS_KEYS = new Set(['cmd+q', 'cmd+option+escape', 'cmd+alt+escape', 'cmd+option+esc', 'cmd+alt+esc', 'cmd+shift+delete', 'cmd+delete', 'cmd+shift+q', 'ctrl+cmd+q', 'cmd+ctrl+q', 'cmd+option+shift+q']);

/** Compiles the Swift helper on first use (and after the source changes). */
export function ensureHelper() {
  const stale = !fs.existsSync(HELPER) || fs.statSync(HELPER).mtimeMs < fs.statSync(SOURCE).mtimeMs;
  if (!stale) return;
  fs.mkdirSync(path.dirname(HELPER), { recursive: true });
  execFileSync('swiftc', ['-O', '-o', HELPER, SOURCE], { stdio: 'pipe' });
}

async function ax(...args) {
  ensureHelper();
  try {
    // human input (gliding pointer, key-by-key typing) only when human_mode says so
    const env = { ...process.env, JEVIS_HUMAN: desktopHumanOn() ? '1' : '0' };
    const { stdout } = await execFileAsync(HELPER, args.map(String), { timeout: 20000, maxBuffer: 20 * 1024 * 1024, env });
    return JSON.parse(stdout);
  } catch (err) {
    let out = null;
    try { out = JSON.parse(err.stdout); } catch {}
    if (out?.error) throw new JevisError(out.code || 'DESKTOP', out.error);
    throw new JevisError('DESKTOP', T(`Masaüstü yardımcısı hata verdi: ${err.message}`, `The desktop helper failed: ${err.message}`));
  }
}

let trustedChecked = false;
async function ensureTrusted() {
  if (trustedChecked) return;
  const { trusted } = await ax('trusted');
  if (!trusted) {
    throw new JevisError('NO_PERMISSION', T(`Erişilebilirlik izni yok. Sistem Ayarları › Gizlilik ve Güvenlik › Erişilebilirlik bölümünde ${APP_NAME} uygulamasını (ya da onu çalıştıran Terminal / VS Code'u) aç. ${APP_NAME} menüsündeki "İzinler…" penceresi doğru sayfayı açar.`, `No Accessibility permission. In System Settings › Privacy & Security › Accessibility, turn on ${APP_NAME} (or the Terminal / VS Code that runs it). The "Permissions…" window in the ${APP_NAME} menu opens the right page.`));
  }
  trustedChecked = true;
}

export async function apps() {
  return (await ax('apps')).apps;
}

export async function frontmost() {
  return ax('frontmost');
}

/** "--pid N" for the named app (Turkish or English name), or [] for the frontmost one. */
async function appArgs(app) {
  if (!app) return [];
  if (typeof app === 'number') return ['--pid', app];
  const list = await apps();
  const wanted = String(app).toLowerCase();
  let found = list.find(a => a.name.toLowerCase() === wanted || a.bundleId.toLowerCase() === wanted || a.bundleId.toLowerCase().endsWith(`.${wanted}`));
  if (!found) {
    const pick = await jev.pickOption('running application', app, list.map(a => `${a.name} (${a.bundleId})`));
    if (pick.index === null || !jev.isConfident(pick)) throw new JevisError('NO_APP', T(`"${app}" adında açık bir uygulama yok. Açık olanlar: ${list.map(a => a.name).join(', ')}`, `No open app is called "${app}". Open apps: ${list.map(a => a.name).join(', ')}`));
    found = list[pick.index];
  }
  return ['--pid', found.pid];
}

export function labelOf(e) {
  const state = [];
  if (e.value !== undefined && e.value !== '') state.push(`value: "${clean(e.value).slice(0, 40)}"`);
  if (e.disabled) state.push('disabled');
  if (e.focused) state.push('focused');
  if (e.selected) state.push('selected');
  const role = e.subrole && !e.name ? `${e.role}/${e.subrole}` : e.role;
  return `[${role}] ${e.name || e.subrole || T('(isimsiz)', '(unnamed)')}${e.ctx ? ` — ${e.ctx}` : ''}${state.length ? ` {${state.join(', ')}}` : ''}`;
}

/** Controls (#d1, #d2…) and texts of an app's front window; menus optional. */
export async function read({ app, menus = false, remember = true } = {}) {
  await ensureTrusted();
  const tree = await ax('tree', ...(await appArgs(app)), ...(menus ? ['--menus'] : []));
  const elements = tree.elements.map((e, i) => ({ ...e, id: `d${i + 1}`, name: clean(e.name), ctx: clean(e.ctx) }));
  // The window's texts are kept too: a later #dN click shows them to the risk check ("Bu belgeyi tutmak istiyor musunuz?").
  if (remember) saveState({ desktop: { pid: tree.pid, app: tree.app, window: tree.window, texts: tree.texts.map(clean).filter(Boolean).slice(0, 12), ids: Object.fromEntries(elements.map(e => [e.id, { path: e.path, name: e.name, frame: { x: e.x, y: e.y, w: e.w, h: e.h } }])) } });
  return {
    app: tree.app,
    pid: tree.pid,
    bundleId: tree.bundleId,
    window: tree.window,
    elements,
    texts: tree.texts.map(clean).filter(Boolean),
    truncated: tree.truncated
  };
}

const PURPOSE = {
  click: t => `Click or press: ${t}`,
  type: t => `Type text into: ${t}`
};

/** Target description or #dN → { path, name, pid, bundleId, pick }. Menus are tried when the window has no match. */
async function resolve(target, purpose, { app, withRisk = false } = {}) {
  const id = String(target).trim().match(/^#(d\d+)$/);
  if (id) {
    const saved = loadState().desktop;
    const entry = saved?.ids?.[id[1]];
    if (!entry) throw new JevisError('STALE', T(`#${id[1]} bilinmiyor. Önce pencereyi oku (desktop_read).`, `#${id[1]} is unknown. Read the window first (desktop_read).`));
    const front = await frontmost();
    const risk = withRisk ? (await jev.isRisky(PURPOSE[purpose](entry.name), { app: saved.app, window: saved.window })).p : null;
    return { path: entry.path, name: entry.name, expect: entry.name, role: '', pid: saved.pid, bundleId: front.bundleId, context: saved.texts || [], frame: entry.frame, pick: { confidence: 1, risk, ms: 0 } };
  }

  // The window first; its menus too when the window has no confident match
  // ("Dosya > Yeni", "Biçim > Düz Metin Yap").
  let best = null;
  for (const menus of [false, true]) {
    const r = await read({ app, menus });
    if (!r.elements.length) continue;
    const labels = r.elements.map(labelOf);
    // The window's texts (a dialog's question, a form's headings) tell Jev what the buttons are about.
    const pick = await jev.pickElement(PURPOSE[purpose](target), labels, { app: r.app, window: r.window, texts: r.texts.slice(0, 12) }, { withRisk });
    const alternatives = pick.alternatives.filter(a => a.index !== null).map(a => ({ id: r.elements[a.index].id, label: labels[a.index], p: pct(a.p) }));
    if (pick.index !== null && jev.isConfident(pick)) {
      const el = r.elements[pick.index];
      return { path: el.path, name: el.name || el.subrole || el.role, expect: el.name, role: el.role, pid: r.pid, bundleId: r.bundleId, context: r.texts.slice(0, 12), frame: { x: el.x, y: el.y, w: el.w, h: el.h }, pick };
    }
    if (!best || (alternatives[0]?.p || 0) > (best.alternatives[0]?.p || 0)) best = { app: r.app, pick, alternatives };
  }
  if (best && best.pick.index !== null) {
    throw new JevisError('LOW_CONFIDENCE', T(`Jev "${target}" için emin değil (%${pct(best.pick.confidence)}). Adaylardan birini #id ile seçin.`, `Jev isn't sure about "${target}" (${pct(best.pick.confidence)}%). Pick one of the candidates by #id.`), { alternatives: best.alternatives });
  }
  if (best) throw new JevisError('NOT_FOUND', T(`"${target}" ${best.app} içinde bulunamadı (pencere ve menüler).`, `"${target}" wasn't found in ${best.app} (window and menus).`), { alternatives: best.alternatives });
  throw new JevisError('NOT_FOUND', T('Pencerede kullanılabilir öğe yok.', 'The window has no controls to use.'));
}

async function guard(el, riskP, actionText, app) {
  const verdict = needsConfirm({ name: el.name, role: el.role }, riskP, app || '');
  if (!verdict.ask) return null;
  // What the window says decides what a button does: "Sil" under "Bu belgeyi tutmak istiyor musunuz?" throws a
  // document away. Without it Jev took that "Sil" for something harmless and the user was never asked.
  const said = el.context?.length ? T(`; pencerede: ${el.context.join(' · ').slice(0, 600)}`, `; the window says: ${el.context.join(' · ').slice(0, 600)}`) : '';
  if (await harmlessByKind(verdict, T(`${actionText} (uygulama: ${app}${said})`, `${actionText} (app: ${app}${said})`))) return null;
  // while the question is open, the control it is about is circled on the screen (drawn alongside: the question never waits for it)
  const mark = el.frame?.w && config().overlay?.confirmHighlight !== false
    ? overlay.draw({ shape: 'circle', rect: el.frame, note: T('Buna basmak istiyorum', 'I want to press this'), seconds: 900 }).catch(() => null)
    : null;
  const ok = await confirmAction(T(`${APP_NAME} şunu yapmak istiyor:\n\n${actionText}\n\nUygulama: ${app}\nNeden soruluyor: ${verdict.reason}\n\nİzin veriyor musun?`, `${APP_NAME} wants to do this:\n\n${actionText}\n\nApp: ${app}\nWhy you're asked: ${verdict.reason}\n\nDo you allow it?`));
  const drawn = await mark;
  if (drawn) overlay.clear(drawn);
  if (!ok) throw new JevisError('DENIED', T(`Kullanıcı izin vermedi: ${actionText}`, `The user didn't allow it: ${actionText}`));
  return { reason: verdict.reason };
}

async function shellGuard(bundleId, what) {
  if (!SHELL_APPS.has(bundleId)) return;
  const ok = await confirmAction(T(`${APP_NAME} bir terminale şunu yapmak istiyor:\n\n${what}\n\nTerminale yazılanlar komut olarak çalışabilir. İzin veriyor musun?`, `${APP_NAME} wants to do this in a terminal:\n\n${what}\n\nWhat is typed into a terminal can run as a command. Do you allow it?`));
  if (!ok) throw new JevisError('DENIED', T(`Kullanıcı terminal işlemine izin vermedi: ${what}`, `The user didn't allow the terminal action: ${what}`));
}

async function after(pid) {
  await sleep(150);
  const f = await frontmost().catch(() => ({}));
  return { app: f.app, window: f.window, changedApp: f.pid !== pid };
}

/** No touching the screen while a confirmation dialog waits for the user (a click could answer it). */
function notDuringDialog() {
  if (dialogOpen()) throw new JevisError('WAIT_USER', T('Ekranda kullanıcıya soru soran bir onay penceresi açık. Cevabını bekle; o sırada ekrana dokunmuyorum.', "A confirmation dialog is open on the screen, asking the user something. Wait for the answer; I don't touch the screen meanwhile."));
}

export async function click(target, { app } = {}) {
  notDuringDialog();
  await ensureTrusted();
  const el = await resolve(target, 'click', { app, withRisk: true });
  const approval = await guard(el, el.pick.risk, T(`"${el.name}" öğesine basmak`, `press "${el.name}"`), (await frontmost()).app);
  const res = await ax('press', el.path, '--pid', el.pid, '--expect', el.expect || '');
  return { element: { name: el.name, role: el.role }, jev: { confidence: pct(el.pick.confidence), ms: el.pick.ms }, method: res.method, approval, ...(await after(el.pid)) };
}

/** With a target: fills that field. Without: types into whatever has focus. */
export async function type(target, text, { app, submit = false } = {}) {
  notDuringDialog();
  await ensureTrusted();
  if (!target) {
    const front = await ensureFront(app);
    await shellGuard(front.bundleId, T(`"${text}" yazmak${submit ? ' ve Enter\'a basmak' : ''}`, `type "${text}"${submit ? ' and press Enter' : ''}`));
    await ax('type', text);
    if (submit) await ax('key', 'return');
    return { typed: text.length, ...(await after(front.pid)) };
  }
  const el = await resolve(target, 'type', { app });
  await shellGuard(el.bundleId, T(`"${text}" yazmak`, `type "${text}"`));
  const res = await ax('setvalue', el.path, text, '--pid', el.pid);
  let approval = null;
  if (submit) {
    const risk = await jev.isRisky(`Press Enter after typing into "${el.name}"`, { app: el.bundleId });
    approval = await guard(el, risk.p, T(`"${el.name}" alanında Enter'a basmak`, `press Enter in "${el.name}"`), el.bundleId);
    await ax('key', 'return');
  }
  return { element: { name: el.name, role: el.role }, jev: { confidence: pct(el.pick.confidence), ms: el.pick.ms }, typed: text.length, method: res.method, approval, ...(await after(el.pid)) };
}

/** Presses a control by the accessibility path a read gave (expect: its name; a window that changed is not pressed). */
export async function pressPath(elPath, { pid, expect = '' } = {}) {
  notDuringDialog();
  await ensureTrusted();
  return ax('press', elPath, '--pid', pid, '--expect', expect);
}

/** Gives the keyboard focus to a control by the accessibility path a read gave. */
export async function focusPath(elPath, { pid } = {}) {
  notDuringDialog();
  await ensureTrusted();
  return ax('focus', elPath, '--pid', pid);
}

/**
 * Keys and keyboard typing go to whatever app is in front. When the caller
 * names an app, it must really be in front first; otherwise nothing is sent.
 */
async function ensureFront(app) {
  if (!app) return frontmost();
  const target = await appArgs(app);
  let front = await frontmost();
  for (let i = 0; i < 10 && String(front.pid) !== String(target[1]); i++) {
    if (i === 0) await ax('activate', ...target).catch(() => {});
    await sleep(150);
    front = await frontmost();
  }
  if (String(front.pid) !== String(target[1])) {
    const name = typeof app === 'number' ? (await apps()).find(a => a.pid === app)?.name || T('Uygulama', 'The app') : app;
    throw new JevisError('NOT_FRONT', T(`${name} öne getirilemedi (önde: ${front.app}); hiçbir şey gönderilmedi. Ekranda cevap bekleyen bir sistem sorusu olabilir.`, `Couldn't bring ${name} to the front (in front: ${front.app}); nothing was sent. A system question may be waiting for an answer on the screen.`));
  }
  return front;
}

export async function key(combo, { app } = {}) {
  notDuringDialog();
  await ensureTrusted();
  const normalized = combo.toLowerCase().replace(/\s+/g, '');
  const front = await ensureFront(app);
  if (DANGEROUS_KEYS.has(normalized)) {
    const ok = await confirmAction(T(`${APP_NAME} "${front.app}" içinde ${combo} kısayoluna basmak istiyor (uygulama kapanabilir ya da veri silinebilir).\n\nİzin veriyor musun?`, `${APP_NAME} wants to press ${combo} in "${front.app}" (the app may quit or data may be deleted).\n\nDo you allow it?`));
    if (!ok) throw new JevisError('DENIED', T(`Kullanıcı izin vermedi: ${combo}`, `The user didn't allow it: ${combo}`));
  }
  if (['return', 'enter'].includes(normalized)) await shellGuard(front.bundleId, T('Enter\'a basmak (yazılı komut çalışır)', 'press Enter (the typed command runs)'));
  await ax('key', combo);
  return { key: combo, ...(await after(front.pid)) };
}

/**
 * Scrolls an app's front window: over its middle, or over a point (x, y) of the last desktop_screenshot
 * (a side panel, a list). The pointer moves there first, so the scroll goes to that window and not to what was under the mouse.
 */
export async function scroll(direction = 'down', amount = 400, { app, x, y } = {}) {
  notDuringDialog();
  await ensureTrusted();
  const px = Math.max(50, Math.min(5000, Math.round(Number(amount) || 400)));
  const dy = direction === 'up' ? px : direction === 'down' ? -px : 0;
  const dx = direction === 'left' ? px : direction === 'right' ? -px : 0;
  let front, point;
  if (x !== undefined && y !== undefined) {
    const shot = loadState().shot;
    if (!shot || Date.now() - shot.at > SHOT_MAX_AGE_MS) throw new JevisError('NO_SHOT', T('Bir noktada kaydırmak için önce desktop_screenshot al (ya da x, y vermeden pencerenin ortasında kaydır).', 'To scroll at a point, take a desktop_screenshot first (or scroll in the middle of the window by leaving out x, y).'));
    front = await ensureFront(shot.pid);
    let area = shot.area;
    if (shot.windowId) {
      if (front.windowId !== shot.windowId) throw new JevisError('STALE', otherWindow(shot.app));
      area = { ...area, x: front.bounds.X, y: front.bounds.Y };
    }
    point = { x: Math.round(area.x + (Number(x) * area.w) / shot.image.w), y: Math.round(area.y + (Number(y) * area.h) / shot.image.h) };
  } else {
    front = await ensureFront(app);
    const b = front.bounds;
    if (b) point = { x: Math.round(b.X + b.Width / 2), y: Math.round(b.Y + b.Height / 2) };
  }
  await ax('scroll', dy, dx, ...(point ? ['--at', `${point.x},${point.y}`] : []));
  await sleep(200);
  return { scrolled: direction, pixels: px, point, ...(await after(front.pid)) };
}

export async function activate(app) {
  await ax('activate', ...(await appArgs(app)));
  await sleep(250);
  return frontmost();
}

/** Names of the apps installed on this Mac ("Calculator", "Spotify", "Visual Studio Code"…). */
export function installedApps() {
  const dirs = ['/Applications', '/Applications/Utilities', '/System/Applications', '/System/Applications/Utilities', path.join(os.homedir(), 'Applications')];
  const names = dirs.flatMap(d => { try { return fs.readdirSync(d).filter(f => f.endsWith('.app')).map(f => f.slice(0, -4)); } catch { return []; } });
  return [...new Set(names)].sort();
}

/**
 * Opens an app by name, English or Turkish ("Hesap Makinesi" → Calculator),
 * optionally with a file or folder ("Visual Studio Code" + ~/Desktop/jev).
 */
export async function openApp(name, target) {
  const extra = target ? [target.startsWith('~/') ? path.join(os.homedir(), target.slice(2)) : target] : [];
  let opened = name;
  try {
    await execFileAsync('open', ['-a', name, ...extra]);
  } catch {
    const installed = installedApps();
    const pick = await jev.pickOption('application to open', name, installed);
    if (pick.index === null || !jev.isConfident(pick)) throw new JevisError('NO_APP', T(`"${name}" adında bir uygulama bulunamadı.`, `No app called "${name}" was found.`));
    opened = installed[pick.index];
    await execFileAsync('open', ['-a', opened, ...extra]);
  }
  // Wait until that app is really in front ("Hesap Makinesi" is com.apple.calculator).
  const wanted = [name, opened].map(n => n.toLowerCase().replace(/\.app$/, ''));
  const isIt = f => wanted.some(w => f.app?.toLowerCase() === w || f.bundleId?.toLowerCase().endsWith(`.${w.replace(/\s+/g, '')}`));
  for (let i = 0; i < 25; i++) {
    await sleep(200);
    const f = await frontmost().catch(() => null);
    if (f && isIt(f)) return f;
    if (i === 10) await ax('activate', '--app', opened).catch(() => {});
  }
  return frontmost();
}

/**
 * Asks the app to quit without waiting for it: an app with unsaved work shows
 * a "save changes?" dialog, which the caller then handles like any window.
 */
export async function quitApp(name) {
  const [, pid] = await appArgs(name);
  const target = (await apps()).find(a => a.pid === pid);
  await execFileAsync('osascript', ['-e', 'on run argv', '-e', 'ignoring application responses', '-e', 'tell application id (item 1 of argv) to quit', '-e', 'end ignoring', '-e', 'end run', target.bundleId], { timeout: 10000 });
  for (let i = 0; i < 15; i++) {
    await sleep(200);
    if (!(await apps()).some(a => a.pid === pid)) return { quit: target.name };
  }
  return { quit: null, stillOpen: target.name, note: T(`${target.name} kapanmadı; muhtemelen "kaydedilsin mi?" sorusu açık. desktop_read ile bakıp cevapla.`, `${target.name} didn't quit; a "save changes?" question is probably open. Look with desktop_read and answer it.`) };
}

/**
 * JPEG of the front window (or the whole screen), resized for an LLM. Where
 * the picture lies on screen is saved, so clickAt() can take its pixels.
 */
export async function screenshot({ app, fullScreen = false } = {}) {
  if (app) await activate(app);
  const f = await frontmost();
  const whole = fullScreen || !f.windowId;
  const file = path.join(homeDir('shots'), `desktop-${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`);
  try {
    await execFileAsync('screencapture', ['-x', '-o', '-t', 'jpg', ...(whole ? [] : ['-l', String(f.windowId)]), file]);
  } catch (err) {
    const { screenRecording } = await ax('trusted').catch(() => ({}));
    if (screenRecording === false) {
      throw new JevisError('NO_PERMISSION', T(`Ekran Kaydı izni yok. Sistem Ayarları › Gizlilik ve Güvenlik › Ekran ve Sistem Sesi Kaydı bölümünde ${APP_NAME} uygulamasını (ya da onu çalıştıran Terminal / VS Code'u) aç, sonra kapatıp yeniden aç.`, `No Screen Recording permission. In System Settings › Privacy & Security › Screen & System Audio Recording, turn on ${APP_NAME} (or the Terminal / VS Code that runs it), then quit it and open it again.`));
    }
    throw err;
  }
  await execFileAsync('sips', ['-Z', '1400', file]).catch(() => {});
  const { stdout } = await execFileAsync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file]);
  const image = { w: Number(stdout.match(/pixelWidth: (\d+)/)?.[1]), h: Number(stdout.match(/pixelHeight: (\d+)/)?.[1]) };
  const area = whole ? await ax('screen') : { x: f.bounds.X, y: f.bounds.Y, w: f.bounds.Width, h: f.bounds.Height };
  saveState({ shot: { at: Date.now(), app: f.app, pid: f.pid, windowId: whole ? null : f.windowId, area, image } });
  return { path: file, base64: fs.readFileSync(file).toString('base64'), mimeType: 'image/jpeg', app: f.app, window: f.window, width: image.w, height: image.h };
}

const SHOT_MAX_AGE_MS = 5 * 60 * 1000;
const noShot = () => T('Önce desktop_screenshot al; x ve y o görüntünün piksel koordinatları olmalı.', 'Take a desktop_screenshot first; x and y must be pixels of that image.');
const otherWindow = app => T(`${app} içinde önde başka bir pencere var; yeni bir desktop_screenshot al.`, `Another window of ${app} is in front; take a new desktop_screenshot.`);

/** A point of the last desktop_screenshot (its pixels) → global screen points. */
export function shotToScreen(x, y) {
  const shot = loadState().shot;
  if (!shot || Date.now() - shot.at > SHOT_MAX_AGE_MS) throw new JevisError('NO_SHOT', noShot());
  if (!(x >= 0 && y >= 0 && x <= shot.image.w && y <= shot.image.h)) throw new JevisError('BAD_ARGS', T(`Nokta görüntünün dışında (görüntü ${shot.image.w}×${shot.image.h}).`, `The point is outside the image (image ${shot.image.w}×${shot.image.h}).`));
  const area = shot.area;
  return { x: Math.round(area.x + (x * area.w) / shot.image.w), y: Math.round(area.y + (y * area.h) / shot.image.h) };
}

/** Where a control of an app's window is on the screen (for screen_draw); the app comes to the front first. */
export async function frameOf(target, { app } = {}) {
  await ensureTrusted();
  if (app) await activate(app);
  const el = await resolve(target, 'click', { app });
  if (!el.frame?.w) throw new JevisError('NO_FRAME', T(`"${el.name}" öğesinin ekrandaki yeri bilinmiyor (kapalı bir menüdeki öğe olabilir).`, `Where "${el.name}" is on the screen isn't known (it may be an item of a closed menu).`));
  return { rect: el.frame, name: el.name, app: (await frontmost().catch(() => ({}))).app };
}

/**
 * Clicks a point of the last screenshot (x, y in its pixels), for things the
 * accessibility tree doesn't show (canvas, games, custom-drawn apps).
 * `description` says what is there; it goes through the same risk check as
 * any click, together with what the Mac reports under that point.
 */
export async function clickAt(x, y, { description = '', double = false, right = false } = {}) {
  notDuringDialog();
  await ensureTrusted();
  const shot = loadState().shot;
  if (!shot || Date.now() - shot.at > SHOT_MAX_AGE_MS) throw new JevisError('NO_SHOT', noShot());
  if (!(x >= 0 && y >= 0 && x <= shot.image.w && y <= shot.image.h)) throw new JevisError('BAD_ARGS', T(`Nokta görüntünün dışında (görüntü ${shot.image.w}×${shot.image.h} piksel).`, `The point is outside the image (image ${shot.image.w}×${shot.image.h} pixels).`));
  let area = shot.area;
  if (shot.windowId) {
    // The pixels belong to that window: it must be in front, the same size.
    const front = await ensureFront(shot.pid);
    if (front.windowId !== shot.windowId) throw new JevisError('STALE', otherWindow(shot.app));
    const b = front.bounds;
    if (Math.abs(b.Width - area.w) > 2 || Math.abs(b.Height - area.h) > 2) throw new JevisError('STALE', T('Pencerenin boyutu değişti; yeni bir desktop_screenshot al.', 'The window changed size; take a new desktop_screenshot.'));
    area = { ...area, x: b.X, y: b.Y };
  }
  const point = { x: Math.round(area.x + (x * area.w) / shot.image.w), y: Math.round(area.y + (y * area.h) / shot.image.h) };
  const hit = await ax('hit', point.x, point.y).catch(() => ({ found: false }));
  const what = [description, hit.found && hit.name ? `${hit.role} "${hit.name}"` : ''].filter(Boolean).join(' — ') || T(`(${point.x}, ${point.y}) noktası`, `the point (${point.x}, ${point.y})`);
  const risk = await jev.isRisky(`${right ? 'Right-click' : double ? 'Double-click' : 'Click'} on: ${what}`, { app: shot.app });
  const approval = await guard({ name: `${description} ${hit.name || ''}`, role: hit.role || '' }, risk.p, T(`${shot.app} içinde şuraya tıklamak: ${what}`, `click in ${shot.app} on: ${what}`), shot.app);
  // The helper checks again right before clicking that the window is still the one under the point.
  if (shot.windowId) await ensureFront(shot.pid);
  await ax('click', point.x, point.y, ...(shot.windowId ? ['--pid', shot.pid] : []), ...(double ? ['--double'] : []), ...(right ? ['--right'] : []));
  return { point, hit: hit.found ? { role: hit.role, name: hit.name } : null, approval, ...(await after(shot.pid)) };
}

/** An app's windows: [{ index, title, focused, minimized, x, y, w, h }] (tiny helper windows left out). */
export async function windows(app) {
  await ensureTrusted();
  const r = await ax('windows', ...(await appArgs(app)));
  const shown = r.windows.filter(w => w.w >= 120 && w.h >= 80);
  // the accessibility tree only has the desktops on screen; the app's windows on the others come from allwindows
  const all = await ax('allwindows', '--pid', r.pid).then(x => x.windows, () => []);
  const elsewhere = [...new Set(all.filter(w => !w.onScreen && w.title && !shown.some(s => s.title === w.title)).map(w => w.title))];
  return { app: r.app, pid: r.pid, windows: shown, elsewhere };
}

// ---------------------------------------------------------------------------
// Desktops (Spaces: what a three-finger swipe moves between). macOS has no public
// way to jump to a desktop, so Handry does what a hand would: puts the pointer on
// the display and presses Mission Control's ^← / ^→ (on by default; they move the
// desktops of the display under the pointer). com.apple.spaces lists each
// display's desktops; which one is shown comes from the desktop picture the Dock
// shows ("Wallpaper-<uuid of that desktop>"), which also tells two empty desktops
// apart. The accessibility tree only shows the shown desktop; allwindows shows all.
// ---------------------------------------------------------------------------

const spaceLog = (...a) => { if (process.env.JEVIS_DEBUG_SPACES) console.error('[spaces]', ...a); };

function readSpacesConfig() {
  const xml = execFileSync('defaults', ['export', 'com.apple.spaces', '-']);
  return JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', '-'], { input: xml }).toString());
}

/**
 * Each active display (main first) with its desktops and the one shown:
 * [{ display, main, bounds, spaces: [{ uuid, fullscreen }], current }] (current counts from 1; null while a
 * full-screen app is shown and it can't be told which).
 */
export async function spaces() {
  const [{ displays }, { wallpapers }] = await Promise.all([ax('displays'), ax('wallpapers')]);
  const monitors = readSpacesConfig().SpacesDisplayConfiguration?.['Management Data']?.Monitors || [];
  const inside = (p, d) => p.x >= d.x && p.x < d.x + d.w && p.y >= d.y && p.y < d.y + d.h;
  return displays.map((d, i) => {
    // one shared set of desktops for all displays shows up as "Main"
    // a display's entry can be left empty after displays change: take the one that lists desktops
    const has = x => x?.Spaces?.length;
    const mine = monitors.find(x => x['Display Identifier'] === d.uuid);
    const main = d.main ? monitors.find(x => x['Display Identifier'] === 'Main') : null;
    const m = [mine, main].find(has) || mine || main;
    const list = (m?.Spaces || []).map(sp => ({ uuid: sp.uuid, fullscreen: sp.type === 4 }));
    const shown = wallpapers.find(w => inside(w, d) && list.some(sp => sp.uuid === w.uuid));
    let current = shown ? list.findIndex(sp => sp.uuid === shown.uuid) + 1 : null;
    // no desktop picture: a full-screen app is shown; with only one of those, it is that one
    const full = list.map((sp, n) => (sp.fullscreen ? n + 1 : null)).filter(Boolean);
    if (!current && full.length === 1) current = full[0];
    return { display: i + 1, main: d.main, bounds: { x: d.x, y: d.y, w: d.w, h: d.h }, spaces: list, current };
  }).filter(d => d.spaces.length);
}

/** Which desktop a display shows now (uuid, or '' while a full-screen app is shown). */
async function shownOn(display) {
  const { wallpapers } = await ax('wallpapers');
  const b = display.bounds;
  return wallpapers.find(w => w.x >= b.x && w.x < b.x + b.w && w.y >= b.y && w.y < b.y + b.h)?.uuid || '';
}

/**
 * One ^← / ^→ on the display under the pointer. Waits for the desktop picture to change, then for the slide to
 * end: a key pressed while it still slides is ignored by macOS. A press that didn't take is tried once more.
 */
async function stepSpace(direction, display) {
  const t0 = Date.now();
  const before = await shownOn(display);
  for (let attempt = 0; attempt < 2; attempt++) {
    await ax('key', direction === 'left' ? 'ctrl+left' : 'ctrl+right');
    const pressed = Date.now();
    while (Date.now() - pressed < 2000) {
      await sleep(150);
      if ((await shownOn(display)) !== before) {
        await sleep(650);
        spaceLog(direction, 'moved', Date.now() - t0, 'ms', attempt ? '(second press)' : '');
        return true;
      }
    }
  }
  spaceLog(direction, 'no move', Date.now() - t0, 'ms');
  return false;
}

const center = d => [Math.round(d.bounds.x + d.bounds.w / 2), Math.round(d.bounds.y + d.bounds.h / 2)];

/**
 * Moves a display's desktops (default: the main display): direction 'left' | 'right' (steps), or to: a desktop
 * number. The pointer goes to that display for the keys and comes back after.
 */
export async function switchSpace({ direction = 'right', steps = 1, to, display } = {}) {
  notDuringDialog();
  await ensureTrusted();
  const layout = await spaces();
  const d = (display && layout.find(x => x.display === Number(display))) || layout.find(x => x.main) || layout[0];
  if (!d) throw new JevisError('NO_SPACES', T('Masaüstü bilgisi okunamadı.', "Couldn't read the desktops (Spaces)."));
  const from = d.current;
  let plan;
  if (to) {
    const target = Math.min(Math.max(1, Math.round(Number(to))), d.spaces.length);
    if (!from) throw new JevisError('NO_SPACES', T('Şu an hangi masaüstünün gösterildiği anlaşılamadı (tam ekran uygulama açık olabilir); sağ/sol ile geç.', "Couldn't tell which desktop is shown now (a full-screen app may be open); move right/left instead."));
    plan = { dir: target > from ? 'right' : 'left', n: Math.abs(target - from) };
  } else plan = { dir: direction, n: Math.min(Math.max(1, Number(steps) || 1), 16) };
  const was = await ax('cursor');
  let moved = 0;
  try {
    await ax('glide', ...center(d));
    await sleep(250); // the display under the pointer becomes the one the keys move
    for (let i = 0; i < plan.n; i++) {
      if (!(await stepSpace(plan.dir, d))) break;
      moved++;
    }
  } finally {
    if (was?.x !== undefined) await ax('glide', Math.round(was.x), Math.round(was.y)).catch(() => {});
  }
  await sleep(250); // focus follows the slide a little later
  const now = (await spaces()).find(x => x.display === d.display);
  return { display: d.display, main: d.main, count: d.spaces.length, from, to: now?.current ?? null, moved, fullscreen: Boolean(now?.current && now.spaces[now.current - 1]?.fullscreen), front: await frontmost().catch(() => null) };
}

/** Windows of the app (pid) on other desktops whose title has `wanted`. */
async function windowsElsewhere(pid, wanted) {
  const { windows: all } = await ax('allwindows', '--pid', pid);
  return all.filter(w => !w.onScreen && w.title.toLocaleLowerCase('tr').includes(wanted));
}

/**
 * Visits each display's other desktops until the window shows up there. If it isn't found anywhere, each
 * display goes back to the desktop it showed. The pointer goes back too.
 */
async function walkToWindow(pid, wanted, away = []) {
  // the accessibility tree catches up with the shown desktop a moment after the picture: look for a while
  const here = async () => {
    for (let i = 0; i < 6; i++) {
      const win = (await ax('windows', '--pid', pid)).windows.find(w => w.title.toLocaleLowerCase('tr').includes(wanted));
      if (win) return win;
      await sleep(250);
    }
    return null;
  };
  const was = await ax('cursor');
  try {
    // the display a hidden window sits on is known from where it is: that one first, the others after
    const layout = (await spaces()).filter(x => x.spaces.length > 1);
    const holds = d => away.some(w => w.x + w.w / 2 >= d.bounds.x && w.x + w.w / 2 < d.bounds.x + d.bounds.w && w.y + 20 >= d.bounds.y && w.y + 20 < d.bounds.y + d.bounds.h);
    for (const d of [...layout.filter(holds), ...layout.filter(x => !holds(x))]) {
      const home = d.current;
      await ax('glide', ...center(d));
      await sleep(250);
      // from where it is: everything to the left, then everything to the right
      let at = home || 1;
      const order = [...Array(d.spaces.length).keys()].map(i => i + 1).filter(n => n !== home);
      for (const n of [...order.filter(n => n < at).reverse(), ...order.filter(n => n > at)]) {
        while (at !== n) {
          const dir = n > at ? 'right' : 'left';
          if (!(await stepSpace(dir, d))) break;
          at += dir === 'right' ? 1 : -1;
        }
        if (at !== n) continue;
        const win = await here();
        spaceLog('display', d.display, 'desktop', n, 'window here:', Boolean(win));
        if (win) return win;
      }
      // not on this display: back to the desktop it showed
      while (home && at !== home) {
        const dir = home > at ? 'right' : 'left';
        if (!(await stepSpace(dir, d))) break;
        at += dir === 'right' ? 1 : -1;
      }
    }
    return null;
  } finally {
    if (was?.x !== undefined) await ax('glide', Math.round(was.x), Math.round(was.y)).catch(() => {});
  }
}

/** Brings one window of an app to the front: its number from windows(), or words from its title. A window on another desktop is gone to. */
export async function focusWindow(app, which) {
  notDuringDialog();
  const { app: name, pid, windows: list } = await windows(app);
  const wanted = clean(which).toLocaleLowerCase('tr');
  let win = /^\d+$/.test(wanted) ? list.find(w => w.index === Number(wanted)) : null;
  if (!win) {
    const matches = list.filter(w => w.title.toLocaleLowerCase('tr').includes(wanted));
    if (matches.length === 1) win = matches[0];
  }
  // Not on this desktop, but open on another one (what a three-finger swipe would find): go there.
  const away = !win && wanted && !/^\d+$/.test(wanted) ? await windowsElsewhere(pid, wanted) : [];
  if (away.length) {
    win = await walkToWindow(pid, wanted, away);
    if (!win) throw new JevisError('NOT_FOUND', T(`"${which}" penceresi ekranda değil ve masaüstlerinin hiçbirinde bulunamadı: gizlenmiş ya da kapatılmış olabilir (masaüstleri gezildi, geri dönüldü).`, `The "${which}" window isn't on the screen and wasn't found on any desktop: it may be hidden or closed (went through the desktops and came back).`));
  }
  if (!list.length && !win) throw new JevisError('NOT_FOUND', T(`${name} uygulamasının açık penceresi yok.`, `${name} has no open window.`));
  if (!win) {
    const untitled = T('(başlıksız)', '(untitled)');
    const pick = await jev.pickOption(`window of ${name}`, which, list.map(w => w.title || untitled));
    if (pick.index === null || !jev.isConfident(pick)) {
      const shown = list.map(w => `${w.index}. ${w.title || untitled}`).join(' | ');
      throw new JevisError('NOT_FOUND', T(`"${which}" diye bir ${name} penceresi bulunamadı. Pencereler: ${shown}`, `No ${name} window called "${which}" was found. Windows: ${shown}`));
    }
    win = list[pick.index];
  }
  await ax('raise', win.index, '--pid', pid);
  for (let i = 0; i < 10; i++) {
    await sleep(150);
    const f = await frontmost().catch(() => ({}));
    if (f.pid === pid && f.window === win.title) break;
  }
  return { raised: win.title || T(`${win.index}. pencere`, `window ${win.index}`), ...(await after(pid)) };
}

/**
 * Waits until words show up in an app's front window (a control, a text or
 * the title), or with gone: true until they are no longer there.
 */
export async function waitFor(words, { app, seconds = 10, gone = false } = {}) {
  await ensureTrusted();
  const wanted = clean(words).toLocaleLowerCase('tr');
  const limit = Math.min(Math.max(Number(seconds) || 10, 1), 120) * 1000;
  const started = Date.now();
  let r = null;
  for (;;) {
    r = await read({ app });
    const seen = [r.window, ...r.texts, ...r.elements.flatMap(e => [e.name, e.value, e.ctx])]
      .find(t => t !== undefined && t !== null && String(t).toLocaleLowerCase('tr').includes(wanted));
    if (gone ? !seen : seen) return { waited: Date.now() - started, found: gone ? null : clean(seen).slice(0, 120), gone, app: r.app, window: r.window };
    if (Date.now() - started > limit) break;
    if (isStopped()) throw new JevisError('STOPPED', T('Kullanıcı acil durdurma yaptı.', 'The user pressed the emergency stop.'));
    await sleep(500);
  }
  const where = `${r.app}${r.window ? ` — ${r.window}` : ''}`;
  throw new JevisError('TIMEOUT', T(`${Math.round(limit / 1000)} sn beklendi; "${words}" ${gone ? 'hâlâ duruyor' : 'görünmedi'} (${where}).`, `Waited ${Math.round(limit / 1000)} s; "${words}" ${gone ? 'is still there' : "didn't show up"} (${where}).`));
}

/** May Handry send Apple Events to that app? granted | denied | ask | not_running (never asks). */
/**
 * The Apple menu's items, read from Finder's menu bar (Finder always runs).
 * Pressing one works in the background, like clicking it; only Accessibility is needed.
 */
export async function appleMenu() {
  await ensureTrusted();
  const finder = (await apps()).find(a => a.bundleId === 'com.apple.finder');
  if (!finder) throw new JevisError('NO_APP', T('Finder çalışmıyor; Apple menüsüne ulaşılamadı.', "Finder isn't running; couldn't reach the Apple menu."));
  const tree = await ax('tree', '--pid', finder.pid, '--menus', '--max', '2000');
  return { pid: finder.pid, items: tree.elements.filter(e => e.path.startsWith('m.0.0.')).map(e => ({ name: clean(e.name), path: e.path })) };
}

/** Presses the Apple menu item with one of these names ("Ekranı Kilitle" / "Lock Screen"). */
export async function pressAppleMenu(names) {
  const { pid, items } = await appleMenu();
  const item = items.find(i => names.includes(i.name));
  if (!item) throw new JevisError('NOT_FOUND', T(`Apple menüsünde "${names[0]}" yok.`, `The Apple menu has no "${names.join('" or "')}".`));
  await ax('press', '--pid', pid, item.path, '--expect', item.name);
  return item.name;
}

export async function automationState(bundleId) {
  return ax('automation', bundleId);
}

/** Records the microphone to a 16 kHz WAV (for whisper.cpp). */
export async function record(seconds, file) {
  return ax('record', seconds, file);
}

export function formatRead(r, { maxElements = 250 } = {}) {
  const lines = T(
    [`Uygulama: ${r.app}`, `Pencere: ${r.window || '(yok)'}`, '', `Öğeler (${r.elements.length}${r.truncated ? ', liste kısaltıldı' : ''}):`],
    [`App: ${r.app}`, `Window: ${r.window || '(none)'}`, '', `Controls (${r.elements.length}${r.truncated ? ', list shortened' : ''}):`]
  );
  for (const e of r.elements.slice(0, maxElements)) lines.push(`#${e.id} ${labelOf(e)}`);
  if (r.texts.length) lines.push('', T('Metinler:', 'Texts:'), ...r.texts.slice(0, 80));
  return lines.join('\n');
}

export function formatOutcome(res) {
  const parts = [];
  const secs = () => (res.waited / 1000).toFixed(1);
  if (res.element) parts.push(T(`Öğe: "${res.element.name}"${res.jev ? ` (Jev %${res.jev.confidence}, ${res.jev.ms} ms)` : ''}`, `Control: "${res.element.name}"${res.jev ? ` (Jev ${res.jev.confidence}%, ${res.jev.ms} ms)` : ''}`));
  if (res.typed !== undefined) parts.push(T(`${res.typed} karakter yazıldı`, `${res.typed} ${res.typed === 1 ? 'character' : 'characters'} typed`));
  if (res.key) parts.push(T(`Tuş: ${res.key}`, `Key: ${res.key}`));
  if (res.approval) parts.push(T(`Kullanıcı onayladı (${res.approval.reason})`, `The user allowed it (${res.approval.reason})`));
  if (res.quit) parts.push(T(`Kapatıldı: ${res.quit}`, `Quit: ${res.quit}`));
  if (res.point) parts.push(T(`Tıklandı: (${res.point.x}, ${res.point.y})${res.hit ? ` — altında [${res.hit.role}] ${res.hit.name || '(isimsiz)'}` : ''}`, `Clicked: (${res.point.x}, ${res.point.y})${res.hit ? ` — under it [${res.hit.role}] ${res.hit.name || '(unnamed)'}` : ''}`));
  if (res.raised) parts.push(T(`Pencere öne getirildi: ${res.raised}`, `Window brought to the front: ${res.raised}`));
  if (res.found) parts.push(T(`Göründü: "${res.found}" (${secs()} sn)`, `Showed up: "${res.found}" (${secs()} s)`));
  if (res.gone) parts.push(T(`Kayboldu (${secs()} sn)`, `Gone (${secs()} s)`));
  if (res.note) parts.push(res.note);
  if (res.app !== undefined) parts.push(T(`Önde: ${res.app}${res.window ? ` — ${res.window}` : ''}`, `In front: ${res.app}${res.window ? ` — ${res.window}` : ''}`));
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Şifre alanı ve pencere yerleştirme 
// ---------------------------------------------------------------------------

/**
 * Bir uygulamanın alanına kasadaki şifreyi yazar. Değer hiçbir mesaja, onaya ya da kayda girmez.
 * Terminallere hiç yazılmaz. Şifre sadece izin listesinde "app:<uygulama adı ya da paket kimliği>" olan uygulamalarda.
 */
export async function fillSecret(target, secretName, { app } = {}) {
  notDuringDialog();
  await ensureTrusted();
  const { listSecrets, readSecret } = await import('../guard/vault.js');
  const kayit = listSecrets().find(s => s.name === secretName);
  if (!kayit) throw new JevisError('NOT_ALLOWED', T(`"${secretName}" adında kayıtlı bir şifre yok.`, `No saved password is called "${secretName}".`));
  const el = await resolve(target, 'type', { app });
  if (SHELL_APPS.has(el.bundleId)) throw new JevisError('NOT_ALLOWED', T('Terminale şifre yazılmaz.', 'Passwords are never typed into a terminal.'));
  const uygulama = (await apps()).find(a => String(a.pid) === String(el.pid));
  const adlar = [uygulama?.name, el.bundleId].filter(Boolean).map(x => `app:${String(x).toLowerCase()}`);
  if (!kayit.sites.some(s => adlar.includes(String(s).toLowerCase()))) {
    throw new JevisError('NOT_ALLOWED', T(`"${secretName}" bu uygulamada kullanılamaz. İzinli olanlar: ${kayit.sites.join(', ') || '(hiçbiri)'}. Bu uygulama: ${adlar.join(' / ')}`, `"${secretName}" can't be used in this app. Allowed: ${kayit.sites.join(', ') || '(none)'}. This app: ${adlar.join(' / ')}`));
  }
  const deger = await readSecret(secretName);
  const res = await ax('setvalue', el.path, deger, '--pid', el.pid);
  return { element: { name: el.name, role: el.role }, jev: { confidence: pct(el.pick.confidence), ms: el.pick.ms }, typed: deger.length, method: res.method, note: T('Şifre yazıldı (değer gösterilmez).', 'Password typed (the value is not shown).'), ...(await after(el.pid)) };
}

/** Ekranların kullanılabilir alanları (menü çubuğu ve Dock hariç), sol üst köşe başlangıçlı. */
async function ekranlar() {
  const { stdout } = await execFileAsync('osascript', ['-l', 'JavaScript', '-e',
    "ObjC.import('AppKit'); const s = $.NSScreen.screens.js; const anaY = s[0].frame.size.height; JSON.stringify(s.map(e => { const v = e.visibleFrame; return { x: v.origin.x, y: anaY - (v.origin.y + v.size.height), w: v.size.width, h: v.size.height }; }))"]);
  return JSON.parse(stdout.trim());
}

const YERLER = {
  tam: e => [e.x, e.y, e.w, e.h],
  sol: e => [e.x, e.y, Math.floor(e.w / 2), e.h],
  sag: e => [e.x + Math.floor(e.w / 2), e.y, Math.ceil(e.w / 2), e.h],
  ust: e => [e.x, e.y, e.w, Math.floor(e.h / 2)],
  alt: e => [e.x, e.y + Math.floor(e.h / 2), e.w, Math.ceil(e.h / 2)],
  orta: e => [e.x + Math.floor(e.w * 0.15), e.y + Math.floor(e.h * 0.1), Math.floor(e.w * 0.7), Math.floor(e.h * 0.8)]
};

// The places in English, for the result and for a yer given in English ("left", "full") or with Turkish letters ("sağ", "üst").
const YER_EN = { tam: 'full', sol: 'left', sag: 'right', ust: 'top', alt: 'bottom', orta: 'center', kucult: 'minimize', geri: 'restore' };
const YER_ALIAS = { ...Object.fromEntries(Object.entries(YER_EN).map(([tr, en]) => [en, tr])), sağ: 'sag', üst: 'ust', küçült: 'kucult', centre: 'orta', centered: 'orta', minimise: 'kucult', back: 'geri' };
const yerText = yer => T(yer, YER_EN[yer] || yer);

/** Düzenlemeden önce pencerenin yeri ve boyutu saklanır: "geri" onu eski yerine koyar */
async function yeriKaydet(pid, pencere) {
  const r = await ax('windows', '--pid', pid).catch(() => null);
  const w = r?.windows?.find(x => !pencere || String(x.title || '').toLocaleLowerCase('tr').includes(String(pencere).toLocaleLowerCase('tr')));
  if (!w || w.minimized) return;
  const state = loadState();
  const yerler = state.pencereYerleri || {};
  yerler[`${r.app}|${w.title || ''}`] = { x: w.x, y: w.y, w: w.w, h: w.h, zaman: Date.now() };
  saveState({ pencereYerleri: yerler });
}

async function pencereYerlestir(pid, pencere, [x, y, w, h]) {
  await yeriKaydet(pid, pencere);
  const r = await ax('setframe', x, y, w, h, '--pid', pid, ...(pencere ? ['--title', pencere] : []));
  const fark = Math.abs(r.w - w) > 8 || Math.abs(r.h - h) > 8;
  return T(`${r.title || '(adsız pencere)'} (${r.w}×${r.h}${fark ? `; istenen ${w}×${h}, uygulama daha küçük/büyük olamıyor` : ''})`, `${r.title || '(untitled window)'} (${r.w}×${r.h}${fark ? `; asked for ${w}×${h}, the app can't get smaller/bigger` : ''})`);
}

/**
 * Pencereyi ekranda yerleştirir: tam, sol, sag, ust, alt, orta. ikinci verilirse iki uygulama yan yana
 * (ilki sol, ikincisi sağ). ekran: 1 = ana ekran.
 */
export async function arrange(app, yer = 'tam', { pencere, ikinci, ekran = 1, uygulamalar } = {}) {
  notDuringDialog();
  await ensureTrusted();
  const liste = await ekranlar();
  const e = liste[Math.min(Math.max(1, Number(ekran) || 1), liste.length) - 1];
  yer = YER_ALIAS[String(yer).toLowerCase()] || yer;
  if (yer === 'kucult') return kucult(app, pencere);
  if (yer === 'geri') return geriGetir(app, pencere);
  // ikiden fazla uygulama: ızgara (3 sütun, 2×2, 3×2...)
  const hepsi = [app, ...(uygulamalar || [])].filter(Boolean);
  if (hepsi.length > 2) return izgara(hepsi, e, liste);
  if (!YERLER[yer]) throw new JevisError('BAD_ARGS', T(`yer şunlardan biri olmalı: ${Object.keys(YERLER).join(', ')}, kucult, geri`, `yer must be one of: ${Object.keys(YER_EN).join(', ')} (in English: ${Object.values(YER_EN).join(', ')})`));
  if (hepsi.length === 2 && !ikinci) ikinci = hepsi[1];
  const [, pid] = await appArgs(app);
  const yapilan = [`${app}: ${await pencereYerlestir(pid, pencere, YERLER[ikinci ? 'sol' : yer](e))} → ${yerText(ikinci ? 'sol' : yer)}`];
  if (ikinci) {
    const [, pid2] = await appArgs(ikinci);
    yapilan.push(`${ikinci}: ${await pencereYerlestir(pid2, '', YERLER.sag(e))} → ${T('sağ', 'right')}`);
  }
  const hangi = `${liste.indexOf(e) + 1}/${liste.length}`;
  return { note: T(`Yerleştirildi (ekran ${hangi}):\n${yapilan.join('\n')}`, `Arranged (display ${hangi}):\n${yapilan.join('\n')}`) };
}

/** Izgara: n pencere için sütun × satır (3 → 3×1, 4 → 2×2, 5-6 → 3×2, 7-9 → 3×3) */
export function izgaraBoyutu(n) {
  if (n <= 3) return [n, 1];
  if (n === 4) return [2, 2];
  if (n <= 6) return [3, 2];
  return [3, Math.ceil(n / 3)];
}

async function izgara(uygulamalar, e, liste) {
  const [sutun, satir] = izgaraBoyutu(uygulamalar.length);
  const gw = Math.floor(e.w / sutun), gh = Math.floor(e.h / satir);
  const yapilan = [];
  for (const [i, app] of uygulamalar.entries()) {
    const [, pid] = await appArgs(app);
    const x = e.x + (i % sutun) * gw, y = e.y + Math.floor(i / sutun) * gh;
    const [c, r] = [(i % sutun) + 1, Math.floor(i / sutun) + 1];
    yapilan.push(`${app}: ${await pencereYerlestir(pid, '', [x, y, gw, gh])} → ${T(`${c}. sütun, ${r}. satır`, `column ${c}, row ${r}`)}`);
  }
  const hangi = `${liste.indexOf(e) + 1}/${liste.length}`;
  return { note: T(`${uygulamalar.length} pencere ${sutun}×${satir} dizildi (ekran ${hangi}):\n${yapilan.join('\n')}`, `${uygulamalar.length} windows arranged ${sutun}×${satir} (display ${hangi}):\n${yapilan.join('\n')}`) };
}

async function kucult(app, pencere) {
  const [, pid] = await appArgs(app);
  await yeriKaydet(pid, pencere);
  const r = await ax('minimize', '--pid', pid, ...(pencere ? ['--title', pencere] : []));
  return { note: T(`${app}: ${r.title || 'pencere'} Dock'a küçültüldü.`, `${app}: ${r.title || 'window'} minimized to the Dock.`) };
}

/** Pencereyi küçültmeden ya da yerleştirmeden önceki yerine ve boyutuna koyar (kayıt yoksa sadece açar) */
async function geriGetir(app, pencere) {
  const [, pid] = await appArgs(app);
  const r = await ax('windows', '--pid', pid);
  const w = r.windows.find(x => !pencere || String(x.title || '').toLocaleLowerCase('tr').includes(String(pencere).toLocaleLowerCase('tr')));
  if (!w) throw new JevisError('NOT_FOUND', T(`${app} içinde böyle bir pencere yok.`, `${app} has no such window.`));
  const kayit = (loadState().pencereYerleri || {})[`${r.app}|${w.title || ''}`];
  if (kayit) {
    const s = await ax('setframe', kayit.x, kayit.y, kayit.w, kayit.h, '--pid', pid, ...(w.title ? ['--title', w.title] : []));
    return { note: T(`${app}: ${s.title || 'pencere'} eski yerine kondu (${s.w}×${s.h}).`, `${app}: ${s.title || 'window'} put back where it was (${s.w}×${s.h}).`) };
  }
  await ax('raise', w.index, '--pid', pid);
  return { note: T(`${app}: ${w.title || 'pencere'} açıldı (eski yeri kayıtlı değildi).`, `${app}: ${w.title || 'window'} brought up (where it was before wasn't saved).`) };
}
