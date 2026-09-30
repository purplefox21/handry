// Browser hands: drives the user's installed Chrome (with a separate JEVIS
// profile) through Playwright. Jev decides which element an instruction means;
// risky clicks go through the confirmation dialog first.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { config, expandHome, homeDir, loadState, saveState } from '../core/config.js';
import * as jev from '../core/jev.js';
import { needsConfirm, confirmAction } from '../guard/confirm.js';
import { JevisError } from '../core/errors.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const withTimeout = (promise, ms, fallback) => Promise.race([promise, sleep(ms).then(() => fallback)]);
const pct = p => Math.round((p || 0) * 100);

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

/** Starts Chrome with the JEVIS profile and a local-only debugging port, unless it already runs. */
export async function ensureChrome() {
  const { cdpPort, chromePath, profileDir } = config().browser;
  if (await cdpUp(cdpPort)) return false;
  if (!fs.existsSync(chromePath)) throw new JevisError('NO_CHROME', `Chrome bulunamadı: ${chromePath}`);
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
  throw new JevisError('NO_CHROME', 'Chrome açıldı ama bağlantı noktası hazır olmadı.');
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

// The JEVIS chat page itself is never a page to work on. The app server
// exports its real port in JEVIS_UI_PORT (inherited by brains and MCP).
const isJevisUi = url => {
  const ports = new Set([String(config().server?.port || 3000), process.env.JEVIS_UI_PORT].filter(Boolean));
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

/** The tab JEVIS works on: the one the user is looking at, else the last one used. */
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
  // Several windows each show a tab: prefer the one JEVIS used last.
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

function snapshotInFrame({ prefix, max }) {
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
    return clean(el.getAttribute('title') || el.querySelector('img[alt]')?.alt || el.querySelector('svg title')?.textContent || el.getAttribute('name') || '');
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

function pageTextInFrame(maxChars) {
  const text = (document.body?.innerText || '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n… (${text.length - maxChars} karakter daha)` : text;
}

function alertsInFrame() {
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const out = [];
  for (const el of document.querySelectorAll('[role=alert], [role=alertdialog], [aria-live=assertive]')) {
    const r = el.getBoundingClientRect();
    const t = clean(el.innerText);
    if (t && r.width > 0 && r.height > 0 && !out.includes(t)) out.push(t.slice(0, 160));
  }
  for (const el of document.querySelectorAll('[aria-invalid=true]')) {
    const name = clean(el.getAttribute('aria-label') || el.labels?.[0]?.innerText || el.name || el.id);
    if (name) out.push(`Geçersiz alan: ${name.slice(0, 60)}`);
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
      frames[fi].evaluate(snapshotInFrame, { prefix: fi === 0 ? '' : `f${fi}-`, max: maxElements - items.length }).catch(() => null),
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
  return `[${item.role}] ${item.name || '(isimsiz)'}${item.ctx ? ` — ${item.ctx}` : ''}${state.length ? ` {${state.join(', ')}}` : ''}`;
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
  check: t => `Tick or untick the checkbox/switch/radio: ${t}`,
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
    if (!loc) throw new JevisError('STALE', `#${idMatch[1]} artık sayfada yok. Önce sayfayı yeniden okuyun (read).`);
    // Same order as the element list: a field is named by its label, not by what's typed in it.
    const name = await loc.evaluate(el => {
      const clean = s => (s || '').replace(/\s+/g, ' ').trim();
      let text = el.innerText || '';
      for (const s of el.querySelectorAll('select')) if (s.innerText) text = text.replace(s.innerText, ' ');
      return (clean(el.getAttribute('aria-label')) || clean([...(el.labels || [])].map(l => l.innerText).join(' '))
        || clean(el.getAttribute('placeholder')) || clean(el.getAttribute('title')) || clean(text)
        || clean(el.getAttribute('name')) || clean(el.id) || clean(el.value)).slice(0, 80);
    });
    const item = { id: idMatch[1], name, role: 'seçilen', ctx: '', state: [] };
    const risk = withRisk ? (await jev.isRisky(PURPOSE[purpose](name), { url: page.url(), title: await page.title() })).p : null;
    return { loc, item, pick: { confidence: 1, risk, ms: 0 } };
  }

  const snap = await snapshot(page);
  let items = snap.items;
  if (purpose === 'option') items = await narrowOptions(page, items, scope);
  if (!items.length) throw new JevisError('NOT_FOUND', 'Sayfada kullanılabilir öğe bulunamadı.');
  const labels = items.map(labelOf);
  const pick = await jev.pickElement(PURPOSE[purpose](target), labels, { url: snap.url, title: snap.title }, { withRisk });
  const alternatives = pick.alternatives
    .filter(a => a.index !== null)
    .map(a => ({ id: items[a.index].id, label: labels[a.index], p: pct(a.p) }));

  if (pick.index === null) {
    throw new JevisError('NOT_FOUND', `"${target}" ile eşleşen öğe yok (Jev "hiçbiri" dedi, %${pct(pick.confidence)}).`, { alternatives });
  }
  if (!jev.isConfident(pick)) {
    throw new JevisError('LOW_CONFIDENCE', `Jev "${target}" için emin değil (%${pct(pick.confidence)}). Adaylardan birini #id ile seçin.`, { alternatives });
  }
  const item = items[pick.index];
  const loc = await locate(page, item.id);
  if (!loc) throw new JevisError('STALE', 'Öğe seçilirken sayfa değişti, tekrar deneyin.');
  return { loc, item, pick };
}

/**
 * Asks the user when the action is risky. Returns null (no question needed)
 * or { reason, screenshot } as a record of what was approved.
 */
async function guardRisk(page, item, riskP, actionText) {
  const host = (() => { try { return new URL(page.url()).host; } catch { return ''; } })();
  const verdict = needsConfirm(item, riskP, host);
  if (!verdict.ask) return null;
  const title = await page.title().catch(() => '');
  const ok = await confirmAction(`JEVIS şunu yapmak istiyor:\n\n${actionText}\n\nSayfa: ${title}\nNeden soruluyor: ${verdict.reason}\n\nİzin veriyor musun?`);
  if (!ok) throw new JevisError('DENIED', `Kullanıcı izin vermedi: ${actionText}`);
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
    alerts: await withTimeout(page.mainFrame().evaluate(alertsInFrame).catch(() => []), 1500, [])
  };
}

async function clickLocator(loc) {
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

export async function open(input, { newTab = false } = {}) {
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
 * Is the user logged in to these sites in the JEVIS Chrome? Looks at the
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
      out.text = await withTimeout(page.mainFrame().evaluate(pageTextInFrame, 1500).catch(() => ''), 3000, '');
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
  return withTimeout(page.mainFrame().evaluate(pageTextInFrame, maxChars).catch(() => ''), 3000, '');
}

export async function read({ text = true } = {}) {
  const page = await activePage();
  const snap = await snapshot(page);
  const body = text
    ? await withTimeout(page.mainFrame().evaluate(pageTextInFrame, config().browser.maxTextChars).catch(() => ''), 3000, '')
    : '';
  const alerts = await withTimeout(page.mainFrame().evaluate(alertsInFrame).catch(() => []), 1500, []);
  return { url: snap.url, title: snap.title, elements: snap.items, total: snap.total, text: body, alerts };
}

export async function click(target, { risk = true, purpose = 'click', scope } = {}) {
  const page = await activePage();
  const before = { url: page.url() };
  const { loc, item, pick } = await resolve(page, target, purpose, { withRisk: risk, scope });
  if (await loc.evaluate(el => el.tagName === 'INPUT' && el.type === 'file')) {
    throw new JevisError('WRONG_TOOL', 'Bu bir dosya seçme alanı; dosya yüklemek için upload kullanın.');
  }
  const approval = risk ? await guardRisk(page, item, pick.risk, `"${item.name}" öğesine tıklamak`) : null;
  const popup = context().waitForEvent('page', { timeout: 1500 }).catch(() => null);
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
    approval = await guardRisk(page, item, risk.p, `"${item.name}" alanına yazıp Enter'a basmak (form gönderilebilir)`);
  }
  await loc.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
  if (append) {
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
  if (submit) {
    await loc.press('Enter');
    await settle(page);
  }
  return { element: item, jev: pickInfo(pick), typed: text.length, approval, ...(await outcome(page, before)) };
}

/** Fills a field with a value the caller must never see (passwords). */
export async function fillHidden(target, value) {
  const page = await activePage();
  const { loc, item, pick } = await resolve(page, target, 'secret');
  await loc.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
  await loc.fill(value, { timeout: 4000 });
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
        throw new JevisError('NOT_FOUND', `"${option}" seçeneği bulunamadı. Seçenekler: ${options.slice(0, 40).join(' | ')}`);
      }
      index = optPick.index;
    }
    await native.selectOption({ index }, { force: true });
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
  return { element: item, jev: pickInfo(pick), checked: await readState(), ...(await outcome(page, before)) };
}

export async function upload(target, filePath) {
  const abs = path.resolve(expandHome(filePath));
  if (!fs.existsSync(abs)) throw new JevisError('NOT_FOUND', `Dosya yok: ${abs}`);
  const page = await activePage();
  const before = { url: page.url() };
  const { loc, item, pick } = await resolve(page, target, 'upload');
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
      if (await inputs.count() !== 1) throw new JevisError('NOT_FOUND', 'Dosya seçme penceresi açılmadı ve sayfada tek bir dosya alanı yok.');
      await inputs.setInputFiles(abs);
    }
  }
  await settle(page);
  return { element: item, jev: pickInfo(pick), file: path.basename(abs), ...(await outcome(page, before)) };
}

