// Handry · © 2026 Berat Olekli (purplefox) · github.com/purplefox21/handry
// Recipes: a successful run saved as its tool steps, replayed later without
// a brain (Jev still finds each element, so small page changes don't break
// it). Steps may use {{variables}} and "ask_brain" steps for the parts that
// need thinking; when a step fails the caller can hand the rest to a brain.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, HOME, PACKAGED } from './config.js';
import { callTool } from './tools.js';
import { actionsOfRun } from '../guard/log.js';
import { T } from './i18n.js';

// The downloaded app can't write into itself: recipes live in ~/.jevis there, starting from the ones it brings.
const DIR = PACKAGED ? path.join(HOME, 'recipes') : path.join(ROOT, 'recipes');
if (PACKAGED && !fs.existsSync(DIR)) {
  fs.mkdirSync(DIR, { recursive: true });
  try { fs.cpSync(path.join(ROOT, 'recipes'), DIR, { recursive: true }); } catch {}
}
// Recipes Handry learned by itself (core/learn.js) hold the user's own
// commands, so they live outside the repository.
export const LEARNED_DIR = path.join(HOME, 'learned');

// Tools that change something; reads and screenshots aren't replayed.
const REPLAYABLE = new Set([
  'browser_open', 'browser_click', 'browser_type', 'browser_select', 'browser_check', 'browser_upload',
  'browser_press', 'browser_scroll', 'browser_back', 'browser_tabs', 'browser_fill_secret', 'browser_wait', 'browser_verify',
  'wait_for_user', 'desktop_open_app', 'desktop_quit_app', 'desktop_click', 'desktop_type', 'desktop_key', 'mac_action',
  'desktop_focus_window', 'desktop_wait', 'desktop_click_at', 'browser_fill', 'browser_download', 'human_mode'
]);

// Doing these twice in a row with the same values ends where doing them once does.
const REFILL = new Set(['browser_fill', 'browser_open', 'browser_select']);

// Roles the desktop tools press by name (a click at a point on one of these
// replays as a click on its name, which survives window moves and resizes).
const PRESSABLE = new Set(['Button', 'Link', 'MenuItem', 'Cell', 'Row', 'Tab', 'CheckBox', 'RadioButton', 'PopUpButton', 'MenuButton', 'DisclosureTriangle', 'Switch', 'Toggle']);

export function slug(name) {
  const map = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' };
  return String(name).toLowerCase().replace(/[çğıöşü]/g, c => map[c]).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// A saved recipe wins over a learned one with the same name.
const fileOf = name => [DIR, LEARNED_DIR].map(d => path.join(d, `${slug(name)}.json`)).find(f => fs.existsSync(f)) || path.join(DIR, `${slug(name)}.json`);
// {{name}}, or {{name:url}} / {{name:plus}} inside web addresses.
const VAR = /\{\{(\w+)(?::(url|plus))?\}\}/g;
export const varsIn = steps => [...new Set([...JSON.stringify(steps).matchAll(VAR)].map(m => m[1]))];

const readDir = dir => (fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'))) : []);

export function listRecipes() {
  const saved = readDir(DIR);
  const names = new Set(saved.map(r => r.name));
  return [...saved, ...readDir(LEARNED_DIR).filter(r => !names.has(r.name))].map(r => ({
    name: r.name,
    description: r.description || '',
    steps: r.steps.length,
    vars: varsIn(r.steps),
    hints: r.hints || {},
    ...(r.learned ? { learned: true, example: r.example, pattern: r.pattern, uses: r.uses || 0 } : {})
  }));
}

export function loadRecipe(name) {
  const file = fileOf(name);
  if (!fs.existsSync(file)) throw new Error(T(`"${name}" adında bir tarif yok.`, `There is no recipe named "${name}".`));
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

export function deleteRecipe(name) {
  fs.rmSync(fileOf(name), { force: true });
}

/** The logged, successful actions of a run (optionally only those since a time) as replayable steps. */
export function stepsFromRun(runId, { since = 0 } = {}) {
  const steps = [];
  for (const e of actionsOfRun(runId)) {
    if (!e.ok || !REPLAYABLE.has(e.tool) || Date.parse(e.ts) < since) continue;
    if (e.tool === 'browser_tabs' && e.args.action === 'list') continue;
    const args = { ...e.args };
    if (e.tool === 'desktop_click_at') {
      const hit = e.summary.match(/(?:altında|under(?: it)?) \[(\w+)\] (.+)$/m);
      if (hit && PRESSABLE.has(hit[1]) && !/^\((isimsiz|unnamed|no name)\)$/.test(hit[2])) steps.push({ tool: 'desktop_click', args: { target: hit[2] } });
      else steps.push({ ask_brain: T(`Ekranda şuna tıkla: ${args.description} (desktop_screenshot, sonra desktop_click_at).`, `On the screen, click this: ${args.description} (desktop_screenshot, then desktop_click_at).`) });
      continue;
    }
    // "#12" only meant something on that page load; keep the element's name instead.
    if (typeof args.target === 'string' && /^#/.test(args.target)) {
      const named = e.summary.match(/(?:Öğe|Element): "([^"]+)"/);
      if (named) args.target = named[1];
    }
    // the same form filled again (e.g. after waiting for an approval, the page had changed): once is enough
    const last = steps.at(-1);
    if (REFILL.has(e.tool) && last?.tool === e.tool && JSON.stringify(last.args) === JSON.stringify(args)) continue;
    steps.push({ tool: e.tool, args });
  }
  return steps;
}

/** Turns the logged, successful actions of a run into a recipe. */
export function saveFromRun(name, runId, { description = '' } = {}) {
  const steps = stepsFromRun(runId);
  if (!steps.length) throw new Error(T('Bu işte tekrar oynatılabilecek bir adım yok.', 'This task has no steps that can be replayed.'));
  const recipe = { name: slug(name), description, created: new Date().toISOString(), fromRun: runId, steps };
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, `${slug(name)}.json`), `${JSON.stringify(recipe, null, 2)}\n`);
  return recipe;
}

