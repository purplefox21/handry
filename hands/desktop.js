// Desktop hands: any Mac app through its accessibility tree (bin/jevis-ax).
// Same idea as the browser: list the controls, let Jev pick the one the
// instruction means, press it. Terminals and app-quitting keys need consent.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { ROOT, homeDir, loadState, saveState } from '../core/config.js';
import { JevisError } from '../core/errors.js';
import { desktopHumanOn } from './human.js';
import * as jev from '../core/jev.js';
import { needsConfirm, confirmAction, dialogOpen, harmlessByKind } from '../guard/confirm.js';
import { isStopped } from '../guard/stop.js';
import { APP_NAME } from '../core/brand.js';

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
    throw new JevisError('DESKTOP', `Masaüstü yardımcısı hata verdi: ${err.message}`);
  }
}

let trustedChecked = false;
async function ensureTrusted() {
  if (trustedChecked) return;
  const { trusted } = await ax('trusted');
  if (!trusted) {
    throw new JevisError('NO_PERMISSION', `Erişilebilirlik izni yok. Sistem Ayarları › Gizlilik ve Güvenlik › Erişilebilirlik bölümünde ${APP_NAME} uygulamasını (ya da onu çalıştıran Terminal / VS Code'u) aç. ${APP_NAME} menüsündeki "İzinler…" penceresi doğru sayfayı açar.`);
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
    if (pick.index === null || !jev.isConfident(pick)) throw new JevisError('NO_APP', `"${app}" adında açık bir uygulama yok. Açık olanlar: ${list.map(a => a.name).join(', ')}`);
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
  return `[${role}] ${e.name || e.subrole || '(isimsiz)'}${e.ctx ? ` — ${e.ctx}` : ''}${state.length ? ` {${state.join(', ')}}` : ''}`;
}

/** Controls (#d1, #d2…) and texts of an app's front window; menus optional. */
export async function read({ app, menus = false, remember = true } = {}) {
  await ensureTrusted();
  const tree = await ax('tree', ...(await appArgs(app)), ...(menus ? ['--menus'] : []));
  const elements = tree.elements.map((e, i) => ({ ...e, id: `d${i + 1}`, name: clean(e.name), ctx: clean(e.ctx) }));
  // The window's texts are kept too: a later #dN click shows them to the risk check ("Bu belgeyi tutmak istiyor musunuz?").
  if (remember) saveState({ desktop: { pid: tree.pid, app: tree.app, window: tree.window, texts: tree.texts.map(clean).filter(Boolean).slice(0, 12), ids: Object.fromEntries(elements.map(e => [e.id, { path: e.path, name: e.name }])) } });
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
    if (!entry) throw new JevisError('STALE', `#${id[1]} bilinmiyor. Önce pencereyi oku (desktop_read).`);
    const front = await frontmost();
    const risk = withRisk ? (await jev.isRisky(PURPOSE[purpose](entry.name), { app: saved.app, window: saved.window })).p : null;
    return { path: entry.path, name: entry.name, expect: entry.name, role: '', pid: saved.pid, bundleId: front.bundleId, context: saved.texts || [], pick: { confidence: 1, risk, ms: 0 } };
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
      return { path: el.path, name: el.name || el.subrole || el.role, expect: el.name, role: el.role, pid: r.pid, bundleId: r.bundleId, context: r.texts.slice(0, 12), pick };
    }
    if (!best || (alternatives[0]?.p || 0) > (best.alternatives[0]?.p || 0)) best = { app: r.app, pick, alternatives };
  }
  if (best && best.pick.index !== null) {
    throw new JevisError('LOW_CONFIDENCE', `Jev "${target}" için emin değil (%${pct(best.pick.confidence)}). Adaylardan birini #id ile seçin.`, { alternatives: best.alternatives });
  }
  if (best) throw new JevisError('NOT_FOUND', `"${target}" ${best.app} içinde bulunamadı (pencere ve menüler).`, { alternatives: best.alternatives });
  throw new JevisError('NOT_FOUND', 'Pencerede kullanılabilir öğe yok.');
}

