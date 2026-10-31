// Browser hands: drives the user's installed Chrome (with a separate Handry
// profile) through Playwright. Jev decides which element an instruction means;
// risky clicks go through the confirmation dialog first.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { config, expandHome, homeDir, loadState, saveState } from '../core/config.js';
import * as jev from '../core/jev.js';
import { needsConfirm, confirmAction, harmlessByKind, allowedOnSite, rememberable } from '../guard/confirm.js';
import { JevisError } from '../core/errors.js';
import { APP, APP_NAME } from '../core/brand.js';
import { T } from '../core/i18n.js';
import * as human from './human.js';
import * as overlay from './overlay.js';
import * as captcha from './captcha.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const withTimeout = (promise, ms, fallback) => Promise.race([promise, sleep(ms).then(() => fallback)]);
const pct = p => Math.round((p || 0) * 100);
// "1 row", "3 rows" (English only; Turkish has no plural after a number)
const many = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export { JevisError };

// ---------------------------------------------------------------------------
// Chrome connection
// ---------------------------------------------------------------------------

let browser = null;
let current = null;

async function cdpUp(port) {
  try {
    return (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) })).ok;
  } catch {
    return false;
  }
}

/**
 * Main Chrome processes (not helpers) that run on the Handry profile, with or
 * without a debugging port. A second Chrome can't open the same profile: it
 * hands over to the one that runs, so this must be checked before starting.
 */
export function profileChromePids() {
  const dir = expandHome(config().browser.profileDir);
  let listed = '';
  try {
    listed = execFileSync('pgrep', ['-f', '--', `user-data-dir=${dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`], { encoding: 'utf-8' });
  } catch { return []; }
  const pids = listed.split('\n').map(Number).filter(p => p && p !== process.pid);
  if (!pids.length) return [];
  try {
    return execFileSync('ps', ['-o', 'pid=,command=', '-p', pids.join(',')], { encoding: 'utf-8' })
      .split('\n').filter(l => l.trim() && !/ --type=/.test(l)).map(l => Number(l.trim().split(/\s+/)[0]));
  } catch { return []; }
}

/** Starts Chrome with the Handry profile and a local-only debugging port, unless it already runs. */
export async function ensureChrome() {
  const { cdpPort, chromePath, profileDir } = config().browser;
  if (await cdpUp(cdpPort)) return false;
  if (!fs.existsSync(chromePath)) throw new JevisError('NO_CHROME', T(`Chrome bulunamadı: ${chromePath}`, `Chrome not found: ${chromePath}`));
  // The profile is open in a Chrome without the debugging port (a login window)? Give a just-started one a moment.
  if (profileChromePids().length) {
    for (let i = 0; i < 15 && !(await cdpUp(cdpPort)); i++) await sleep(200);
    if (await cdpUp(cdpPort)) return false;
    throw new JevisError('NO_CHROME', T(`${APP_NAME}'nin Chrome profili bağlantısız bir pencerede açık (giriş penceresi olabilir). O pencereyi kapat (Cmd+Q); ya da login_window açıksa orada "Tamam"a bas.`,
      `${APP_NAME}'s Chrome profile is open in a window with nothing attached (maybe a login window). Quit that window (Cmd+Q), or if login_window is open, press "OK" there.`));
  }
  const dir = expandHome(profileDir);
  fs.mkdirSync(dir, { recursive: true });
  const child = spawn(chromePath, [
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${dir}`,
    '--no-first-run',
    '--no-default-browser-check'
  ], { detached: true, stdio: 'ignore' });
  child.unref();
  for (let i = 0; i < 75; i++) {
    await sleep(200);
    if (await cdpUp(cdpPort)) return true;
  }
  throw new JevisError('NO_CHROME', T('Chrome açıldı ama bağlantı noktası hazır olmadı.', 'Chrome opened but its debugging port did not get ready.'));
}

/** Is the Handry Chrome up with its debugging port? */
export const chromeConnectable = () => cdpUp(config().browser.cdpPort);

/**
 * Quits the Handry Chrome the clean way (Chrome saves cookies on a normal exit).
 * Only this profile's Chrome: the user's own Chrome is never touched.
 */
export async function closeChrome() {
  const { cdpPort } = config().browser;
  if (await cdpUp(cdpPort)) {
    try {
      await connect();
      await (await browser.newBrowserCDPSession()).send('Browser.close').catch(() => {});
    } catch {}
  }
  browser = null;
  current = null;
  for (let i = 0; i < 100; i++) {
    if (!(await cdpUp(cdpPort)) && !profileChromePids().length) return true;
    await sleep(200);
  }
  return false;
}

/** Opens the Handry profile as an ordinary Chrome window: no debugging port, nothing attached to it. */
export async function launchPlainChrome(url) {
  const { chromePath, profileDir } = config().browser;
  if (!fs.existsSync(chromePath)) throw new JevisError('NO_CHROME', T(`Chrome bulunamadı: ${chromePath}`, `Chrome not found: ${chromePath}`));
  if (profileChromePids().length) throw new JevisError('PROFILE_BUSY', T(`${APP_NAME}'nin Chrome profili zaten açık.`, `${APP_NAME}'s Chrome profile is already open.`));
  const dir = expandHome(profileDir);
  fs.mkdirSync(dir, { recursive: true });
  spawn(chromePath, [`--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check', url], { detached: true, stdio: 'ignore' }).unref();
  for (let i = 0; i < 50; i++) {
    await sleep(200);
    if (profileChromePids().length) return true;
  }
  throw new JevisError('NO_CHROME', T('Chrome açılamadı.', 'Chrome could not be opened.'));
}

/** Quits the plain (login) Chrome of the Handry profile with a normal quit signal; never a hard kill, that could lose the login. */
export async function closePlainChrome() {
  for (const pid of profileChromePids()) { try { process.kill(pid, 'SIGTERM'); } catch {} }
  for (let i = 0; i < 100; i++) {
    if (!profileChromePids().length) return true;
    await sleep(200);
  }
  return false;
}

/** Runs fn on a fresh tab that is closed afterwards; the tab the user works on stays as it is. */
export async function withTempPage(url, fn, { timeout = 25000 } = {}) {
  await connect();
  const page = await context().newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    return await fn(page);
  } finally {
    await page.close().catch(() => {});
  }
}

// On macOS Chrome keeps running after its last window is closed, and with no
// window there is no browser context to attach to: open an empty one first.
async function ensureWindow(port) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json().catch(() => []);
  if (!targets.some(t => t.type === 'page')) {
    await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
    await sleep(300);
  }
}

async function connect() {
  if (browser?.isConnected()) return browser;
  await ensureChrome();
  const { cdpPort } = config().browser;
  await ensureWindow(cdpPort);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
  browser.on('disconnected', () => { browser = null; current = null; });
  return browser;
}

const context = () => browser.contexts()[0];