const ENCODE = { url: encodeURIComponent, plus: v => encodeURIComponent(v).replace(/%20/g, '+') };

function fill(value, vars) {
  if (typeof value === 'string') return value.replace(VAR, (m, k, enc) => (k in vars ? (enc ? ENCODE[enc](vars[k]) : vars[k]) : m));
  if (Array.isArray(value)) return value.map(v => fill(v, vars));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, vars)]));
  return value;
}
export const fillVars = fill;

/**
 * Replays a recipe. askBrain(prompt) handles "ask_brain" steps. Returns
 * { ok: true } or { ok: false, failedAt, step, error, remaining }.
 */
export async function runRecipe(name, { vars = {}, onEvent = () => {}, signal, askBrain } = {}) {
  const recipe = loadRecipe(name);
  const missing = varsIn(recipe.steps).filter(v => !(v in vars));
  if (missing.length) throw new Error(T(`Tarif şu değerleri istiyor: ${missing.join(', ')} (ör. --var=${missing[0]}=…)`, `The recipe needs these values: ${missing.join(', ')} (e.g. --var=${missing[0]}=…)`));
  const steps = fill(recipe.steps, vars);
  onEvent({ type: 'status', text: T(`📌 "${recipe.name}" tarifi: ${steps.length} adım, beyin kullanılmadan`, `📌 "${recipe.name}" recipe: ${steps.length} steps, no brain`) });
  for (let i = 0; i < steps.length; i++) {
    if (signal?.aborted) return { ok: false, stopped: true, failedAt: i };
    const step = steps[i];
    if (step.ask_brain) {
      if (!askBrain) return { ok: false, failedAt: i, step, error: T('Bu adım bir beyin gerektiriyor.', 'This step needs a brain.'), remaining: steps.slice(i) };
      onEvent({ type: 'status', text: T(`🧠 Tarifin düşünme adımı: ${step.ask_brain}`, `🧠 The recipe's thinking step: ${step.ask_brain}`) });
      await askBrain(step.ask_brain);
      continue;
    }
    onEvent({ type: 'tool', name: step.tool, args: step.args });
    const result = await callTool(step.tool, step.args);
    const text = result.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
    onEvent({ type: 'tool_result', name: step.tool, text, isError: Boolean(result.isError) });
    if (result.isError) return { ok: false, failedAt: i, step, error: text, remaining: steps.slice(i) };
  }
  return { ok: true };
}