async function guard(el, riskP, actionText, app) {
  const verdict = needsConfirm({ name: el.name, role: el.role }, riskP, app || '');
  if (!verdict.ask) return null;
  // What the window says decides what a button does: "Sil" under "Bu belgeyi tutmak istiyor musunuz?" throws a
  // document away. Without it Jev took that "Sil" for something harmless and the user was never asked.
  const said = el.context?.length ? `; pencerede: ${el.context.join(' · ').slice(0, 600)}` : '';
  if (await harmlessByKind(verdict, `${actionText} (uygulama: ${app}${said})`)) return null;
  const ok = await confirmAction(`${APP_NAME} şunu yapmak istiyor:\n\n${actionText}\n\nUygulama: ${app}\nNeden soruluyor: ${verdict.reason}\n\nİzin veriyor musun?`);
  if (!ok) throw new JevisError('DENIED', `Kullanıcı izin vermedi: ${actionText}`);
  return { reason: verdict.reason };
}

async function shellGuard(bundleId, what) {
  if (!SHELL_APPS.has(bundleId)) return;
  const ok = await confirmAction(`${APP_NAME} bir terminale şunu yapmak istiyor:\n\n${what}\n\nTerminale yazılanlar komut olarak çalışabilir. İzin veriyor musun?`);
  if (!ok) throw new JevisError('DENIED', `Kullanıcı terminal işlemine izin vermedi: ${what}`);
}

async function after(pid) {
  await sleep(150);
  const f = await frontmost().catch(() => ({}));
  return { app: f.app, window: f.window, changedApp: f.pid !== pid };
}

/** No touching the screen while a confirmation dialog waits for the user (a click could answer it). */
function notDuringDialog() {
  if (dialogOpen()) throw new JevisError('WAIT_USER', 'Ekranda kullanıcıya soru soran bir onay penceresi açık. Cevabını bekle; o sırada ekrana dokunmuyorum.');
}

export async function click(target, { app } = {}) {
  notDuringDialog();
  await ensureTrusted();
  const el = await resolve(target, 'click', { app, withRisk: true });
  const approval = await guard(el, el.pick.risk, `"${el.name}" öğesine basmak`, (await frontmost()).app);
  const res = await ax('press', el.path, '--pid', el.pid, '--expect', el.expect || '');
  return { element: { name: el.name, role: el.role }, jev: { confidence: pct(el.pick.confidence), ms: el.pick.ms }, method: res.method, approval, ...(await after(el.pid)) };
}

/** With a target: fills that field. Without: types into whatever has focus. */
export async function type(target, text, { app, submit = false } = {}) {
  notDuringDialog();
  await ensureTrusted();
  if (!target) {
    const front = await ensureFront(app);
    await shellGuard(front.bundleId, `"${text}" yazmak${submit ? ' ve Enter\'a basmak' : ''}`);
    await ax('type', text);
    if (submit) await ax('key', 'return');
    return { typed: text.length, ...(await after(front.pid)) };
  }
  const el = await resolve(target, 'type', { app });
  await shellGuard(el.bundleId, `"${text}" yazmak`);
  const res = await ax('setvalue', el.path, text, '--pid', el.pid);
  let approval = null;
  if (submit) {
    const risk = await jev.isRisky(`Press Enter after typing into "${el.name}"`, { app: el.bundleId });
    approval = await guard(el, risk.p, `"${el.name}" alanında Enter'a basmak`, el.bundleId);
    await ax('key', 'return');
  }
  return { element: { name: el.name, role: el.role }, jev: { confidence: pct(el.pick.confidence), ms: el.pick.ms }, typed: text.length, method: res.method, approval, ...(await after(el.pid)) };
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
    const name = typeof app === 'number' ? (await apps()).find(a => a.pid === app)?.name || 'Uygulama' : app;
    throw new JevisError('NOT_FRONT', `${name} öne getirilemedi (önde: ${front.app}); hiçbir şey gönderilmedi. Ekranda cevap bekleyen bir sistem sorusu olabilir.`);
  }
  return front;
}

