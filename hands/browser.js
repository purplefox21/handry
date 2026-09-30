// Browser hands: drives the user's installed Chrome (with a separate JEVIS
// profile) through Playwright. Jev decides which element an instruction means;
// risky clicks go through the confirmation dialog first.
import fs from 'node:fs';
import os from 'node:os';
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
// What JEVIS typed, chose or ticked on each page since the last approved
// action, so the approval shows what is about to be saved.
const pendingChanges = new WeakMap();
function noteChange(page, field, value) {
  const list = (pendingChanges.get(page) || []).filter(c => c.field !== field);
  list.push({ field: String(field || '?').slice(0, 40), value: String(value ?? '').replace(/\s+/g, ' ').slice(0, 60) });
  pendingChanges.set(page, list);
}

async function guardRisk(page, item, riskP, actionText) {
  const host = (() => { try { return new URL(page.url()).host; } catch { return ''; } })();
  const verdict = needsConfirm(item, riskP, host);
  if (!verdict.ask) return null;
  const title = await page.title().catch(() => '');
  const changes = pendingChanges.get(page) || [];
  const changed = changes.length ? `\n\nBu sayfada JEVIS'in girdikleri:\n${changes.slice(-12).map(c => `• ${c.field}: ${c.value}`).join('\n')}` : '';
  const ok = await confirmAction(`JEVIS şunu yapmak istiyor:\n\n${actionText}${changed}\n\nSayfa: ${title}\nNeden soruluyor: ${verdict.reason}\n\nİzin veriyor musun?`);
  if (!ok) throw new JevisError('DENIED', `Kullanıcı izin vermedi: ${actionText}`);
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
  noteChange(page, item.name, /password/.test(item.role) || await loc.evaluate(el => el.type === 'password').catch(() => false) ? '••••' : text);
  if (submit) {
    await loc.press('Enter');
    await settle(page);
  }
  return { element: item, jev: pickInfo(pick), typed: text.length, approval, ...(await outcome(page, before)) };
}

/**
 * Clicks a download link or button and puts the file where it belongs
 * (default ~/Downloads/JEVIS; a folder or a full path, inside the home
 * folder). An existing file is never overwritten: a number is added.
 */
export async function download(target, saveTo) {
  const page = await activePage();
  const { loc, item, pick } = await resolve(page, target, 'click');
  const waiting = page.waitForEvent('download', { timeout: 60000 });
  await clickLocator(loc);
  let dl;
  try { dl = await waiting; } catch { throw new JevisError('NO_DOWNLOAD', `"${item.name}" tıklandı ama 60 sn içinde bir indirme başlamadı.`); }
  const name = dl.suggestedFilename();
  const home = os.homedir();
  const wanted = path.resolve(expandHome(saveTo || '~/Downloads/JEVIS/'));
  if (wanted !== home && !wanted.startsWith(home + path.sep)) throw new JevisError('OUTSIDE_HOME', 'İndirilen dosya sadece ev klasörünün içine kaydedilir.');
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
  if (!found.length) throw new JevisError('NOT_FOUND', 'Sayfada tablo bulunamadı.');
  const describe = t => `${t.label || '(başlıksız)'} — ${t.headers.length ? t.headers.join(', ') : `ilk satır: ${t.rows[0].join(', ')}`} (${t.total} satır)`;
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
  const lines = [`Tablo: ${t.label || '(başlıksız)'} · ${t.total} satır${t.total > t.rows.length ? ` (ilk ${t.rows.length})` : ''}${keys ? '' : t.headers.length ? ` · sütunlar: ${t.headers.join(', ')}` : ''}`];
  for (const row of t.rows) lines.push(JSON.stringify(keys ? Object.fromEntries(keys.map((k, i) => [k || `sütun ${i + 1}`, row[i] ?? ''])) : row));
  if (r.others.length) lines.push('', `Sayfadaki diğer tablolar: ${r.others.join(' | ')}`);
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
      const own = clean([...(a.childNodes || [])].filter(n => n.nodeType === 3).map(n => n.textContent).join(' '));
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
  if (!candidates.length) throw new JevisError('NOT_FOUND', 'Sayfada okunacak bir değer (alan, kod, anahtar) bulunamadı.');
  const pick = await jev.pickElement(`Read the value of: ${target}`, candidates.map(c => c.label), { url: page.url(), title: await page.title().catch(() => '') });
  if (pick.index === null || !jev.isConfident(pick)) {
    const alternatives = pick.alternatives.filter(a => a.index !== null).map(a => ({ id: candidates[a.index].id, label: candidates[a.index].label, p: pct(a.p) }));
    throw new JevisError(pick.index === null ? 'NOT_FOUND' : 'LOW_CONFIDENCE', `"${target}" değeri sayfada bulunamadı ya da Jev emin değil (%${pct(pick.confidence)}).`, { alternatives });
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
  if (!items.length) throw new JevisError('NOT_FOUND', 'Sayfada doldurulacak alan bulunamadı.');
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
      row.problem = pick.error || (pick.index === null ? 'bulunamadı' : `Jev emin değil (%${pct(pick.confidence)})`);
      row.candidates = pick.alternatives.filter(a => a.index !== null).map(a => `#${items[a.index].id} ${labels[a.index]}`);
      continue;
    }
    const item = items[pick.index];
    Object.assign(row, { id: item.id, label: labels[pick.index], before: valueOf(item) });
    if (used.has(item.id) && !CHOICE_ROLES.includes(item.role)) { row.problem = 'bu öğe başka bir alan için zaten dolduruldu'; continue; }
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
        row.problem = `bu bir ${item.role}; doldurulacak bir alan değil (Kaydet gibi düğmelere browser_click ile bas)`;
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
  const lines = [`${r.rows.filter(x => x.ok).length}/${r.rows.length} alan dolduruldu (kaydedilmedi):`];
  for (const x of r.rows) {
    if (x.ok) lines.push(`✓ ${x.field}: "${x.before}" → "${x.after}"  (#${x.id})`);
    else {
      lines.push(`✗ ${x.field} = "${x.value}": ${x.problem}${x.id ? ` (#${x.id})` : ''}`);
      if (x.candidates?.length) lines.push(`    adaylar: ${x.candidates.join(' | ')}`);
    }
  }
  return lines.join('\n');
}

/** Fills a field with a value the caller must never see (passwords). */
export async function fillHidden(target, value) {
  const page = await activePage();
  const { loc, item, pick } = await resolve(page, target, 'secret');
  await loc.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
  await loc.fill(value, { timeout: 4000 });
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
        throw new JevisError('NOT_FOUND', `"${option}" seçeneği bulunamadı. Seçenekler: ${options.slice(0, 40).join(' | ')}`);
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

/**
 * A tab's text without switching to it or starting Chrome (for watches):
 * the tab with these words in its title or address, else the current one.
 */
export async function tabText(ref, maxChars = 6000) {
  if (!(await cdpUp(config().browser.cdpPort))) throw new JevisError('NO_BROWSER', "JEVIS'in Chrome penceresi kapalı.");
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