// The Handry chat page itself is never a page to work on. The app server
// exports its real port in JEVIS_UI_PORT (inherited by brains and MCP).
const isJevisUi = url => {
  const ports = new Set([String(config().server?.port || 4263), process.env.JEVIS_UI_PORT].filter(Boolean));
  const m = String(url).match(/^http:\/\/(?:127\.0\.0\.1|localhost):(\d+)\//);
  return Boolean(m && ports.has(m[1]));
};
const openPages = () => context().pages().filter(p => !p.isClosed() && !isJevisUi(p.url()));

async function targetIdOf(page) {
  const session = await context().newCDPSession(page);
  try {
    return (await session.send('Target.getTargetInfo')).targetInfo.targetId;
  } finally {
    session.detach().catch(() => {});
  }
}

async function remember(page) {
  current = page;
  try { saveState({ tab: await targetIdOf(page) }); } catch {}
  return page;
}

/** The tab Handry works on: the one the user is looking at, else the last one used. */
export async function activePage() {
  await connect();
  const pages = openPages();
  if (!pages.length) return remember(await context().newPage());
  const visible = [];
  for (const p of pages) {
    const isVisible = await withTimeout(p.evaluate(() => document.visibilityState === 'visible').catch(() => false), 700, false);
    if (isVisible) visible.push(p);
  }
  if (current && !current.isClosed() && (visible.length === 0 || visible.includes(current))) return current;
  // Several windows each show a tab: prefer the one Handry used last.
  const savedId = loadState().tab;
  let saved = null;
  if (savedId) {
    for (const p of pages) {
      if (await targetIdOf(p).catch(() => null) === savedId) { saved = p; break; }
    }
  }
  if (visible.length === 1) return remember(visible[0]);
  if (visible.length > 1) return remember(saved && visible.includes(saved) ? saved : visible[visible.length - 1]);
  return remember(saved || pages[pages.length - 1]);
}

// ---------------------------------------------------------------------------
// Reading the page (these functions run inside the page)
// ---------------------------------------------------------------------------

function snapshotInFrame({ prefix, max, words }) {
  const INTERACTIVE = 'a[href], button, input, select, textarea, summary, [role=button], [role=link], [role=tab], [role=menuitem], [role=menuitemcheckbox], [role=menuitemradio], [role=option], [role=checkbox], [role=radio], [role=switch], [role=combobox], [role=textbox], [role=searchbox], [role=spinbutton], [role=slider], [role=treeitem], [contenteditable=""], [contenteditable="true"], [onclick], [tabindex]:not([tabindex="-1"])';
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

  document.querySelectorAll('[data-jevis-p]').forEach(el => el.removeAttribute('data-jevis-p'));

  const isVisible = el => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') return false;
    // A native <select> is often made see-through and laid over a styled box
    // (GoDaddy and many others): the box is what people see and click.
    return el.tagName === 'SELECT' || Number(cs.opacity) > 0.05;
  };
  // Visible text of an element without the option lists of <select>s inside it.
  const textOf = el => {
    let t = el.innerText || el.textContent || '';
    for (const s of el.querySelectorAll('select')) {
      const own = s.innerText || s.textContent || '';
      if (own) t = t.replace(own, ' ');
    }
    return clean(t);
  };

  const roleOf = el => {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return 'link';
    if (tag === 'button' || tag === 'summary') return 'button';
    if (tag === 'select') return 'select';
    if (tag === 'textarea') return 'textarea';
    if (tag === 'input') {
      const t = (el.getAttribute('type') || 'text').toLowerCase();
      if (['button', 'submit', 'reset', 'image'].includes(t)) return 'button';
      if (['checkbox', 'radio', 'file', 'range', 'color', 'date'].includes(t)) return t;
      return t === 'text' ? 'textbox' : `textbox(${t})`;
    }
    if (el.isContentEditable) return 'textbox';
    if (tag === 'label' && el.control && ['checkbox', 'radio'].includes(el.control.type)) return el.control.type;
    return 'clickable';
  };

  const nameOf = el => {
    const aria = clean(el.getAttribute('aria-label'));
    if (aria) return aria;
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const t = clean(labelledBy.split(/\s+/).map(id => document.getElementById(id)?.innerText || '').join(' '));
      if (t) return t;
    }
    if (el.labels?.length) {
      const t = clean([...el.labels].map(l => l.innerText).join(' '));
      if (t) return t;
    }
    const tag = el.tagName;
    if (tag === 'INPUT' && ['button', 'submit', 'reset'].includes(el.type)) return clean(el.value);
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      return clean(el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('name') || el.id || '');
    }
    const text = textOf(el);
    if (text) return text;
    const direkt = clean(el.getAttribute('title') || el.querySelector('img[alt]')?.alt || el.querySelector('svg title')?.textContent || el.getAttribute('name') || '');
    return direkt || simgeIpucu(el);
  };

  // Yazısız simge düğmeleri (×, çöp kutusu, kalem...): sitelerin bıraktığı ipuçlarından bir ad.
  // Jev "x remove icon" gibi tarifleri bu adla bulur.
  const SIMGE = /^(close|remove|delete|trash|bin|edit|pencil|plus|add|minus|search|settings|gear|cog|menu|hamburger|more|kebab|ellipsis|dots|share|upload|download|play|pause|next|prev|back|forward|arrow|chevron|caret|expand|collapse|heart|like|star|bookmark|copy|clipboard|link|dismiss|cancel|check|tick|info|help|filter|sort|refresh|reload|camera|image|photo|attach|paperclip|send|mic|bell|notification|user|profile|home|calendar|x-?mark|\btimes\b|cross)$/i;
  const simgeIpucu = el => {
    const parcalar = [];
    for (const a of ['data-testid', 'data-test', 'data-qa', 'data-tooltip', 'data-tip', 'data-original-title', 'data-title', 'data-icon', 'aria-description']) {
      const v = clean(el.getAttribute(a) || el.querySelector(`[${a}]`)?.getAttribute(a) || '');
      if (v) parcalar.push(v);
    }
    const tarif = el.getAttribute('aria-describedby');
    if (tarif) parcalar.push(clean(tarif.split(/\s+/).map(id => document.getElementById(id)?.innerText || '').join(' ')));
    const use = el.querySelector('use');
    const href = use?.getAttribute('href') || use?.getAttribute('xlink:href') || '';
    if (href) parcalar.push(href.replace(/^.*#/, ''));
    const siniflar = [el, ...el.querySelectorAll('svg, i, span, img')].slice(0, 6).flatMap(x => String(x.getAttribute('class') || '').split(/\s+/)).filter(c => c.split(/[-_:.]+/).some(t => SIMGE.test(t)));
    parcalar.push(...siniflar.slice(0, 3));
    const ipucu = [...new Set(parcalar.map(p => p.replace(/[-_]+/g, ' ').trim()).filter(Boolean))].join(', ');
    if (ipucu) return cut(`${words.icon}: ${ipucu}`, 80);
    // hiçbir ipucu yoksa en azından ne olduğu: içinde sadece simge (svg/img) olan bir düğme
    return el.querySelector('svg, img, i') ? words.iconOnly : '';
  };

  // Plain text near the element that tells same-named controls apart
  // ("Age Rating … Edit"). Text of other controls and their labels is left
  // out, otherwise every nav link would carry the names of all the others.
  const plainTextIn = (root, self) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        for (let p = node.parentElement; p; p = p.parentElement) {
          if (p === self || picked.has(p) || ['LABEL', 'OPTION', 'SCRIPT', 'STYLE'].includes(p.tagName)) return NodeFilter.FILTER_REJECT;
          if (p === root) break;
        }
        return node.parentElement.checkVisibility() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    let out = '';
    while (out.length < 120 && walker.nextNode()) out += ` ${walker.currentNode.nodeValue}`;
    return clean(out);
  };
  const contextOf = el => {
    let a = el.parentElement;
    for (let depth = 0; a && depth < 4; depth++, a = a.parentElement) {
      // Stop at big containers (a whole form or page section): their text is not about this element.
      if ((a.textContent || '').length > 600 || a.querySelectorAll('[data-jevis-p]').length > 4) break;
      const t = plainTextIn(a, el);
      if (t) return cut(t, 60);
    }
    return '';
  };

  const stateOf = el => {
    const s = [];
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') s.push('disabled');
    const box = el.tagName === 'LABEL' ? el.control : el;
    if (box?.tagName === 'INPUT' && (box.type === 'checkbox' || box.type === 'radio')) s.push(box.checked ? 'checked' : 'unchecked');
    const ariaChecked = el.getAttribute('aria-checked');
    if (ariaChecked !== null) s.push(ariaChecked === 'true' ? 'checked' : 'unchecked');
    const expanded = el.getAttribute('aria-expanded');
    if (expanded !== null) s.push(expanded === 'true' ? 'expanded' : 'collapsed');
    const popup = el.getAttribute('aria-haspopup');
    if (popup && popup !== 'false') s.push('opens a list');
    if (el.getAttribute('aria-selected') === 'true') s.push('selected');
    if (el.getAttribute('aria-invalid') === 'true') s.push('invalid');
    if (el.tagName === 'SELECT') s.push(`value: ${cut(clean(el.selectedOptions?.[0]?.text), 40)}`);
    else if ((el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'image'].includes(el.type)) || el.tagName === 'TEXTAREA') {
      const v = el.type === 'password' ? (el.value ? '••••' : '') : clean(el.value);
      s.push(v ? `value: "${cut(v, 40)}"` : 'empty');
    }
    if (el.tagName === 'INPUT' && el.type === 'file') s.push(el.files?.length ? `${el.files.length} file chosen` : 'no file');
    return s;
  };

  const picked = new Set();
  const list = [];
  const selects = [...document.querySelectorAll('select')].filter(isVisible);
  for (const el of document.querySelectorAll(INTERACTIVE)) {
    if (el.tagName === 'INPUT' && el.type === 'hidden') continue;
    // The styled box around a select: the select stands for it (role, label, value).
    if (el.tagName !== 'SELECT' && selects.some(sel => el.contains(sel)) && textOf(el).length < 40) continue;
    const isFile = el.tagName === 'INPUT' && el.type === 'file';
    if (!isFile && !isVisible(el)) continue; // file inputs are often hidden behind a styled button
    picked.add(el);
    list.push(el);
    el.setAttribute('data-jevis-p', '');
  }

  // React-style click handlers leave no attribute; the pointer cursor gives them away.
  let checked = 0;
  for (const el of document.querySelectorAll('div, span, li, img, svg, label, td, p, h1, h2, h3, h4')) {
    if (++checked > 4000) break;
    if (picked.has(el) || getComputedStyle(el).cursor !== 'pointer') continue;
    if (el.tagName === 'LABEL' && el.control && picked.has(el.control)) continue; // same control twice
    if (el.parentElement && getComputedStyle(el.parentElement).cursor === 'pointer') continue; // outermost only
    let inside = false;
    for (let a = el.parentElement; a && !inside; a = a.parentElement) inside = picked.has(a);
    if (inside || [...el.querySelectorAll(INTERACTIVE)].some(c => picked.has(c))) continue;
    if (!isVisible(el)) continue;
    picked.add(el);
    list.push(el);
    el.setAttribute('data-jevis-p', '');
  }

  const vw = innerWidth;
  const vh = innerHeight;
  const items = [];
  for (const el of list) {
    // A hidden file input is shown through its label; use the label's position.
    const shownBy = el.tagName === 'INPUT' && el.type === 'file' && el.labels?.[0] ? el.labels[0] : el;
    const r = shownBy.getBoundingClientRect();
    const role = roleOf(el);
    const name = cut(nameOf(el), 80);
    if (!name && role === 'clickable') continue;
    const inView = r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw;
    items.push({ el, role, name, ctx: contextOf(el), state: stateOf(el), inView });
  }

  const ordered = [...items.filter(i => i.inView), ...items.filter(i => !i.inView)].slice(0, max);
  // An element keeps its #id as long as it stays on the page, so ids from an
  // earlier read still mean the same thing after a failed action. Frames get
  // a prefix of their own once, so their ids never collide.
  if (window.__jevisPrefix === undefined) window.__jevisPrefix = prefix ? `f${Math.random().toString(36).slice(2, 5)}-` : '';
  window.__jevisNext = window.__jevisNext || 0;
  const keep = new Set();
  const out = ordered.map(it => {
    let id = it.el.getAttribute('data-jevis-id');
    if (!id) {
      id = `${window.__jevisPrefix}${++window.__jevisNext}`;
      it.el.setAttribute('data-jevis-id', id);
    }
    keep.add(it.el);
    return { id, role: it.role, name: it.name, ctx: it.ctx, state: it.state, inView: it.inView };
  });
  document.querySelectorAll('[data-jevis-id]').forEach(el => { if (!keep.has(el)) el.removeAttribute('data-jevis-id'); });
  return { total: items.length, items: out };
}