export async function key(combo, { app } = {}) {
  notDuringDialog();
  await ensureTrusted();
  const normalized = combo.toLowerCase().replace(/\s+/g, '');
  const front = await ensureFront(app);
  if (DANGEROUS_KEYS.has(normalized)) {
    const ok = await confirmAction(`${APP_NAME} "${front.app}" içinde ${combo} kısayoluna basmak istiyor (uygulama kapanabilir ya da veri silinebilir).\n\nİzin veriyor musun?`);
    if (!ok) throw new JevisError('DENIED', `Kullanıcı izin vermedi: ${combo}`);
  }
  if (['return', 'enter'].includes(normalized)) await shellGuard(front.bundleId, 'Enter\'a basmak (yazılı komut çalışır)');
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
    if (!shot || Date.now() - shot.at > SHOT_MAX_AGE_MS) throw new JevisError('NO_SHOT', 'Bir noktada kaydırmak için önce desktop_screenshot al (ya da x, y vermeden pencerenin ortasında kaydır).');
    front = await ensureFront(shot.pid);
    let area = shot.area;
    if (shot.windowId) {
      if (front.windowId !== shot.windowId) throw new JevisError('STALE', `${shot.app} içinde önde başka bir pencere var; yeni bir desktop_screenshot al.`);
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
    if (pick.index === null || !jev.isConfident(pick)) throw new JevisError('NO_APP', `"${name}" adında bir uygulama bulunamadı.`);
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
  return { quit: null, stillOpen: target.name, note: `${target.name} kapanmadı; muhtemelen "kaydedilsin mi?" sorusu açık. desktop_read ile bakıp cevapla.` };
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
      throw new JevisError('NO_PERMISSION', `Ekran Kaydı izni yok. Sistem Ayarları › Gizlilik ve Güvenlik › Ekran ve Sistem Sesi Kaydı bölümünde ${APP_NAME} uygulamasını (ya da onu çalıştıran Terminal / VS Code'u) aç, sonra kapatıp yeniden aç.`);
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
  if (!shot || Date.now() - shot.at > SHOT_MAX_AGE_MS) throw new JevisError('NO_SHOT', 'Önce desktop_screenshot al; x ve y o görüntünün piksel koordinatları olmalı.');
  if (!(x >= 0 && y >= 0 && x <= shot.image.w && y <= shot.image.h)) throw new JevisError('BAD_ARGS', `Nokta görüntünün dışında (görüntü ${shot.image.w}×${shot.image.h} piksel).`);
  let area = shot.area;
  if (shot.windowId) {
    // The pixels belong to that window: it must be in front, the same size.
    const front = await ensureFront(shot.pid);
    if (front.windowId !== shot.windowId) throw new JevisError('STALE', `${shot.app} içinde önde başka bir pencere var; yeni bir desktop_screenshot al.`);
    const b = front.bounds;
    if (Math.abs(b.Width - area.w) > 2 || Math.abs(b.Height - area.h) > 2) throw new JevisError('STALE', 'Pencerenin boyutu değişti; yeni bir desktop_screenshot al.');
    area = { ...area, x: b.X, y: b.Y };
  }
  const point = { x: Math.round(area.x + (x * area.w) / shot.image.w), y: Math.round(area.y + (y * area.h) / shot.image.h) };
  const hit = await ax('hit', point.x, point.y).catch(() => ({ found: false }));
  const what = [description, hit.found && hit.name ? `${hit.role} "${hit.name}"` : ''].filter(Boolean).join(' — ') || `(${point.x}, ${point.y}) noktası`;
  const risk = await jev.isRisky(`${right ? 'Right-click' : double ? 'Double-click' : 'Click'} on: ${what}`, { app: shot.app });
  const approval = await guard({ name: `${description} ${hit.name || ''}`, role: hit.role || '' }, risk.p, `${shot.app} içinde şuraya tıklamak: ${what}`, shot.app);
  // The helper checks again right before clicking that the window is still the one under the point.
  if (shot.windowId) await ensureFront(shot.pid);
  await ax('click', point.x, point.y, ...(shot.windowId ? ['--pid', shot.pid] : []), ...(double ? ['--double'] : []), ...(right ? ['--right'] : []));
  return { point, hit: hit.found ? { role: hit.role, name: hit.name } : null, approval, ...(await after(shot.pid)) };
}

/** An app's windows: [{ index, title, focused, minimized, x, y, w, h }] (tiny helper windows left out). */
export async function windows(app) {
  await ensureTrusted();
  const r = await ax('windows', ...(await appArgs(app)));
  return { app: r.app, pid: r.pid, windows: r.windows.filter(w => w.w >= 120 && w.h >= 80) };
}

/** Brings one window of an app to the front: its number from windows(), or words from its title. */
export async function focusWindow(app, which) {
  notDuringDialog();
  const { app: name, pid, windows: list } = await windows(app);
  if (!list.length) throw new JevisError('NOT_FOUND', `${name} uygulamasının açık penceresi yok.`);
  const wanted = clean(which).toLocaleLowerCase('tr');
  let win = /^\d+$/.test(wanted) ? list.find(w => w.index === Number(wanted)) : null;
  if (!win) {
    const matches = list.filter(w => w.title.toLocaleLowerCase('tr').includes(wanted));
    if (matches.length === 1) win = matches[0];
  }
  if (!win) {
    const pick = await jev.pickOption(`window of ${name}`, which, list.map(w => w.title || '(başlıksız)'));
    if (pick.index === null || !jev.isConfident(pick)) {
      throw new JevisError('NOT_FOUND', `"${which}" diye bir ${name} penceresi bulunamadı. Pencereler: ${list.map(w => `${w.index}. ${w.title || '(başlıksız)'}`).join(' | ')}`);
    }
    win = list[pick.index];
  }
  await ax('raise', win.index, '--pid', pid);
  for (let i = 0; i < 10; i++) {
    await sleep(150);
    const f = await frontmost().catch(() => ({}));
    if (f.pid === pid && f.window === win.title) break;
  }
  return { raised: win.title || `${win.index}. pencere`, ...(await after(pid)) };
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
    if (isStopped()) throw new JevisError('STOPPED', 'Kullanıcı acil durdurma yaptı.');
    await sleep(500);
  }
  throw new JevisError('TIMEOUT', `${Math.round(limit / 1000)} sn beklendi; "${words}" ${gone ? 'hâlâ duruyor' : 'görünmedi'} (${r.app}${r.window ? ` — ${r.window}` : ''}).`);
}

