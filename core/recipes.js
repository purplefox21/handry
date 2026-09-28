// Recipes: a successful run saved as its tool steps, replayed later without
// a brain (Jev still finds each element, so small page changes don't break
// it). Steps may use {{variables}} and "ask_brain" steps for the parts that
// need thinking; when a step fails the caller can hand the rest to a brain.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';
import { callTool } from './tools.js';
import { actionsOfRun } from '../guard/log.js';

const DIR = path.join(ROOT, 'recipes');

// Tools that change something; reads and screenshots aren't replayed.
const REPLAYABLE = new Set([
  'browser_open', 'browser_click', 'browser_type', 'browser_select', 'browser_check', 'browser_upload',
  'browser_press', 'browser_scroll', 'browser_back', 'browser_tabs', 'browser_fill_secret', 'browser_wait', 'browser_verify',
  'wait_for_user', 'desktop_open_app', 'desktop_quit_app', 'desktop_click', 'desktop_type', 'desktop_key', 'mac_action',
  'desktop_focus_window', 'desktop_wait', 'desktop_click_at'
]);

// Roles the desktop tools press by name (a click at a point on one of these
// replays as a click on its name, which survives window moves and resizes).
const PRESSABLE = new Set(['Button', 'Link', 'MenuItem', 'Cell', 'Row', 'Tab', 'CheckBox', 'RadioButton', 'PopUpButton', 'MenuButton', 'DisclosureTriangle', 'Switch', 'Toggle']);

export function slug(name) {
  const map = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' };
  return String(name).toLowerCase().replace(/[çğıöşü]/g, c => map[c]).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const fileOf = name => path.join(DIR, `${slug(name)}.json`);
const varsIn = steps => [...new Set(JSON.stringify(steps).match(/\{\{(\w+)\}\}/g)?.map(v => v.slice(2, -2)) || [])];

export function listRecipes() {
  if (!fs.existsSync(DIR)) return [];
  return fs.readdirSync(DIR).filter(f => f.endsWith('.json')).map(f => {
    const r = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf-8'));
    return { name: r.name, description: r.description || '', steps: r.steps.length, vars: varsIn(r.steps), hints: r.hints || {} };
  });
}

export function loadRecipe(name) {
  const file = fileOf(name);
  if (!fs.existsSync(file)) throw new Error(`"${name}" adında bir tarif yok.`);
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

export function deleteRecipe(name) {
  fs.rmSync(fileOf(name), { force: true });
}

/** Turns the logged, successful actions of a run into a recipe. */
export function saveFromRun(name, runId, { description = '' } = {}) {
  const steps = [];
  for (const e of actionsOfRun(runId)) {
    if (!e.ok || !REPLAYABLE.has(e.tool)) continue;
    if (e.tool === 'browser_tabs' && e.args.action === 'list') continue;
    const args = { ...e.args };
    if (e.tool === 'desktop_click_at') {
      const hit = e.summary.match(/altında \[(\w+)\] (.+)$/m);
      if (hit && PRESSABLE.has(hit[1]) && hit[2] !== '(isimsiz)') steps.push({ tool: 'desktop_click', args: { target: hit[2] } });
      else steps.push({ ask_brain: `Ekranda şuna tıkla: ${args.description} (desktop_screenshot, sonra desktop_click_at).` });
      continue;
    }
    // "#12" only meant something on that page load; keep the element's name instead.
    if (typeof args.target === 'string' && /^#/.test(args.target)) {
      const named = e.summary.match(/Öğe: "([^"]+)"/);
      if (named) args.target = named[1];
    }
    steps.push({ tool: e.tool, args });
  }
  if (!steps.length) throw new Error('Bu işte tekrar oynatılabilecek bir adım yok.');
  const recipe = { name: slug(name), description, created: new Date().toISOString(), fromRun: runId, steps };
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(fileOf(name), `${JSON.stringify(recipe, null, 2)}\n`);
  return recipe;
}

function fill(value, vars) {
  if (typeof value === 'string') return value.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));
  if (Array.isArray(value)) return value.map(v => fill(v, vars));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, vars)]));
  return value;
}

/**
 * Replays a recipe. askBrain(prompt) handles "ask_brain" steps. Returns
 * { ok: true } or { ok: false, failedAt, step, error, remaining }.
 */
export async function runRecipe(name, { vars = {}, onEvent = () => {}, signal, askBrain } = {}) {
  const recipe = loadRecipe(name);
  const missing = varsIn(recipe.steps).filter(v => !(v in vars));
  if (missing.length) throw new Error(`Tarif şu değerleri istiyor: ${missing.join(', ')} (ör. --var=${missing[0]}=…)`);
  const steps = fill(recipe.steps, vars);
  onEvent({ type: 'status', text: `📌 "${recipe.name}" tarifi: ${steps.length} adım, beyin kullanılmadan` });
  for (let i = 0; i < steps.length; i++) {
    if (signal?.aborted) return { ok: false, stopped: true, failedAt: i };
    const step = steps[i];
    if (step.ask_brain) {
      if (!askBrain) return { ok: false, failedAt: i, step, error: 'Bu adım bir beyin gerektiriyor.', remaining: steps.slice(i) };
      onEvent({ type: 'status', text: `🧠 Tarifin düşünme adımı: ${step.ask_brain}` });
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