// Tables on the page as rows of cells: <table>s, ARIA tables and grids, and
// lists drawn with <div>s whose rows look alike (GoDaddy's DNS records).
function tablesInFrame(maxRows) {
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const visible = el => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2 && getComputedStyle(el).visibility !== 'hidden'; };
  const labelOf = el => {
    const own = clean(el.getAttribute('aria-label') || el.querySelector('caption')?.innerText || '');
    if (own) return own;
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      for (let p = a.previousElementSibling; p; p = p.previousElementSibling) {
        const h = p.matches('h1,h2,h3,h4,h5,h6,[role=heading]') ? p : p.querySelector('h1,h2,h3,h4,h5,h6,[role=heading]');
        if (h && clean(h.innerText)) return clean(h.innerText).slice(0, 80);
      }
    }
    return '';
  };
  const out = [];
  const seen = new Set();
  const add = (el, kind, headers, rows) => {
    if (rows.length < 1 || seen.has(el)) return;
    seen.add(el);
    out.push({ kind, label: labelOf(el), headers, rows: rows.slice(0, maxRows), total: rows.length });
  };
  for (const t of document.querySelectorAll('table')) {
    if (!visible(t)) continue;
    const trs = [...t.rows];
    const headRow = t.tHead?.rows[0] || (trs[0] && [...trs[0].cells].every(c => c.tagName === 'TH') ? trs[0] : null);
    const headers = headRow ? [...headRow.cells].map(c => clean(c.innerText)) : [];
    const body = trs.filter(r => r !== headRow && visible(r)).map(r => [...r.cells].map(c => clean(c.innerText).slice(0, 200)));
    add(t, 'table', headers, body.filter(r => r.some(Boolean)));
  }
  for (const g of document.querySelectorAll('[role=table], [role=grid], [role=treegrid]')) {
    if (!visible(g) || g.tagName === 'TABLE') continue;
    const rows = [...g.querySelectorAll('[role=row]')].filter(visible);
    const headRow = rows.find(r => r.querySelector('[role=columnheader]'));
    const headers = headRow ? [...headRow.querySelectorAll('[role=columnheader]')].map(c => clean(c.innerText)) : [];
    const body = rows.filter(r => r !== headRow).map(r => [...r.querySelectorAll('[role=cell], [role=gridcell], [role=rowheader]')].map(c => clean(c.innerText).slice(0, 200)));
    add(g, 'grid', headers, body.filter(r => r.some(Boolean)));
  }
  // <div> lists: at least 3 siblings that look alike, each with 2+ texts.
  let looked = 0;
  for (const box of document.querySelectorAll('div, ul, section, tbody')) {
    if (++looked > 3000) break;
    if (seen.has(box) || box.closest('table, [role=table], [role=grid]') || !visible(box)) continue;
    const kids = [...box.children].filter(visible);
    if (kids.length < 3) continue;
    const sig = k => `${k.tagName}.${[...k.classList].sort().join('.')}`;
    const common = sig(kids[1]);
    const same = kids.filter(k => sig(k) === common);
    if (same.length < 3 || same.length < kids.length * 0.6) continue;
    const cellsOf = k => [...k.children].filter(visible).map(c => clean(c.innerText).slice(0, 200)).filter(Boolean);
    const rows = same.map(cellsOf);
    const width = rows[0]?.length || 0;
    if (width < 2 || rows.filter(r => r.length === width).length < rows.length * 0.7) continue;
    if ([...box.querySelectorAll('*')].some(d => seen.has(d))) continue;
    const before = box.children[0] !== same[0] ? cellsOf(box.children[0]) : [];
    add(box, 'list', before.length === width ? before : [], rows);
  }
  return out;
}