/** May Handry send Apple Events to that app? granted | denied | ask | not_running (never asks). */
/**
 * The Apple menu's items, read from Finder's menu bar (Finder always runs).
 * Pressing one works in the background, like clicking it; only Accessibility is needed.
 */
export async function appleMenu() {
  await ensureTrusted();
  const finder = (await apps()).find(a => a.bundleId === 'com.apple.finder');
  if (!finder) throw new JevisError('NO_APP', 'Finder çalışmıyor; Apple menüsüne ulaşılamadı.');
  const tree = await ax('tree', '--pid', finder.pid, '--menus', '--max', '2000');
  return { pid: finder.pid, items: tree.elements.filter(e => e.path.startsWith('m.0.0.')).map(e => ({ name: clean(e.name), path: e.path })) };
}

/** Presses the Apple menu item with one of these names ("Ekranı Kilitle" / "Lock Screen"). */
export async function pressAppleMenu(names) {
  const { pid, items } = await appleMenu();
  const item = items.find(i => names.includes(i.name));
  if (!item) throw new JevisError('NOT_FOUND', `Apple menüsünde "${names[0]}" yok.`);
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
  const lines = [`Uygulama: ${r.app}`, `Pencere: ${r.window || '(yok)'}`, '', `Öğeler (${r.elements.length}${r.truncated ? ', liste kısaltıldı' : ''}):`];
  for (const e of r.elements.slice(0, maxElements)) lines.push(`#${e.id} ${labelOf(e)}`);
  if (r.texts.length) lines.push('', 'Metinler:', ...r.texts.slice(0, 80));
  return lines.join('\n');
}