export async function press(keys) {
  const page = await activePage();
  const before = { url: page.url() };
  let approval = null;
  if (/^(Enter|Return)$/i.test(keys)) {
    const focused = await page.mainFrame().evaluate(focusedInFrame).catch(() => '');
    const risk = await jev.isRisky(`Press Enter in "${focused || 'the page'}" (this may submit a form)`, { url: page.url(), title: await page.title() });
    approval = await guardRisk(page, { name: focused || 'Enter' }, risk.p, `"${focused || 'sayfa'}" içinde Enter'a basmak`);
  }
  await page.keyboard.press(keys);
  await settle(page);
  return { approval, ...(await outcome(page, before)) };
}

export async function scroll(direction = 'down', amount = 600) {
  const page = await activePage();
  const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  await page.mouse.move(size.width / 2, size.height / 2);
  await page.mouse.wheel(0, direction === 'up' ? -amount : amount);
  await sleep(350);
  const pos = await page.evaluate(() => ({ y: Math.round(scrollY), max: Math.max(0, Math.round(document.documentElement.scrollHeight - innerHeight)) }));
  return { url: page.url(), scrollY: pos.y, maxY: pos.max };
}

export async function back() {
  const page = await activePage();
  await page.goBack({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
  return { url: page.url(), title: await page.title().catch(() => '') };
}

export async function wait({ text, ms } = {}) {
  const page = await activePage();
  if (text) {
    await page.getByText(text, { exact: false }).first().waitFor({ timeout: ms || 15000 });
    return { found: text, url: page.url() };
  }
  await sleep(Math.min(ms || 1000, 30000));
  return { waited: ms || 1000, url: page.url() };
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
    if (pick.index === null || !jev.isConfident(pick)) throw new JevisError('NOT_FOUND', `"${ref}" sekmesi bulunamadı.`);
    index = pick.index;
  }
  const page = openPages()[index];
  if (!page) throw new JevisError('NOT_FOUND', `${Number(ref)}. sekme yok (${list.length} sekme açık).`);
  return page;
}

export async function switchTab(ref) {
  const page = await findTab(ref);
  await page.bringToFront();
  await remember(page);
  return { title: await page.title().catch(() => ''), url: page.url() };
}

export async function closeTab(ref) {
  const page = ref === undefined ? await activePage() : await findTab(ref);
  const info = { title: await page.title().catch(() => ''), url: page.url() };
  await page.close();
  if (page === current) current = null;
  return info;
}

/** format 'jpeg' keeps images sent to an LLM small; the CLI keeps PNG. */
export async function screenshot({ fullPage = false, format = 'png' } = {}) {
  const page = await activePage();
  await page.bringToFront().catch(() => {});
  const type = format === 'jpeg' ? 'jpeg' : 'png';
  const buf = await page.screenshot({ fullPage, scale: 'css', type, ...(type === 'jpeg' ? { quality: 70 } : {}), timeout: 15000 });
  const file = path.join(homeDir('shots'), `${new Date().toISOString().replace(/[:.]/g, '-')}.${type === 'jpeg' ? 'jpg' : 'png'}`);
  fs.writeFileSync(file, buf);
  return { path: file, base64: buf.toString('base64'), mimeType: `image/${type}`, url: page.url(), title: await page.title().catch(() => '') };
}

export async function verify(expectation) {
  const page = await activePage();
  const text = await page.mainFrame().evaluate(pageTextInFrame, 3000).catch(() => '');
  const alerts = await page.mainFrame().evaluate(alertsInFrame).catch(() => []);
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
  const lines = [`Sayfa: ${r.title}`, `URL: ${r.url}`];
  if (r.alerts?.length) lines.push(`Uyarılar: ${r.alerts.join(' | ')}`);
  // What's on screen in full; the rest as a count (targets there still work by name).
  const onScreen = r.elements.filter(e => e.inView);
  const shown = all || !onScreen.length ? r.elements : onScreen;
  lines.push('', `Öğeler (${shown.length}${all ? '' : ' ekranda'}${r.total > r.elements.length ? `, sayfada toplam ${r.total}` : ''}):`);
  for (const el of shown.slice(0, maxElements)) lines.push(`#${el.id} ${labelOf(el)}`);
  const rest = r.elements.length - Math.min(shown.length, maxElements);
  if (rest > 0) lines.push(`… ekran dışında ${rest} öğe daha. Onlara da adıyla hedef verebilirsin; hepsini görmek için browser_read all=true.`);
  if (r.text) lines.push('', 'Sayfa metni:', r.text);
  return lines.join('\n');
}

export function formatOutcome(res) {
  const parts = [];
  if (res.element) parts.push(`Öğe: "${res.element.name}"${res.jev?.confidence !== undefined ? ` (Jev %${res.jev.confidence}, ${res.jev.ms} ms)` : ''}`);
  if (res.typed !== undefined) parts.push(`${res.typed} karakter yazıldı`);
  if (res.selected !== undefined) parts.push(`Seçildi: ${res.selected}`);
  if (res.checked !== undefined) parts.push(`İşaretli: ${res.checked === null ? 'bilinmiyor' : res.checked ? 'evet' : 'hayır'}`);
  if (res.file) parts.push(`Yüklendi: ${res.file}`);
  if (res.newTab) parts.push('Yeni sekme açıldı');
  if (res.approval) parts.push(`Kullanıcı onayladı (${res.approval.reason})`);
  if (res.navigated) parts.push('Sayfa değişti');
  if (res.title !== undefined) parts.push(`Şu an: ${res.title} (${res.url})`);
  if (res.alerts?.length) parts.push(`Uyarılar: ${res.alerts.join(' | ')}`);
  return parts.join('\n');
}

export function formatError(err) {
  const lines = [err.message];
  if (err.alternatives?.length) {
    lines.push('Adaylar:');
    for (const a of err.alternatives) lines.push(`  #${a.id} ${a.label} (%${a.p})`);
  }
  return lines.join('\n');
}
