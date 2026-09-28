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
import * as jev from '../core/jev.js';
import { needsConfirm, confirmAction } from '../guard/confirm.js';

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
    const { stdout } = await execFileAsync(HELPER, args.map(String), { timeout: 20000, maxBuffer: 20 * 1024 * 1024 });
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
    throw new JevisError('NO_PERMISSION', 'Erişilebilirlik izni yok. Sistem Ayarları › Gizlilik ve Güvenlik › Erişilebilirlik bölümünde JEVIS\'i çalıştıran uygulamayı (Terminal, VS Code ya da JEVIS) aç.');
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
export async function read({ app, menus = false } = {}) {
  await ensureTrusted();
  const tree = await ax('tree', ...(await appArgs(app)), ...(menus ? ['--menus'] : []));
  const elements = tree.elements.map((e, i) => ({ ...e, id: `d${i + 1}`, name: clean(e.name), ctx: clean(e.ctx) }));
  saveState({ desktop: { pid: tree.pid, app: tree.app, window: tree.window, ids: Object.fromEntries(elements.map(e => [e.id, { path: e.path, name: e.name }])) } });
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
    return { path: entry.path, name: entry.name, expect: entry.name, role: '', pid: saved.pid, bundleId: front.bundleId, pick: { confidence: 1, risk, ms: 0 } };
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
      return { path: el.path, name: el.name || el.subrole || el.role, expect: el.name, role: el.role, pid: r.pid, bundleId: r.bundleId, pick };
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
  const ok = await confirmAction(`JEVIS şunu yapmak istiyor:\n\n${actionText}\n\nUygulama: ${app}\nNeden soruluyor: ${verdict.reason}\n\nİzin veriyor musun?`);
  if (!ok) throw new JevisError('DENIED', `Kullanıcı izin vermedi: ${actionText}`);
  return { reason: verdict.reason };
}

async function shellGuard(bundleId, what) {
  if (!SHELL_APPS.has(bundleId)) return;
  const ok = await confirmAction(`JEVIS bir terminale şunu yapmak istiyor:\n\n${what}\n\nTerminale yazılanlar komut olarak çalışabilir. İzin veriyor musun?`);
  if (!ok) throw new JevisError('DENIED', `Kullanıcı terminal işlemine izin vermedi: ${what}`);
}

async function after(pid) {
  await sleep(150);
  const f = await frontmost().catch(() => ({}));
  return { app: f.app, window: f.window, changedApp: f.pid !== pid };
}

export async function click(target, { app } = {}) {
  await ensureTrusted();
  const el = await resolve(target, 'click', { app, withRisk: true });
  const approval = await guard(el, el.pick.risk, `"${el.name}" öğesine basmak`, (await frontmost()).app);
  const res = await ax('press', el.path, '--pid', el.pid, '--expect', el.expect || '');
  return { element: { name: el.name, role: el.role }, jev: { confidence: pct(el.pick.confidence), ms: el.pick.ms }, method: res.method, approval, ...(await after(el.pid)) };
}

/** With a target: fills that field. Without: types into whatever has focus. */
export async function type(target, text, { app, submit = false } = {}) {
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
    throw new JevisError('NOT_FRONT', `${app} öne getirilemedi (önde: ${front.app}); tuş gönderilmedi. Ekranda cevap bekleyen bir sistem sorusu olabilir.`);
  }
  return front;
}

export async function key(combo, { app } = {}) {
  await ensureTrusted();
  const normalized = combo.toLowerCase().replace(/\s+/g, '');
  const front = await ensureFront(app);
  if (DANGEROUS_KEYS.has(normalized)) {
    const ok = await confirmAction(`JEVIS "${front.app}" içinde ${combo} kısayoluna basmak istiyor (uygulama kapanabilir ya da veri silinebilir).\n\nİzin veriyor musun?`);
    if (!ok) throw new JevisError('DENIED', `Kullanıcı izin vermedi: ${combo}`);
  }
  if (['return', 'enter'].includes(normalized)) await shellGuard(front.bundleId, 'Enter\'a basmak (yazılı komut çalışır)');
  await ax('key', combo);
  return { key: combo, ...(await after(front.pid)) };
}

export async function scroll(direction = 'down', amount = 400) {
  await ensureTrusted();
  await ax('scroll', direction === 'up' ? amount : -amount);
  return { scrolled: direction };
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

/** JPEG of the front window (or the whole screen), resized for an LLM. */
export async function screenshot({ app, fullScreen = false } = {}) {
  if (app) await activate(app);
  const f = await frontmost();
  const file = path.join(homeDir('shots'), `desktop-${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`);
  const args = ['-x', '-o', '-t', 'jpg', ...(fullScreen || !f.windowId ? [] : ['-l', String(f.windowId)]), file];
  await execFileAsync('screencapture', args);
  await execFileAsync('sips', ['-Z', '1400', file]).catch(() => {});
  return { path: file, base64: fs.readFileSync(file).toString('base64'), mimeType: 'image/jpeg', app: f.app, window: f.window };
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
  if (res.note) parts.push(res.note);
  if (res.app !== undefined) parts.push(`Önde: ${res.app}${res.window ? ` — ${res.window}` : ''}`);
  return parts.join('\n');
}