export function formatOutcome(res) {
  const parts = [];
  if (res.element) parts.push(`Öğe: "${res.element.name}"${res.jev ? ` (Jev %${res.jev.confidence}, ${res.jev.ms} ms)` : ''}`);
  if (res.typed !== undefined) parts.push(`${res.typed} karakter yazıldı`);
  if (res.key) parts.push(`Tuş: ${res.key}`);
  if (res.approval) parts.push(`Kullanıcı onayladı (${res.approval.reason})`);
  if (res.quit) parts.push(`Kapatıldı: ${res.quit}`);
  if (res.point) parts.push(`Tıklandı: (${res.point.x}, ${res.point.y})${res.hit ? ` — altında [${res.hit.role}] ${res.hit.name || '(isimsiz)'}` : ''}`);
  if (res.raised) parts.push(`Pencere öne getirildi: ${res.raised}`);
  if (res.found) parts.push(`Göründü: "${res.found}" (${(res.waited / 1000).toFixed(1)} sn)`);
  if (res.gone) parts.push(`Kayboldu (${(res.waited / 1000).toFixed(1)} sn)`);
  if (res.note) parts.push(res.note);
  if (res.app !== undefined) parts.push(`Önde: ${res.app}${res.window ? ` — ${res.window}` : ''}`);
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
  if (!kayit) throw new JevisError('NOT_ALLOWED', `"${secretName}" adında kayıtlı bir şifre yok.`);
  const el = await resolve(target, 'type', { app });
  if (SHELL_APPS.has(el.bundleId)) throw new JevisError('NOT_ALLOWED', 'Terminale şifre yazılmaz.');
  const uygulama = (await apps()).find(a => String(a.pid) === String(el.pid));
  const adlar = [uygulama?.name, el.bundleId].filter(Boolean).map(x => `app:${String(x).toLowerCase()}`);
  if (!kayit.sites.some(s => adlar.includes(String(s).toLowerCase()))) {
    throw new JevisError('NOT_ALLOWED', `"${secretName}" bu uygulamada kullanılamaz. İzinli olanlar: ${kayit.sites.join(', ') || '(hiçbiri)'}. Bu uygulama: ${adlar.join(' / ')}`);
  }
  const deger = await readSecret(secretName);
  const res = await ax('setvalue', el.path, deger, '--pid', el.pid);
  return { element: { name: el.name, role: el.role }, jev: { confidence: pct(el.pick.confidence), ms: el.pick.ms }, typed: deger.length, method: res.method, note: 'Şifre yazıldı (değer gösterilmez).', ...(await after(el.pid)) };
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
  return `${r.title || '(adsız pencere)'} (${r.w}×${r.h}${fark ? `; istenen ${w}×${h}, uygulama daha küçük/büyük olamıyor` : ''})`;
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
  if (yer === 'kucult') return kucult(app, pencere);
  if (yer === 'geri') return geriGetir(app, pencere);
  // ikiden fazla uygulama: ızgara (3 sütun, 2×2, 3×2...)
  const hepsi = [app, ...(uygulamalar || [])].filter(Boolean);
  if (hepsi.length > 2) return izgara(hepsi, e, liste);
  if (!YERLER[yer]) throw new JevisError('BAD_ARGS', `yer şunlardan biri olmalı: ${Object.keys(YERLER).join(', ')}, kucult, geri`);
  if (hepsi.length === 2 && !ikinci) ikinci = hepsi[1];
  const [, pid] = await appArgs(app);
  const yapilan = [`${app}: ${await pencereYerlestir(pid, pencere, YERLER[ikinci ? 'sol' : yer](e))} → ${ikinci ? 'sol' : yer}`];
  if (ikinci) {
    const [, pid2] = await appArgs(ikinci);
    yapilan.push(`${ikinci}: ${await pencereYerlestir(pid2, '', YERLER.sag(e))} → sağ`);
  }
  return { note: `Yerleştirildi (ekran ${liste.indexOf(e) + 1}/${liste.length}):\n${yapilan.join('\n')}` };
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
    yapilan.push(`${app}: ${await pencereYerlestir(pid, '', [x, y, gw, gh])} → ${(i % sutun) + 1}. sütun, ${Math.floor(i / sutun) + 1}. satır`);
  }
  return { note: `${uygulamalar.length} pencere ${sutun}×${satir} dizildi (ekran ${liste.indexOf(e) + 1}/${liste.length}):\n${yapilan.join('\n')}` };
}

async function kucult(app, pencere) {
  const [, pid] = await appArgs(app);
  await yeriKaydet(pid, pencere);
  const r = await ax('minimize', '--pid', pid, ...(pencere ? ['--title', pencere] : []));
  return { note: `${app}: ${r.title || 'pencere'} Dock'a küçültüldü.` };
}

/** Pencereyi küçültmeden ya da yerleştirmeden önceki yerine ve boyutuna koyar (kayıt yoksa sadece açar) */
async function geriGetir(app, pencere) {
  const [, pid] = await appArgs(app);
  const r = await ax('windows', '--pid', pid);
  const w = r.windows.find(x => !pencere || String(x.title || '').toLocaleLowerCase('tr').includes(String(pencere).toLocaleLowerCase('tr')));
  if (!w) throw new JevisError('NOT_FOUND', `${app} içinde böyle bir pencere yok.`);
  const kayit = (loadState().pencereYerleri || {})[`${r.app}|${w.title || ''}`];
  if (kayit) {
    const s = await ax('setframe', kayit.x, kayit.y, kayit.w, kayit.h, '--pid', pid, ...(w.title ? ['--title', w.title] : []));
    return { note: `${app}: ${s.title || 'pencere'} eski yerine kondu (${s.w}×${s.h}).` };
  }
  await ax('raise', w.index, '--pid', pid);
  return { note: `${app}: ${w.title || 'pencere'} açıldı (eski yeri kayıtlı değildi).` };
}