function pageTextInFrame({ max: maxChars, more }) {
  const text = (document.body?.innerText || '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n… (${text.length - maxChars} ${more})` : text;
}
const textArgs = max => ({ max, more: T('karakter daha', 'more characters') });

function alertsInFrame(invalid) {
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const out = [];
  for (const el of document.querySelectorAll('[role=alert], [role=alertdialog], [aria-live=assertive]')) {
    const r = el.getBoundingClientRect();
    const t = clean(el.innerText);
    if (t && r.width > 0 && r.height > 0 && !out.includes(t)) out.push(t.slice(0, 160));
  }
  for (const el of document.querySelectorAll('[aria-invalid=true]')) {
    const name = clean(el.getAttribute('aria-label') || el.labels?.[0]?.innerText || el.name || el.id);
    if (name) out.push(`${invalid}: ${name.slice(0, 60)}`);
  }
  return out.slice(0, 6);
}

function focusedInFrame() {
  const el = document.activeElement;
  if (!el || el === document.body) return '';
  return (el.getAttribute('aria-label') || el.labels?.[0]?.innerText || el.getAttribute('placeholder') || el.name || el.tagName).replace(/\s+/g, ' ').trim().slice(0, 60);
}

async function framesOf(page) {
  const main = page.mainFrame();
  const out = [main];
  for (const frame of page.frames()) {
    if (frame === main || out.length >= 8) continue;
    const box = await frame.frameElement().then(e => e.boundingBox()).catch(() => null);
    if (box && box.width >= 20 && box.height >= 20) out.push(frame);
  }
  return out;
}

async function snapshot(page) {
  const { maxElements } = config().browser;
  const items = [];
  let total = 0;
  const frames = await framesOf(page);
  for (let fi = 0; fi < frames.length && items.length < maxElements; fi++) {
    const res = await withTimeout(
      frames[fi].evaluate(snapshotInFrame, { prefix: fi === 0 ? '' : `f${fi}-`, max: maxElements - items.length, words: { icon: T('simge', 'icon'), iconOnly: T('simge (yazısız)', 'icon (no text)') } }).catch(() => null),
      5000, null
    );
    if (res) {
      items.push(...res.items);
      total += res.total;
    }
  }
  return { url: page.url(), title: await page.title().catch(() => ''), items, total };
}

export function labelOf(item) {
  const state = item.inView ? item.state : [...item.state, 'offscreen'];
  return `[${item.role}] ${item.name || T('(isimsiz)', '(unnamed)')}${item.ctx ? ` — ${item.ctx}` : ''}${state.length ? ` {${state.join(', ')}}` : ''}`;
}

async function locate(page, id) {
  for (const frame of page.frames()) {
    const loc = frame.locator(`[data-jevis-id="${id}"]`);
    if (await loc.count().catch(() => 0)) return loc.first();
  }
  return null;
}

// ---------------------------------------------------------------------------
// Resolving "what does the instruction mean" with Jev
// ---------------------------------------------------------------------------

const PURPOSE = {
  click: t => `Click: ${t}`,
  option: t => `Choose this option in the open list/menu: ${t}`,
  type: t => `Type text into: ${t}`,
  select: t => `Choose a value in the dropdown/select: ${t} (a dropdown usually shows its current value, with the field's name next to it as nearby text)`,
  check: t => `Tick or untick the checkbox/switch/radio: ${t} (a radio button is named by its answer, with its question as the nearby text)`,
  upload: t => `Upload a file using: ${t}`,
  secret: t => `Enter the password/secret into: ${t}`
};

const pickInfo = pick => ({ confidence: pct(pick.confidence), ms: pick.ms, risk: pick.risk === null ? null : pct(pick.risk) });
const OPTION_ROLES = ['option', 'menuitem', 'menuitemradio', 'menuitemcheckbox'];

/**
 * The entries of the list that was just opened, not every same-named thing
 * on the page (a side menu's tree items were picked on GoDaddy). In order:
 * inside the list the trigger points to (aria-controls/owns), option-like
 * entries that appeared on opening, option-like entries in a popup,
 * option-like entries on screen, anything new on screen.
 */
async function narrowOptions(page, items, scope = {}) {
  const info = await page.mainFrame().evaluate(({ ids, listId }) => {
    const box = listId ? document.getElementById(listId) : null;
    return ids.map(id => {
      const el = document.querySelector(`[data-jevis-id="${CSS.escape(id)}"]`);
      if (!el) return [id, {}];
      return [id, {
        inBox: Boolean(box && box !== el && box.contains(el)),
        fresh: !el.hasAttribute('data-jevis-before'),
        inPopup: Boolean(el.closest('[role=listbox], [role=menu], [role=dialog], [role=grid], datalist'))
      }];
    });
  }, { ids: items.map(i => i.id), listId: scope.listId || null }).catch(() => []);
  const by = new Map(info);
  const optionLike = i => OPTION_ROLES.includes(i.role);
  const tiers = [
    items.filter(i => by.get(i.id)?.inBox),
    items.filter(i => optionLike(i) && i.inView && by.get(i.id)?.fresh),
    items.filter(i => optionLike(i) && i.inView && by.get(i.id)?.inPopup),
    items.filter(i => optionLike(i) && i.inView),
    scope.opened ? items.filter(i => i.inView && by.get(i.id)?.fresh) : []
  ];
  return tiers.find(t => t.length) || items;
}


/**
 * Turns a target ("Save button", "fiyat alanı" or "#12" from a previous read)
 * into a Playwright locator. Throws LOW_CONFIDENCE with candidates when Jev
 * isn't sure, so the caller can choose by #id instead of guessing.
 */
async function resolve(page, target, purpose, { withRisk = false, scope } = {}) {
  const idMatch = String(target).trim().match(/^#([\w-]+)$/);
  if (idMatch) {
    const loc = await locate(page, idMatch[1]);
    if (!loc) throw new JevisError('STALE', T(`#${idMatch[1]} artık sayfada yok. Önce sayfayı yeniden okuyun (read).`, `#${idMatch[1]} is no longer on the page. Read the page again first (browser_read).`));
    // Same order as the element list: a field is named by its label, not by what's typed in it.
    const name = await loc.evaluate(el => {
      const clean = s => (s || '').replace(/\s+/g, ' ').trim();
      let text = el.innerText || '';
      for (const s of el.querySelectorAll('select')) if (s.innerText) text = text.replace(s.innerText, ' ');
      return (clean(el.getAttribute('aria-label')) || clean([...(el.labels || [])].map(l => l.innerText).join(' '))
        || clean(el.getAttribute('placeholder')) || clean(el.getAttribute('title')) || clean(text)
        || clean(el.getAttribute('name')) || clean(el.id) || clean(el.value)).slice(0, 80);
    });
    const item = { id: idMatch[1], name, role: T('seçilen', 'chosen'), ctx: '', state: [] };
    const risk = withRisk ? (await jev.isRisky(PURPOSE[purpose](name), { url: page.url(), title: await page.title() })).p : null;
    return { loc, item, pick: { confidence: 1, risk, ms: 0 } };
  }

  const snap = await snapshot(page);
  let items = snap.items;
  if (purpose === 'option') items = await narrowOptions(page, items, scope);
  if (!items.length) throw new JevisError('NOT_FOUND', T('Sayfada kullanılabilir öğe bulunamadı.', 'No usable element found on the page.'));
  const labels = items.map(labelOf);
  const pick = await jev.pickElement(PURPOSE[purpose](target), labels, { url: snap.url, title: snap.title }, { withRisk });
  const alternatives = pick.alternatives
    .filter(a => a.index !== null)
    .map(a => ({ id: items[a.index].id, label: labels[a.index], p: pct(a.p) }));

  if (pick.index === null) {
    throw new JevisError('NOT_FOUND', T(`"${target}" ile eşleşen öğe yok (Jev "hiçbiri" dedi, %${pct(pick.confidence)}).`, `No element matches "${target}" (Jev said "none", ${pct(pick.confidence)}%).`), { alternatives });
  }
  if (!jev.isConfident(pick)) {
    throw new JevisError('LOW_CONFIDENCE', T(`Jev "${target}" için emin değil (%${pct(pick.confidence)}). Adaylardan birini #id ile seçin.`, `Jev is not sure about "${target}" (${pct(pick.confidence)}%). Pick one of the candidates by #id.`), { alternatives });
  }
  const item = items[pick.index];
  const loc = await locate(page, item.id);
  if (!loc) throw new JevisError('STALE', T('Öğe seçilirken sayfa değişti, tekrar deneyin.', 'The page changed while the element was being picked; try again.'));
  return { loc, item, pick };
}

/**
 * Asks the user when the action is risky. Returns null (no question needed)
 * or { reason, screenshot } as a record of what was approved.
 */
// What Handry typed, chose or ticked on each page since the last approved
// action, so the approval shows what is about to be saved.
const pendingChanges = new WeakMap();
function noteChange(page, field, value) {
  const list = (pendingChanges.get(page) || []).filter(c => c.field !== field);
  list.push({ field: String(field || '?').slice(0, 40), value: String(value ?? '').replace(/\s+/g, ' ').slice(0, 60) });
  pendingChanges.set(page, list);
}

/**
 * Where an element is on the screen, in global top-left points (what the desktop hands and the drawing
 * layer use): the window's place, the toolbar above the page, and the page zoom are taken into account.
 */
async function rectOf(page, loc) {
  await loc.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
  const box = await loc.boundingBox();
  if (!box) throw new JevisError('NOT_VISIBLE', T('Öğe sayfada görünmüyor.', 'The element is not visible on the page.'));
  const w = await page.evaluate(() => ({ x: window.screenX, y: window.screenY, ow: window.outerWidth, oh: window.outerHeight, iw: window.innerWidth, ih: window.innerHeight }));
  const zoom = w.iw > 0 && w.ow / w.iw > 0.25 && w.ow / w.iw < 5 ? w.ow / w.iw : 1;
  const left = w.x + (w.ow - w.iw * zoom) / 2;
  const top = w.y + (w.oh - w.ih * zoom); // the tabs and the address bar are above the page
  return { x: left + box.x * zoom, y: top + box.y * zoom, w: box.width * zoom, h: box.height * zoom };
}

/** A page element's place on the screen (for screen_draw). The tab is brought to the front first. */
export async function screenRect(target) {
  const page = await activePage();
  await page.bringToFront().catch(() => {});
  const { loc, item } = await resolve(page, target, 'click');
  return { rect: await rectOf(page, loc), name: item.name };
}

async function guardRisk(page, item, riskP, actionText, loc = null) {
  const host = (() => { try { return new URL(page.url()).host; } catch { return ''; } })();
  const verdict = needsConfirm(item, riskP, host);
  if (!verdict.ask) return null;
  const title = await page.title().catch(() => '');
  // geri alınabilir, zararsız işlemler (taslağı kaydet, formdan öğe çıkar) sorulmadan geçer; sayfa bağlamıyla bakılır
  // the text next to the button too: "Delete" under "Delete this project?" is not "Remove" in a draft
  const near = item.ctx ? T(`; yanındaki metin: ${String(item.ctx).slice(0, 300)}`, `; text next to it: ${String(item.ctx).slice(0, 300)}`) : '';
  if (await harmlessByKind(verdict, `${actionText} (${T('sayfa', 'page')}: ${title}, ${page.url()}${near})`)) return null;
  const changes = pendingChanges.get(page) || [];
  const changed = changes.length ? `\n\n${T(`Bu sayfada ${APP.genitive} girdikleri`, `What ${APP_NAME} entered on this page`)}:\n${changes.slice(-12).map(c => `• ${c.field}: ${c.value}`).join('\n')}` : '';
  // kullanıcı bu sitede bu düğmeye "hep" dediyse sorulmaz (para, sipariş ve silme hariç)
  if (allowedOnSite(host, item.name)) {
    pendingChanges.delete(page);
    return { reason: `${verdict.reason} · ${T('bu sitede hep izinli', 'always allowed on this site')}` };
  }
  // while the question is open, the button it is about is circled on the screen (drawn alongside: the question never waits for it)
  const mark = loc && config().overlay?.confirmHighlight !== false
    ? rectOf(page, loc).then(r => overlay.draw({ shape: 'circle', rect: r, note: T('Buna basmak istiyorum', 'I want to press this'), seconds: 900 })).catch(() => null)
    : null;
  const question = T(`${APP_NAME} şunu yapmak istiyor:\n\n${actionText}${changed}\n\nSayfa: ${title}\nNeden soruluyor: ${verdict.reason}\n\nİzin veriyor musun?`,
    `${APP_NAME} wants to do this:\n\n${actionText}${changed}\n\nPage: ${title}\nWhy it asks: ${verdict.reason}\n\nDo you allow it?`);
  const ok = await confirmAction(question, { remember: rememberable(item.name) ? { host, name: item.name } : null });
  const drawn = await mark;
  if (drawn) overlay.clear(drawn);
  if (!ok) throw new JevisError('DENIED', T(`Kullanıcı izin vermedi: ${actionText}`, `The user did not allow it: ${actionText}`));
  pendingChanges.delete(page); // approved: these are being saved now
  const shot = path.join(homeDir('logs', 'approved'), `${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`);
  await page.screenshot({ path: shot, type: 'jpeg', quality: 60, scale: 'css', timeout: 5000 }).catch(() => {});
  return { reason: verdict.reason, screenshot: shot };
}

async function settle(page) {
  await sleep(150);
  await page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
}

async function outcome(page, before) {
  const url = page.url();
  return {
    url,
    title: await page.title().catch(() => ''),
    navigated: url !== before.url,
    alerts: await withTimeout(page.mainFrame().evaluate(alertsInFrame, T('Geçersiz alan', 'Invalid field')).catch(() => []), 1500, [])
  };
}

async function clickLocator(loc) {
  if (human.humanOn(loc.page())) {
    // a hand on the mouse: glide, rest, press; a covered element falls through to the plain click
    try { await human.click(loc); return; } catch {}
  }
  await loc.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
  try {
    await loc.click({ timeout: 4000 });
  } catch {
    await loc.evaluate(el => el.click()); // covered or animating elements
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function toUrl(input) {
  const s = String(input).trim();
  if (/^[a-z][\w+.-]*:\/\//i.test(s) || /^(about|file|data|chrome):/i.test(s)) return s;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?([/?#]\S*)?$/.test(s)) return `https://${s}`;
  return `https://www.google.com/search?q=${encodeURIComponent(s)}`;
}

/** A new Chrome window (not a tab) with this address; it becomes the page Handry works on. */
async function newWindowPage(url) {
  await connect();
  const cdp = await browser.newBrowserCDPSession();
  const waiting = context().waitForEvent('page', { timeout: 10000 }).catch(() => null);
  const { targetId } = await cdp.send('Target.createTarget', { url, newWindow: true });
  await cdp.detach().catch(() => {});
  let page = await waiting;
  if (!page || (await targetIdOf(page).catch(() => null)) !== targetId) {
    for (const p of openPages()) if ((await targetIdOf(p).catch(() => null)) === targetId) page = p;
  }
  if (!page) throw new JevisError('NO_WINDOW', T('Yeni pencere açılamadı.', 'The new window could not be opened.'));
  await page.waitForLoadState('domcontentloaded', { timeout: 45000 }).catch(() => {});
  return remember(page);
}

export async function open(input, { newTab = false, newWindow = false } = {}) {
  if (newWindow) {
    const page = await newWindowPage(toUrl(input));
    await page.bringToFront().catch(() => {});
    return { url: page.url(), title: await page.title().catch(() => '') };
  }
  let page = await activePage();
  if (newTab && page.url() !== 'about:blank') page = await context().newPage();
  await page.goto(toUrl(input), { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.bringToFront().catch(() => {});
  await remember(page);
  return { url: page.url(), title: await page.title().catch(() => '') };
}

// Pages that show whether one is logged in (the home page of most sites is public).
const ACCOUNT_PAGES = {
  'godaddy.com': 'https://account.godaddy.com/products',
  'appstoreconnect.apple.com': 'https://appstoreconnect.apple.com/apps',
  'developer.apple.com': 'https://developer.apple.com/account',
  'firebase.google.com': 'https://console.firebase.google.com/',
  'console.firebase.google.com': 'https://console.firebase.google.com/',
  'play.google.com': 'https://play.google.com/console',
  'mail.google.com': 'https://mail.google.com/mail/',
  'gmail.com': 'https://mail.google.com/mail/',
  'github.com': 'https://github.com/settings/profile',
  'vercel.com': 'https://vercel.com/dashboard',
  'cloudflare.com': 'https://dash.cloudflare.com/'
};
const LOGIN_URL = /(login|signin|sign-in|sso\.|\/auth|accounts\.google\.com|idmsa\.apple\.com|oauth)/i;

/**
 * Is the user logged in to these sites in the Handry Chrome? Looks at the
 * cookies, then (deep) opens each site's account page in a new tab, sees
 * where it lands and what it says, and closes the tab again.
 */
export async function sessions(sites, { deep = true } = {}) {
  await connect();
  const ctx = context();
  const check = async site => {
    const raw = String(site).trim();
    const url = /^https?:\/\//.test(raw) ? raw : ACCOUNT_PAGES[raw.replace(/^www\./, '')] || `https://${raw.replace(/^www\./, '')}/`;
    const host = new URL(url).hostname;
    const base = host.split('.').slice(-2).join('.');
    const cookies = await ctx.cookies([`https://${host}`, `https://${base}`, `https://www.${base}`]).catch(() => []);
    const now = Date.now() / 1000;
    const sessionCookies = cookies.filter(c => /sess|auth|token|login|sid|jwt|remember|sso|account|user|myacinfo|dqsid/i.test(c.name) && (c.expires === -1 || c.expires > now)).length;
    const out = { site: raw, url, host, cookies: cookies.length, sessionCookies };
    if (!deep) return out;
    const page = await ctx.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
      out.finalUrl = page.url();
      out.title = await page.title().catch(() => '');
      out.text = await withTimeout(page.mainFrame().evaluate(pageTextInFrame, textArgs(1500)).catch(() => ''), 3000, '');
      out.loginUrl = LOGIN_URL.test(new URL(out.finalUrl).hostname + new URL(out.finalUrl).pathname);
    } catch (err) {
      out.error = err.message.split('\n')[0];
    } finally {
      await page.close().catch(() => {});
    }
    return out;
  };
  return Promise.all(sites.slice(0, 8).map(check));
}

export async function pageText(maxChars = 1500) {
  const page = await activePage();
  return withTimeout(page.mainFrame().evaluate(pageTextInFrame, textArgs(maxChars)).catch(() => ''), 3000, '');
}

export async function read({ text = true } = {}) {
  const page = await activePage();
  const snap = await snapshot(page);
  const body = text
    ? await withTimeout(page.mainFrame().evaluate(pageTextInFrame, textArgs(config().browser.maxTextChars)).catch(() => ''), 3000, '')
    : '';
  const alerts = await withTimeout(page.mainFrame().evaluate(alertsInFrame, T('Geçersiz alan', 'Invalid field')).catch(() => []), 1500, []);
  return { url: snap.url, title: snap.title, elements: snap.items, total: snap.total, text: body, alerts };
}

export async function click(target, { risk = true, purpose = 'click', scope } = {}) {
  const page = await activePage();
  const before = { url: page.url() };
  const { loc, item, pick } = await resolve(page, target, purpose, { withRisk: risk, scope });
  if (await loc.evaluate(el => el.tagName === 'INPUT' && el.type === 'file')) {
    throw new JevisError('WRONG_TOOL', T('Bu bir dosya seçme alanı; dosya yüklemek için upload kullanın.', 'This is a file field; use upload (browser_upload) to upload a file.'));
  }
  const approval = risk ? await guardRisk(page, item, pick.risk, T(`"${item.name}" öğesine tıklamak`, `click "${item.name}"`), loc) : null;
  // the pointer glides for a while before it presses, so the wait must outlast the glide
  const popup = context().waitForEvent('page', { timeout: 8000 }).catch(() => null);
  await clickLocator(loc);
  const newPage = await withTimeout(popup, 300, null);
  let active = page;
  if (newPage) {
    await newPage.waitForLoadState('domcontentloaded').catch(() => {});
    await newPage.bringToFront().catch(() => {});
    active = await remember(newPage);
  } else {
    await settle(page);
  }
  return { element: item, jev: pickInfo(pick), newTab: Boolean(newPage), approval, ...(await outcome(active, before)) };
}

export async function type(target, text, { submit = false, append = false } = {}) {
  const page = await activePage();
  const before = { url: page.url() };
  const { loc, item, pick } = await resolve(page, target, 'type');
  let approval = null;
  if (submit) {
    const risk = await jev.isRisky(`Type into "${item.name}" and press Enter to submit`, { url: page.url(), title: await page.title() });
    approval = await guardRisk(page, item, risk.p, T(`"${item.name}" alanına yazıp Enter'a basmak (form gönderilebilir)`, `type into "${item.name}" and press Enter (the form may be sent)`));
  }
  await loc.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
  // With human mode on, short text is typed key by key; long text goes in at once.
  const byHand = human.humanOn(page) && [...text].length <= human.maxTypeChars();
  if (byHand && await human.fillField(loc, text, { append }).then(() => true, () => false)) {
    // typed like a person
  } else if (append) {
    await clickLocator(loc);
    await page.keyboard.press('End');
    await page.keyboard.type(text);
  } else {
    try {
      await loc.fill(text, { timeout: 4000 });
    } catch {
      await clickLocator(loc);
      await page.keyboard.press('Meta+A');
      await page.keyboard.type(text);
    }
  }
  noteChange(page, item.name, /password/.test(item.role) || await loc.evaluate(el => el.type === 'password').catch(() => false) ? '••••' : text);
  if (submit) {
    await loc.press('Enter');
    await settle(page);
  }
  return { element: item, jev: pickInfo(pick), typed: text.length, approval, ...(await outcome(page, before)) };
}

/**
 * Clicks a download link or button and puts the file where it belongs
 * (default ~/Downloads/Handry; a folder or a full path, inside the home
 * folder). An existing file is never overwritten: a number is added.
 */
export async function download(target, saveTo) {
  const page = await activePage();
  const { loc, item, pick } = await resolve(page, target, 'click');
  const waiting = page.waitForEvent('download', { timeout: 60000 });
  await clickLocator(loc);
  let dl;
  try { dl = await waiting; } catch { throw new JevisError('NO_DOWNLOAD', T(`"${item.name}" tıklandı ama 60 sn içinde bir indirme başlamadı.`, `Clicked "${item.name}" but no download started within 60 s.`)); }
  const name = dl.suggestedFilename();
  const home = os.homedir();
  const wanted = path.resolve(expandHome(saveTo || `~/Downloads/${APP_NAME}/`));
  if (wanted !== home && !wanted.startsWith(home + path.sep)) throw new JevisError('OUTSIDE_HOME', T('İndirilen dosya sadece ev klasörünün içine kaydedilir.', 'Downloaded files are only saved inside the home folder.'));
  const isDir = /[\\/]$/.test(String(saveTo || '/')) || (fs.existsSync(wanted) && fs.statSync(wanted).isDirectory());
  let dest = isDir ? path.join(wanted, name) : wanted;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  for (let n = 2; fs.existsSync(dest); n++) dest = dest.replace(/( \(\d+\))?(\.[^./]*)?$/, (m, _n, ext = '') => ` (${n})${ext}`);
  await dl.saveAs(dest);
  return { element: item, jev: pickInfo(pick), file: dest, name, size: fs.statSync(dest).size, url: page.url(), title: await page.title().catch(() => '') };
}

/**
 * The page's tables. With `which` (words from its heading, caption or
 * columns) Jev picks the one meant; otherwise the biggest.
 */
export async function tables(which, { maxRows = 60 } = {}) {
  const page = await activePage();
  const found = (await withTimeout(page.mainFrame().evaluate(tablesInFrame, maxRows).catch(() => []), 5000, []))
    .sort((a, b) => b.total - a.total);
  if (!found.length) throw new JevisError('NOT_FOUND', T('Sayfada tablo bulunamadı.', 'No table found on the page.'));
  const describe = t => `${t.label || T('(başlıksız)', '(untitled)')} — ${t.headers.length ? t.headers.join(', ') : `${T('ilk satır', 'first row')}: ${t.rows[0].join(', ')}`} (${T(`${t.total} satır`, many(t.total, 'row'))})`;
  let index = 0;
  if (which && found.length > 1) {
    const pick = await jev.pickOption('table on the page', which, found.map(describe));
    if (pick.index !== null && jev.isConfident(pick)) index = pick.index;
  }
  return { url: page.url(), title: await page.title().catch(() => ''), table: found[index], others: found.filter((_, i) => i !== index).map(describe) };
}

export function formatTable(r) {
  const t = r.table;
  const keys = t.headers.length && t.rows.every(row => row.length <= t.headers.length) ? t.headers : null;
  const lines = [T(`Tablo: ${t.label || '(başlıksız)'} · ${t.total} satır${t.total > t.rows.length ? ` (ilk ${t.rows.length})` : ''}${keys ? '' : t.headers.length ? ` · sütunlar: ${t.headers.join(', ')}` : ''}`,
    `Table: ${t.label || '(untitled)'} · ${many(t.total, 'row')}${t.total > t.rows.length ? ` (first ${t.rows.length})` : ''}${keys ? '' : t.headers.length ? ` · columns: ${t.headers.join(', ')}` : ''}`)];
  for (const row of t.rows) lines.push(JSON.stringify(keys ? Object.fromEntries(keys.map((k, i) => [k || T(`sütun ${i + 1}`, `column ${i + 1}`), row[i] ?? ''])) : row));
  if (r.others.length) lines.push('', `${T('Sayfadaki diğer tablolar', 'Other tables on the page')}: ${r.others.join(' | ')}`);
  return lines.join('\n');
}

// Things on a page that show a value: fields, and texts that look like a key,
// token or ID (code blocks, read-only fields, one long word). Marked with
// data-jevis-v so the chosen one can be read back.
function valueCandidatesInFrame() {
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  document.querySelectorAll('[data-jevis-v]').forEach(e => e.removeAttribute('data-jevis-v'));
  const visible = el => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1 && getComputedStyle(el).visibility !== 'hidden'; };
  const near = el => {
    for (let a = el, d = 0; a && d < 4; a = a.parentElement, d++) {
      // (not the element's own text: that is the value itself)
      const own = d > 0 ? clean([...(a.childNodes || [])].filter(n => n.nodeType === 3).map(n => n.textContent).join(' ')) : '';
      if (own && own.length < 120) return own;
      const prev = a.previousElementSibling;
      if (prev && clean(prev.innerText) && clean(prev.innerText).length < 120) return clean(prev.innerText);
    }
    return '';
  };
  const out = [];
  const add = (el, value) => {
    if (out.length >= 150 || !value) return;
    const id = `v${out.length + 1}`;
    el.setAttribute('data-jevis-v', id);
    const label = clean(el.getAttribute('aria-label') || el.labels?.[0]?.innerText || el.getAttribute('placeholder') || '');
    out.push({ id, label: `[value] ${value.length > 24 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value}${label ? ` — ${label}` : ''}${near(el) ? ` — ${near(el).slice(0, 60)}` : ''}` });
  };
  for (const el of document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]), textarea')) {
    if (visible(el) && el.value) add(el, clean(el.value));
  }
  for (const el of document.querySelectorAll('code, pre, kbd, samp, [data-copy], [data-clipboard-text], td, span, div, p, dd')) {
    if (!visible(el) || el.children.length > 0) continue;
    const t = clean(el.innerText);
    if (el.matches('code, pre, kbd, samp, [data-copy], [data-clipboard-text]') ? t.length >= 4 : /^[\w\-.:/+=]{12,}$/.test(t)) add(el, t);
  }
  return out;
}

/** The value a field or text on the page shows (an API key, a token, an ID). */
export async function valueAt(target) {
  const page = await activePage();
  const candidates = await page.mainFrame().evaluate(valueCandidatesInFrame).catch(() => []);
  if (!candidates.length) throw new JevisError('NOT_FOUND', T('Sayfada okunacak bir değer (alan, kod, anahtar) bulunamadı.', 'No value to read (a field, a code, a key) found on the page.'));
  const pick = await jev.pickElement(`Read the value of: ${target}`, candidates.map(c => c.label), { url: page.url(), title: await page.title().catch(() => '') });
  if (pick.index === null || !jev.isConfident(pick)) {
    const alternatives = pick.alternatives.filter(a => a.index !== null).map(a => ({ id: candidates[a.index].id, label: candidates[a.index].label, p: pct(a.p) }));
    throw new JevisError(pick.index === null ? 'NOT_FOUND' : 'LOW_CONFIDENCE', T(`"${target}" değeri sayfada bulunamadı ya da Jev emin değil (%${pct(pick.confidence)}).`, `The value "${target}" was not found on the page, or Jev is not sure (${pct(pick.confidence)}%).`), { alternatives });
  }
  const chosen = candidates[pick.index];
  const value = await page.mainFrame().evaluate(id => {
    const el = document.querySelector(`[data-jevis-v="${id}"]`);
    const raw = el ? (('value' in el && typeof el.value === 'string' && el.value) || el.getAttribute('data-clipboard-text') || el.getAttribute('data-copy') || el.innerText || '') : '';
    return raw.trim();
  }, chosen.id);
  return { element: { name: chosen.label }, value, host: new URL(page.url()).host };
}

const TEXT_ROLES = /^(textbox|textarea|searchbox|combobox|spinbutton)/;
const CHOICE_ROLES = ['radio', 'option', 'menuitemradio', 'tab'];
const TOGGLE_ROLES = ['checkbox', 'switch', 'menuitemcheckbox'];
const YES = /^(evet|açık|acik|true|on|yes|işaretle|isaretle|seçili|secili|var|✓|x|1)$/i;
const NO = /^(hayır|hayir|kapalı|kapali|false|off|no|kaldır|kaldir|yok|0)$/i;
const valueOf = item => {
  const v = item.state.find(x => x.startsWith('value:'));
  if (v) return v.replace(/^value:\s*/, '').replace(/^"|"$/g, '');
  if (item.state.includes('checked')) return '✓';
  if (item.state.includes('unchecked')) return '—';
  if (item.state.includes('empty')) return '';
  return item.name;
};

/**
 * Fills many fields in one go. fields: { "Name": "Ornek", "Price": "Free",
 * "Cartoon or Fantasy Violence": "None", "Sign-in required": "evet" }. Jev
 * matches every field at once (in parallel), then each is filled the way its
 * control needs. Nothing is saved or submitted. Returns a row per field.
 */
export async function fill(fields) {
  const page = await activePage();
  const snap = await snapshot(page);
  const items = snap.items.filter(i => i.role !== 'link');
  if (!items.length) throw new JevisError('NOT_FOUND', T('Sayfada doldurulacak alan bulunamadı.', 'No field to fill found on the page.'));
  const labels = items.map(labelOf);
  const entries = Object.entries(fields).map(([field, value]) => [field, String(value)]);

  // Jev looks for every field at the same time (a few requests at once).
  const picks = new Array(entries.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(5, entries.length) }, async () => {
    while (next < entries.length) {
      const i = next++;
      const [field, value] = entries[i];
      const instruction = `Set the form field "${field}" to "${value}": pick the text field or dropdown for "${field}", or, when "${field}" is answered with radio buttons or checkboxes, the one for "${value}"`;
      picks[i] = await jev.pickElement(instruction, labels, { url: snap.url, title: snap.title }).catch(err => ({ index: null, confidence: 0, alternatives: [], error: err.message }));
    }
  }));

  const rows = [];
  const used = new Set();
  for (let i = 0; i < entries.length; i++) {
    const [field, value] = entries[i];
    const pick = picks[i];
    const row = { field, value, ok: false };
    rows.push(row);
    if (pick.index === null || !jev.isConfident(pick)) {
      row.problem = pick.error || (pick.index === null ? T('bulunamadı', 'not found') : T(`Jev emin değil (%${pct(pick.confidence)})`, `Jev is not sure (${pct(pick.confidence)}%)`));
      row.candidates = pick.alternatives.filter(a => a.index !== null).map(a => `#${items[a.index].id} ${labels[a.index]}`);
      continue;
    }
    const item = items[pick.index];
    Object.assign(row, { id: item.id, label: labels[pick.index], before: valueOf(item) });
    if (used.has(item.id) && !CHOICE_ROLES.includes(item.role)) { row.problem = T('bu öğe başka bir alan için zaten dolduruldu', 'this element was already filled for another field'); continue; }
    used.add(item.id);
    try {
      if (item.role === 'select' || item.state.includes('opens a list')) {
        const r = await select(`#${item.id}`, value);
        row.after = r.selected;
      } else if (TEXT_ROLES.test(item.role)) {
        await type(`#${item.id}`, value);
        row.after = value;
      } else if (CHOICE_ROLES.includes(item.role)) {
        if (!item.state.includes('checked') && !item.state.includes('selected')) await click(`#${item.id}`, { risk: false });
        noteChange(page, field, item.name);
        row.after = item.name;
      } else if (TOGGLE_ROLES.includes(item.role) || item.role === 'label') {
        const on = NO.test(value.trim()) ? false : YES.test(value.trim()) || true;
        const r = await check(`#${item.id}`, on);
        row.after = r.checked === null ? '?' : r.checked ? '✓' : '—';
      } else {
        row.problem = T(`bu bir ${item.role}; doldurulacak bir alan değil (Kaydet gibi düğmelere browser_click ile bas)`, `this is a ${item.role}, not a field to fill (press buttons like Save with browser_click)`);
        continue;
      }
      row.ok = true;
    } catch (err) {
      row.problem = err.message.split('\n')[0];
    }
  }
  return { url: page.url(), title: await page.title().catch(() => ''), rows };
}

export function formatFill(r) {
  const lines = [T(`${r.rows.filter(x => x.ok).length}/${r.rows.length} alan dolduruldu (kaydedilmedi):`, `${r.rows.filter(x => x.ok).length}/${r.rows.length} fields filled (not saved):`)];
  for (const x of r.rows) {
    if (x.ok) lines.push(`✓ ${x.field}: "${x.before}" → "${x.after}"  (#${x.id})`);
    else {
      lines.push(`✗ ${x.field} = "${x.value}": ${x.problem}${x.id ? ` (#${x.id})` : ''}`);
      if (x.candidates?.length) lines.push(`    ${T('adaylar', 'candidates')}: ${x.candidates.join(' | ')}`);
    }
  }
  return lines.join('\n');
}

/** Fills a field with a value the caller must never see (passwords). */
export async function fillHidden(target, value) {
  const page = await activePage();
  const { loc, item, pick } = await resolve(page, target, 'secret');
  await loc.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
  const byHand = human.humanOn(page) && [...value].length <= human.maxTypeChars();
  if (!(byHand && await human.fillField(loc, value).then(() => true, () => false))) await loc.fill(value, { timeout: 4000 });
  noteChange(page, item.name, '••••');
  return { element: item, jev: pickInfo(pick), host: new URL(page.url()).host };
}

export async function currentHost() {
  const page = await activePage();
  try { return new URL(page.url()).host; } catch { return ''; }
}

export async function select(target, option) {
  const page = await activePage();
  const before = { url: page.url() };
  const { loc, item, pick } = await resolve(page, target, 'select');
  // The target may be a styled box with the real <select> inside it.
  const native = (await loc.evaluateHandle(el => (el.tagName === 'SELECT' ? el : el.querySelector('select')))).asElement();
  if (native) {
    const options = await native.evaluate(el => [...el.options].map(o => o.text.replace(/\s+/g, ' ').trim()));
    let index = options.findIndex(o => o.toLowerCase() === String(option).toLowerCase());
    if (index < 0) {
      const optPick = await jev.pickOption(item.name, option, options);
      if (optPick.index === null || !jev.isConfident(optPick)) {
        throw new JevisError('NOT_FOUND', T(`"${option}" seçeneği bulunamadı. Seçenekler: ${options.slice(0, 40).join(' | ')}`, `Option "${option}" not found. Options: ${options.slice(0, 40).join(' | ')}`));
      }
      index = optPick.index;
    }
    await native.selectOption({ index }, { force: true });
    noteChange(page, item.name, options[index]);
    return { element: item, jev: pickInfo(pick), selected: options[index], ...(await outcome(page, before)) };
  }
  // Custom dropdown: open it, then pick the option among the list's entries.
  // The commit (Save/Done) is where the risk check belongs, not the option.
  const listId = await loc.evaluate(el => el.getAttribute('aria-controls') || el.getAttribute('aria-owns')
    || el.querySelector('[aria-controls]')?.getAttribute('aria-controls') || '').catch(() => '');
  await page.mainFrame().evaluate(() => {
    document.querySelectorAll('[data-jevis-before]').forEach(e => e.removeAttribute('data-jevis-before'));
    document.querySelectorAll('[data-jevis-p]').forEach(e => e.setAttribute('data-jevis-before', ''));
  }).catch(() => {});
  await clickLocator(loc);
  await sleep(300);
  const chosen = await click(option, { risk: false, purpose: 'option', scope: { listId, opened: true } });
  noteChange(page, item.name, chosen.element.name);
  return { element: item, jev: pickInfo(pick), selected: chosen.element.name, ...(await outcome(await activePage(), before)) };
}

export async function check(target, on = true) {
  const page = await activePage();
  const before = { url: page.url() };
  const { loc, item, pick } = await resolve(page, target, 'check');
  const readState = () => loc.evaluate(el => {
    const control = el.control || (el.tagName === 'INPUT' ? el : el.querySelector('input[type=checkbox], input[type=radio]'));
    if (control) return control.checked;
    const aria = el.getAttribute('aria-checked') ?? el.querySelector('[aria-checked]')?.getAttribute('aria-checked');
    return aria === null || aria === undefined ? null : aria === 'true';
  });
  const was = await readState();
  if (was !== on) await clickLocator(loc);
  await sleep(150);
  const now = await readState();
  if (was !== now) noteChange(page, item.ctx && ['radio'].includes(item.role) ? `${item.ctx}` : item.name, item.role === 'radio' ? item.name : now ? '✓' : '—');
  return { element: item, jev: pickInfo(pick), checked: now, ...(await outcome(page, before)) };
}

export async function upload(target, filePath) {
  if (!String(filePath ?? '').trim()) throw new JevisError('BAD_ARGS', T('Yüklenecek dosyanın yolunu ver (file_path).', 'Give the path of the file to upload (file_path).'));
  const abs = path.resolve(expandHome(filePath));
  if (!fs.existsSync(abs)) throw new JevisError('NOT_FOUND', T(`Dosya yok: ${abs}`, `No such file: ${abs}`));
  if (fs.statSync(abs).isDirectory()) throw new JevisError('BAD_ARGS', T(`${abs} bir klasör; yüklenecek dosyanın kendisini ver.`, `${abs} is a folder; give the file itself.`));
  const page = await activePage();
  const before = { url: page.url() };
  let bulunan;
  try {
    bulunan = await resolve(page, target, 'upload');
  } catch (err) {
    if (!['LOW_CONFIDENCE', 'NOT_FOUND'].includes(err.code)) throw err;
    // Dosya alanları çoğu zaman gizli ve teknik adlıdır: sayfadaki bütün dosya alanları tarifleriyle toplanır
    const alan = await dosyaAlaniSec(page, target);
    await alan.loc.setInputFiles(abs);
    await settle(page);
    return { element: { name: alan.etiket, role: 'file' }, file: path.basename(abs), ...(await outcome(page, before)) };
  }
  const { loc, item, pick } = bulunan;
  const isFileInput = await loc.evaluate(el => el.tagName === 'INPUT' && el.type === 'file');
  if (isFileInput) {
    await loc.setInputFiles(abs);
  } else {
    try {
      const chooser = page.waitForEvent('filechooser', { timeout: 5000 });
      await clickLocator(loc);
      await (await chooser).setFiles(abs);
    } catch {
      const inputs = page.locator('input[type=file]');
      if (await inputs.count() !== 1) throw new JevisError('NOT_FOUND', T('Dosya seçme penceresi açılmadı ve sayfada tek bir dosya alanı yok.', 'No file chooser opened, and the page does not have exactly one file field.'));
      await inputs.setInputFiles(abs);
    }
  }
  await settle(page);
  return { element: item, jev: pickInfo(pick), file: path.basename(abs), ...(await outcome(page, before)) };
}

/** Sayfadaki dosya alanlarından (gizliler dahil) tarife uyanı: tek alan varsa o, birden çoksa Jev seçer. */
async function dosyaAlaniSec(page, target) {
  const words = { accepts: T('kabul eder', 'accepts'), multiple: T('çoklu', 'multiple'), near: T('yakınında', 'near') };
  const tarifler = await page.mainFrame().evaluate(w => [...document.querySelectorAll('input[type=file]')].map(el => {
    const clean = s => (s || '').replace(/\s+/g, ' ').trim();
    let yakin = '';
    for (let p = el.parentElement, i = 0; p && i < 6 && !yakin; p = p.parentElement, i++) {
      const baslik = p.querySelector('h1, h2, h3, h4, h5, h6, label, legend, [class*=title], [class*=label]');
      yakin = clean(baslik?.innerText || '').slice(0, 80) || clean(p.innerText || '').slice(0, 80);
    }
    return clean([el.getAttribute('aria-label'), el.labels?.[0]?.innerText, el.name, el.id, el.accept && `${w.accepts}: ${el.accept}`, el.multiple && w.multiple, yakin && `${w.near}: ${yakin}`].filter(Boolean).join(' · '));
  }), words);
  if (!tarifler.length) throw new JevisError('NOT_FOUND', T('Sayfada dosya yükleme alanı yok. Önce yükleme düğmesine tıklayıp alanın açılmasını sağla.', 'The page has no file upload field. Click the upload button first so the field appears.'));
  const loc = i => page.locator('input[type=file]').nth(i);
  if (tarifler.length === 1) return { loc: loc(0), etiket: tarifler[0] || T('dosya alanı', 'file field') };
  const pick = await jev.pickOption('file upload field', String(target), tarifler);
  if (pick.index !== null && jev.isConfident(pick)) return { loc: loc(pick.index), etiket: tarifler[pick.index] };
  const list = tarifler.map((t, i) => `  ${i + 1}. ${t}`).join('\n');
  throw new JevisError('LOW_CONFIDENCE', T(`Sayfada ${tarifler.length} dosya alanı var, hangisi olduğundan emin değilim. Tarifini şunlardan birinin kelimeleriyle ver:\n${list}`,
    `The page has ${tarifler.length} file fields and I'm not sure which one is meant. Describe it with the words of one of these:\n${list}`));
}

export async function press(keys) {
  const page = await activePage();
  const before = { url: page.url() };
  let approval = null;
  if (/^(Enter|Return)$/i.test(keys)) {
    const focused = await page.mainFrame().evaluate(focusedInFrame).catch(() => '');
    const risk = await jev.isRisky(`Press Enter in "${focused || 'the page'}" (this may submit a form)`, { url: page.url(), title: await page.title() });
    approval = await guardRisk(page, { name: focused || 'Enter' }, risk.p, T(`"${focused || 'sayfa'}" içinde Enter'a basmak`, `press Enter in "${focused || 'the page'}"`));
  }
  if (human.humanOn(page)) await human.pressKey(page, keys);
  else await page.keyboard.press(keys);
  await settle(page);
  return { approval, ...(await outcome(page, before)) };
}

export async function scroll(direction = 'down', amount = 600) {
  const page = await activePage();
  if (human.humanOn(page)) {
    await human.wheel(page, direction === 'up' ? -amount : amount);
  } else {
    const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    await page.mouse.move(size.width / 2, size.height / 2);
    await page.mouse.wheel(0, direction === 'up' ? -amount : amount);
  }
  await sleep(350);
  const pos = await page.evaluate(() => ({ y: Math.round(scrollY), max: Math.max(0, Math.round(document.documentElement.scrollHeight - innerHeight)) }));
  return { url: page.url(), scrollY: pos.y, maxY: pos.max };
}

export async function back() {
  const page = await activePage();
  await page.goBack({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
  return { url: page.url(), title: await page.title().catch(() => '') };
}

// Is `q` (lower case) on the page: in its text, or in a field's label, placeholder, title or value?
function textOnPage(q) {
  const has = s => String(s || '').toLocaleLowerCase('tr').includes(q);
  if (has(document.body?.innerText)) return true;
  for (const el of document.querySelectorAll('input, textarea, select, [aria-label], [placeholder], [title], img[alt]')) {
    if (has(el.getAttribute('aria-label')) || has(el.getAttribute('placeholder')) || has(el.getAttribute('title')) || has(el.getAttribute('alt')) || has(el.value)) return true;
  }
  return false;
}

/** Waits until `text` shows (looked for every 0.4 s, returns as soon as it is there; at most ms), or just ms. */
export async function wait({ text, ms } = {}) {
  const page = await activePage();
  const started = Date.now();
  if (text) {
    const limit = Math.min(ms || 15000, 60000);
    const q = String(text).toLocaleLowerCase('tr');
    while (Date.now() - started < limit) {
      if (await withTimeout(page.evaluate(textOnPage, q).catch(() => false), 2000, false)) return { found: text, waited: Date.now() - started, url: page.url() };
      await sleep(400);
    }
    throw new JevisError('NOT_FOUND', T(`"${text}" ${Math.round(limit / 1000)} sn içinde sayfada görünmedi.`, `"${text}" did not show on the page within ${Math.round(limit / 1000)} s.`));
  }
  await sleep(Math.min(ms || 1000, 30000));
  return { waited: Date.now() - started, url: page.url() };
}

export async function tabs() {
  const page = await activePage();
  return Promise.all(openPages().map(async (p, i) => ({
    index: i + 1,
    title: await p.title().catch(() => ''),
    url: p.url(),
    active: p === page
  })));
}

async function findTab(ref) {
  const list = await tabs();
  let index = /^\d+$/.test(String(ref).trim()) ? Number(ref) - 1 : -1;
  if (index < 0) {
    const q = String(ref).toLowerCase();
    index = list.findIndex(t => t.title.toLowerCase().includes(q) || t.url.toLowerCase().includes(q));
  }
  if (index < 0) {
    const pick = await jev.pickOption('browser tab', ref, list.map(t => `${t.title} — ${t.url}`));
    if (pick.index === null || !jev.isConfident(pick)) throw new JevisError('NOT_FOUND', T(`"${ref}" sekmesi bulunamadı.`, `Tab "${ref}" not found.`));
    index = pick.index;
  }
  const page = openPages()[index];
  if (!page) throw new JevisError('NOT_FOUND', T(`${Number(ref)}. sekme yok (${list.length} sekme açık).`, `There is no tab ${Number(ref)} (${list.length} tabs open).`));
  return page;
}

/**
 * A tab's text without switching to it or starting Chrome (for watches):
 * the tab with these words in its title or address, else the current one.
 */
export async function tabText(ref, maxChars = 6000) {
  if (!(await cdpUp(config().browser.cdpPort))) throw new JevisError('NO_BROWSER', T(`${APP.genitive} Chrome penceresi kapalı.`, `${APP_NAME}'s Chrome window is closed.`));
  const page = ref ? await findTab(ref) : await activePage();
  const text = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
  return { title: await page.title().catch(() => ''), url: page.url(), text: text.slice(0, maxChars) };
}

export async function switchTab(ref) {
  const page = await findTab(ref);
  await page.bringToFront();
  await remember(page);
  return { title: await page.title().catch(() => ''), url: page.url() };
}

/**
 * A tab into its own window. Chrome has no way to move a live tab from outside, so the page opens again in a new
 * window and the tab closes: what was typed into a form and the scroll position don't come along.
 */
export async function tabToWindow(ref) {
  const old = ref === undefined ? await activePage() : await findTab(ref);
  const url = old.url();
  const page = await newWindowPage(url);
  if (!old.isClosed()) await old.close().catch(() => {});
  return { url: page.url(), title: await page.title().catch(() => '') };
}

export async function closeTab(ref) {
  const page = ref === undefined ? await activePage() : await findTab(ref);
  const info = { title: await page.title().catch(() => ''), url: page.url() };
  await page.close();
  if (page === current) current = null;
  return info;
}

/** format 'jpeg' keeps images sent to an LLM small; the CLI keeps PNG. */
// Numbered boxes over the elements on screen, for a screenshot. They sit in
// their own layer (a shadow root) that the mouse passes through, and are
// removed right after the picture is taken. Neighbours get different colours
// and a label never covers another label.
function drawMarksInFrame(ids) {
  const COLORS = ['#e5383b', '#0a7cff', '#2a9d3c', '#b04cf0', '#e8820c', '#0aa2a6'];
  const host = document.createElement('div');
  host.id = '__jevis_marks';
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
  const root = host.attachShadow({ mode: 'closed' });
  const placed = [];
  const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  ids.forEach((id, n) => {
    const el = document.querySelector(`[data-jevis-id="${CSS.escape(id)}"]`);
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    const color = COLORS[n % COLORS.length];
    const box = document.createElement('div');
    box.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;border:2px solid ${color};border-radius:3px;box-sizing:border-box`;
    const label = document.createElement('div');
    label.textContent = id;
    const w = 7 * id.length + 8;
    const h = 15;
    // On the top-left corner, outside the box when there is room; moved along the box edge if taken.
    let spot = { x: r.left, y: r.top - h >= 0 ? r.top - h : r.bottom, w, h };
    for (let tries = 0; tries < 6 && placed.some(p => overlaps(p, spot)); tries++) {
      spot = tries % 2 === 0 ? { ...spot, x: spot.x + w + 2 } : { ...spot, y: r.top + r.height - h };
    }
    placed.push(spot);
    label.style.cssText = `position:fixed;left:${spot.x}px;top:${spot.y}px;height:${h}px;padding:0 4px;background:${color};color:#fff;font:bold 11px/15px -apple-system,sans-serif;border-radius:3px`;
    root.append(box, label);
  });
  document.documentElement.append(host);
}

function removeMarksInFrame() {
  document.getElementById('__jevis_marks')?.remove();
}

export async function screenshot({ fullPage = false, format = 'png', marks = false } = {}) {
  const page = await activePage();
  await page.bringToFront().catch(() => {});
  const type = format === 'jpeg' ? 'jpeg' : 'png';
  let legend = null;
  if (marks) {
    const snap = await snapshot(page);
    const onScreen = snap.items.filter(i => i.inView && !/^f/.test(i.id)).slice(0, 150);
    legend = onScreen.map(i => `#${i.id} ${labelOf(i)}`);
    await page.mainFrame().evaluate(drawMarksInFrame, onScreen.map(i => i.id)).catch(() => {});
  }
  let buf;
  try {
    buf = await page.screenshot({ fullPage: fullPage && !marks, scale: 'css', type, ...(type === 'jpeg' ? { quality: 70 } : {}), timeout: 15000 });
  } finally {
    if (marks) await page.mainFrame().evaluate(removeMarksInFrame).catch(() => {});
  }
  const file = path.join(homeDir('shots'), `${new Date().toISOString().replace(/[:.]/g, '-')}.${type === 'jpeg' ? 'jpg' : 'png'}`);
  fs.writeFileSync(file, buf);
  return { path: file, base64: buf.toString('base64'), mimeType: `image/${type}`, url: page.url(), title: await page.title().catch(() => ''), legend };
}

export async function verify(expectation) {
  const page = await activePage();
  const text = await page.mainFrame().evaluate(pageTextInFrame, textArgs(3000)).catch(() => '');
  const alerts = await page.mainFrame().evaluate(alertsInFrame, T('Geçersiz alan', 'Invalid field')).catch(() => []);
  // Field values and checkbox states are not part of the page text.
  const snap = await snapshot(page);
  const controls = snap.items.filter(i => i.state.length).slice(0, 120).map(labelOf);
  const res = await jev.checkState(expectation, { url: page.url(), title: snap.title, text, alerts, controls });
  return { expectation, ...res, p: pct(res.p) };
}

// ---------------------------------------------------------------------------
// Text formatting shared by the CLI and the MCP server
// ---------------------------------------------------------------------------

export function formatRead(r, { maxElements = 200, all = false } = {}) {
  const lines = [`${T('Sayfa', 'Page')}: ${r.title}`, `URL: ${r.url}`];
  if (r.alerts?.length) lines.push(`${T('Uyarılar', 'Alerts')}: ${r.alerts.join(' | ')}`);
  // What's on screen in full; the rest as a count (targets there still work by name).
  const onScreen = r.elements.filter(e => e.inView);
  const shown = all || !onScreen.length ? r.elements : onScreen;
  lines.push('', T(`Öğeler (${shown.length}${all ? '' : ' ekranda'}${r.total > r.elements.length ? `, sayfada toplam ${r.total}` : ''}):`,
    `Elements (${shown.length}${all ? '' : ' on screen'}${r.total > r.elements.length ? `, ${r.total} on the page in all` : ''}):`));
  for (const el of shown.slice(0, maxElements)) lines.push(`#${el.id} ${labelOf(el)}`);
  const rest = r.elements.length - Math.min(shown.length, maxElements);
  if (rest > 0) lines.push(T(`… ekran dışında ${rest} öğe daha. Onlara da adıyla hedef verebilirsin; hepsini görmek için browser_read all=true.`, `… ${rest} more ${rest === 1 ? 'element' : 'elements'} off screen. You can target them by name too; browser_read all=true lists them all.`));
  if (r.text) lines.push('', T('Sayfa metni:', 'Page text:'), r.text);
  return lines.join('\n');
}

export function formatOutcome(res) {
  const parts = [];
  // the router and the window read "Öğe: …" / "Element: …", "Sayfa değişti" / "Page changed", "Yeni sekme" / "New tab", "Şu an: …" / "Now: …"
  if (res.element) parts.push(T(`Öğe: "${res.element.name}"${res.jev?.confidence !== undefined ? ` (Jev %${res.jev.confidence}, ${res.jev.ms} ms)` : ''}`, `Element: "${res.element.name}"${res.jev?.confidence !== undefined ? ` (Jev ${res.jev.confidence}%, ${res.jev.ms} ms)` : ''}`));
  if (res.typed !== undefined) parts.push(T(`${res.typed} karakter yazıldı`, `${many(res.typed, 'character')} typed`));
  if (res.selected !== undefined) parts.push(`${T('Seçildi', 'Selected')}: ${res.selected}`);
  if (res.checked !== undefined) parts.push(`${T('İşaretli', 'Checked')}: ${res.checked === null ? T('bilinmiyor', 'unknown') : res.checked ? T('evet', 'yes') : T('hayır', 'no')}`);
  if (res.file) parts.push(`${T('Yüklendi', 'Uploaded')}: ${res.file}`);
  if (res.newTab) parts.push(T('Yeni sekme açıldı', 'New tab opened'));
  if (res.approval) parts.push(T(`Kullanıcı onayladı (${res.approval.reason})`, `The user approved (${res.approval.reason})`));
  if (res.navigated) parts.push(T('Sayfa değişti', 'Page changed'));
  if (res.title !== undefined) parts.push(`${T('Şu an', 'Now')}: ${res.title} (${res.url})`);
  if (res.alerts?.length) parts.push(`${T('Uyarılar', 'Alerts')}: ${res.alerts.join(' | ')}`);
  return parts.join('\n');
}

export function formatError(err) {
  const lines = [err.message];
  if (err.alternatives?.length) {
    lines.push(T('Adaylar:', 'Candidates:'));
    for (const a of err.alternatives) lines.push(T(`  #${a.id} ${a.label} (%${a.p})`, `  #${a.id} ${a.label} (${a.p}%)`));
  }
  return lines.join('\n');
}

/** Detect and auto-solve any CAPTCHA on the active page. */
export async function solveCaptcha() {
  const page = await activePage();
  return captcha.solve(page);
}

/** Return a description of the CAPTCHA type on the active page, or null. */
export async function describeCaptcha() {
  const page = await activePage();
  return captcha.describe(page);
}
