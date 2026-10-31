// Handry · © 2026 Berat Olekli (purplefox) · github.com/purplefox21/handry
// Learned tasks. When the brain finishes a command, its successful steps
// become a recipe of their own (~/.jevis/learned). Words of the command that
// the steps used (search words, a name, a price) become variables; Jev judges
// which of them are details that change from one time to the next. A later
// command asking for the same task with other details is matched by Jev in
// the router's single request, the new details are picked from the new
// command's own words (select, don't generate) and the steps replay without
// the brain.
import fs from 'node:fs';
import path from 'node:path';
import * as jev from './jev.js';
import { config } from './config.js';
import { stepsFromRun, slug, LEARNED_DIR } from './recipes.js';
import { spans } from './spans.js';
import { T } from './i18n.js';

const MAX_STEPS = 25;
const MAX_CANDIDATES = 8;
// Step fields that may carry words of the command.
const FIELDS = ['text', 'target', 'url', 'option', 'value', 'name', 'path', 'window', 'tab', 'description', 'title'];
const TYPING = new Set(['browser_type', 'desktop_type']);
const ENCODINGS = [[null, v => v], ['url', encodeURIComponent], ['plus', v => encodeURIComponent(v).replace(/%20/g, '+')]];

const lower = s => String(s).toLocaleLowerCase('tr');
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Where `needle` stands as whole words in `hay` (both already lower-cased).
function wholeWordAt(hay, needle) {
  const out = [];
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${escapeRe(needle)})(?=$|[^\\p{L}\\p{N}])`, 'gu');
  for (const m of hay.matchAll(re)) out.push(m.index + m[1].length);
  return out;
}

// In a step's value a detail stands between separators, not inside a longer token ("1" in "127.0.0.1", "10" in "2026-10-11").
const SEP_BEFORE = /[\s"“'‘(\[\/=&?#+,:$€₺]/;
const SEP_AFTER = /[\s"”'’)\]\/&?#+,.;:!]/;
const separate = (hay, i, n) => (i === 0 || SEP_BEFORE.test(hay[i - 1])) && (i + n === hay.length || SEP_AFTER.test(hay[i + n]));

const readLearned = file => JSON.parse(fs.readFileSync(path.join(LEARNED_DIR, file), 'utf-8'));

/** Learned tasks, most recently used first. */
export function listLearned() {
  if (!fs.existsSync(LEARNED_DIR)) return [];
  return fs.readdirSync(LEARNED_DIR).filter(f => f.endsWith('.json')).map(readLearned)
    .sort((a, b) => String(b.lastUsed || b.created).localeCompare(String(a.lastUsed || a.created)));
}

/**
 * Learns the task of a finished brain run. Returns { recipe } or { skipped }.
 * Skips questions and summaries (the answer is the result there, not the
 * actions), unfinished work, and texts the brain wrote itself.
 */
// String values of a step's arguments with their paths: "url", "fields.Name"…
function leaves(args, prefix = []) {
  const out = [];
  for (const [k, v] of Object.entries(args || {})) {
    if (!prefix.length && !FIELDS.includes(k) && k !== 'fields') continue;
    if (typeof v === 'string' && v) out.push({ path: [...prefix, k], value: v });
    else if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...leaves(v, [...prefix, k]));
  }
  return out;
}
const getAt = (obj, path) => path.reduce((o, k) => o?.[k], obj);
const setAt = (obj, path, value) => { const last = path.at(-1); path.slice(0, -1).reduce((o, k) => o[k], obj)[last] = value; };

/**
 * explicit: Claude says "learn this" (jevis_teach) — the work is done, so its
 * final answer isn't checked. since: only the steps from then on.
 */
export async function learnFromRun({ command, runId, answer = '', explicit = false, since = 0, lastSteps = 0 }) {
  let steps = stepsFromRun(runId, { since });
  if (lastSteps > 0) steps = steps.slice(-lastSteps);
  if (!steps.length) return { skipped: T('tekrar oynatılacak adım yok', 'no steps to replay') };
  if (steps.length > MAX_STEPS) return { skipped: T('adım sayısı çok fazla', 'too many steps') };
  if (steps.some(s => s.ask_brain)) return { skipped: T('görüntüye bakarak tıklama var', 'it clicks by looking at a screenshot') };

  // Which words of the command show up in the steps, and where.
  const uses = new Map(); // span text → [{ step, field, encoding }]
  const taken = new Map(); // "step/field" → ranges already matched by a longer span
  const all = spans(command).sort((a, b) => b.text.length - a.text.length);
  steps.forEach((step, si) => {
    for (const { path: field, value } of leaves(step.args)) {
      const hay = lower(value);
      const key = `${si}/${field.join('.')}`;
      for (const span of all) {
        for (const [encoding, encode] of ENCODINGS) {
          if (encoding && field.join('.') !== 'url') continue;
          const needle = lower(encode(span.text));
          const at = wholeWordAt(hay, needle).filter(i => separate(hay, i, needle.length) && !(taken.get(key) || []).some(([a, b]) => i < b && i + needle.length > a));
          if (!at.length) continue;
          taken.set(key, [...(taken.get(key) || []), ...at.map(i => [i, i + needle.length])]);
          uses.set(span.text, [...(uses.get(span.text) || []), { step: si, field, encoding }]);
        }
      }
    }
  });
  // Longest first; a shorter one only where it stands in the command outside every longer one
  // ("kalem" inside "Tükenmez kalem" is no detail of its own; "1" in "1 adet" is, though the address has a 1 too).
  const candidates = [];
  // where it stands on its own ("1 adet"), not inside a longer token ("127.0.0.1:1200")
  const alone = (i, n) => (i === 0 || /[\s"“'‘(\[]/.test(command[i - 1])) && (i + n === command.length || /[\s,.;:!?"”'’)\]]/.test(command[i + n]));
  for (const text of [...uses.keys()].sort((a, b) => b.length - a.length)) {
    const free = wholeWordAt(lower(command), lower(text)).filter(i => !candidates.some(c => i < c.at + c.text.length && i + text.length > c.at));
    const at = free.find(i => alone(i, text.length)) ?? free[0];
    if (at === undefined) continue;
    candidates.push({ text, at });
    if (candidates.length >= MAX_CANDIDATES) break;
  }

  const questions = {
    doing: { type: 'noul', instructions: 'Is `command` only a request to do something on the computer (the done actions are the whole result), rather than a question or a request for information, a summary, a list or a text the assistant has to come up with?' },
    succeeded: { type: 'noul', instructions: 'Does the assistant\'s `answer` say that what `command` asked for was done, without problems, open questions or missing parts? Something `command` said not to do (e.g. not to send it yet) is not a missing part.' },
    standalone: { type: 'noul', instructions: 'Is `command` complete on its own, without leaning on earlier messages (like "try again", "do it again", "the same for that one", "that file")?' },
    by_position: { type: 'noul', instructions: 'Does `command` choose something by its position, order or time (the first, the second, the 15th, the last, the newest item) rather than by its name?' }
  };
  candidates.forEach((c, i) => {
    questions[`c${i}`] = { type: 'noul', instructions: `In \`command\`, is "${c.text}" a detail that could be different the next time the same task is asked (a name, search words, a text to write, a number, a file or folder), rather than words saying what the task is (the app, the site, the action)?` };
  });
  const { answers } = await jev.ask({ command, answer: String(answer).slice(0, 1500) }, questions);
  if ((answers.doing?.noul ?? 0) < 0.5) return { skipped: T('bu bir soru ya da bilgi isteği', 'this is a question or a request for information') };
  if (!explicit && (answers.succeeded?.noul ?? 0) < 0.5) return { skipped: T('iş tam bitmemiş görünüyor', 'the task does not look fully done') };
  // "Try again" means whatever came before; "the second song" is a different song next time.
  if ((answers.standalone?.noul ?? 0) < 0.5) return { skipped: T('komut önceki mesaja bağlı', 'the command leans on an earlier message') };
  if ((answers.by_position?.noul ?? 0) >= 0.5) return { skipped: T('komut bir şeyi sırasıyla seçiyor', 'the command picks something by its position') };

  const chosen = candidates.filter((_, i) => (answers[`c${i}`]?.noul ?? 0) >= 0.5)
    .sort((a, b) => a.at - b.at)
    .map((v, i) => ({ ...v, name: `x${i + 1}` }));
  if (chosen.reduce((n, v) => n + v.text.length, 0) > 0.7 * command.replace(/\s+/g, '').length) return { skipped: T('komutun neredeyse tamamı değişken', 'almost all of the command is a detail') };

  // Put {{x1}} where the details were.
  const templated = steps.map(step => ({ ...step, args: structuredClone(step.args) }));
  for (const v of chosen) {
    for (const use of uses.get(v.text)) {
      const value = getAt(templated[use.step].args, use.field);
      if (lower(value).length !== value.length) continue;
      const encode = ENCODINGS.find(([e]) => e === use.encoding)[1];
      const needle = lower(encode(v.text));
      const at = wholeWordAt(lower(value), needle).filter(i => separate(lower(value), i, needle.length));
      let out = value;
      for (const i of at.reverse()) out = `${out.slice(0, i)}{{${v.name}${use.encoding ? `:${use.encoding}` : ''}}}${out.slice(i + needle.length)}`;
      setAt(templated[use.step].args, use.field, out);
    }
  }
  // A check's wording follows the new details too ("2 adet … kaydedildi" → "4 adet …"); it never makes a detail itself.
  for (const step of templated) {
    if (typeof step.args.expectation !== 'string') continue;
    let out = step.args.expectation;
    for (const v of chosen) {
      const at = wholeWordAt(lower(out), lower(v.text)).filter(i => separate(lower(out), i, v.text.length));
      for (const i of at.reverse()) out = `${out.slice(0, i)}{{${v.name}}}${out.slice(i + v.text.length)}`;
    }
    step.args.expectation = out;
  }
  // Typing a text the brain came up with would repeat that old text next time.
  // (Short form answers like "None" or "Free" are choices, not texts, and are replayed as they are.)
  const typedTexts = templated.flatMap(s => (TYPING.has(s.tool) && typeof s.args.text === 'string' ? [s.args.text]
    : s.tool === 'browser_fill' ? Object.values(s.args.fields || {}).filter(v => typeof v === 'string' && v.length > 40) : []));
  const invented = typedTexts.find(t => !/\{\{x\d+/.test(t) && t.trim().length > 2 && !lower(command).includes(lower(t.trim())));
  if (invented) return { skipped: T('yazılan metni Claude kendisi yazmış', 'Claude wrote the typed text itself') };
  // A date or time the command doesn't say ("bugün" → 2026-10-11) would be the old one next time.
  const DATE_TIME = /\b\d{1,4}[./-]\d{1,2}(?:[./-]\d{1,4})?\b|\b\d{1,2}:\d{2}\b/;
  const filled = templated.flatMap(s => [s.args.text, s.args.value, s.args.option, ...Object.values(s.args.fields || {})].filter(v => typeof v === 'string'));
  const dated = filled.find(v => !/\{\{x\d+/.test(v) && DATE_TIME.test(v) && !lower(command).includes(lower(v.match(DATE_TIME)[0])));
  if (dated) return { skipped: T('komutta olmayan bir tarih ya da saat yazılmış', 'a date or time the command does not say was typed') };

  let pattern = command;
  for (const v of [...chosen].reverse()) pattern = `${pattern.slice(0, v.at)}[${v.name}]${pattern.slice(v.at + v.text.length)}`;
  const hints = Object.fromEntries(chosen.map(v => [v.name, command.slice(v.at, v.at + v.text.length)]));

  fs.mkdirSync(LEARNED_DIR, { recursive: true });
  const existing = listLearned();
  // the same steps, or the same command template learned again (then the newer way wins)
  const same = existing.find(r => JSON.stringify(r.steps) === JSON.stringify(templated)) || existing.find(r => r.pattern === pattern);
  let name = same?.name || slug(pattern.replace(/\[x\d+\]/g, ' ')).slice(0, 60).replace(/-$/, '') || 'ogrenilen';
  if (!same) for (let n = 2; existing.some(r => r.name === name); n++) name = `${name.replace(/-\d+$/, '')}-${n}`;
  const recipe = {
    ...(same || { uses: 0, fails: 0, created: new Date().toISOString() }),
    name,
    learned: true,
    description: T(`Öğrenildi: "${command}"`, `Learned: "${command}"`),
    example: command,
    pattern,
    hints,
    fromRun: runId,
    steps: templated
  };
  fs.writeFileSync(path.join(LEARNED_DIR, `${name}.json`), `${JSON.stringify(recipe, null, 2)}\n`);

  // Keep the list short: forget the ones unused the longest.
  const max = config().learn?.max || 60;
  for (const old of listLearned().slice(max)) fs.rmSync(path.join(LEARNED_DIR, `${old.name}.json`), { force: true });
  return { recipe, updated: Boolean(same) };
}

/** The router's extra question: is the command one of the learned tasks? */
export function learnedQuestion(list) {
  if (!list.length) return null;
  const criteria = Object.fromEntries(list.slice(0, 100).map((r, i) => [`l${i}`, r.pattern]));
  criteria.none = 'None of them: a different task, or more or less than one of these tasks';
  return {
    type: 'choice',
    instructions: 'The assistant learned these tasks from earlier commands. Words in [brackets] are details that may differ next time (a name, search words, a text, a number). Is `command` exactly one of these tasks with only the bracketed details changed? Everything outside the brackets (the app or site, what to do, how many things) must mean the same.',
    criteria
  };
}

/**
 * The new command written like the learned one, with only the [bracketed] details different: the details are
 * read straight off it (no judging needed). A detail that swallowed a whole extra sentence doesn't count.
 */
export function alignedVars(command, recipe) {
  const parts = String(recipe.pattern || '').split(/\[(x\d+)\]/);
  if (parts.length < 3) return null;
  const literal = p => escapeRe(p.trim()).replace(/\s+/g, '\\s+');
  const re = new RegExp(`^\\s*${parts.map((p, i) => (i % 2 ? '(.+?)' : `\\s*${literal(p)}\\s*`)).join('')}\\s*$`, 'iu');
  const m = command.match(re);
  if (!m) return null;
  const vars = {};
  parts.filter((_, i) => i % 2).forEach((name, i) => { vars[name] = m[i + 1].trim(); });
  const sentence = /[.;!?](\s|$)|,\s/;
  if (Object.entries(vars).some(([name, v]) => !v || (sentence.test(v) && !sentence.test(recipe.hints?.[name] || '')))) return null;
  return vars;
}

/** The learned task the command is written exactly like (see alignedVars), or null. */
export function alignLearned(command, list = listLearned()) {
  const hits = list.map(recipe => ({ recipe, vars: alignedVars(command, recipe) })).filter(h => h.vars);
  // several with the same template: the most recently used one (the list comes in that order)
  return hits.length && hits.every(h => h.recipe.pattern === hits[0].recipe.pattern) ? hits[0] : null;
}

/**
 * The learned task the router's answer points at, with the new details taken
 * from the command. Returns { recipe, vars } or null.
 */
export async function matchLearned(command, answer, list) {
  const pick = jev.asPick(answer);
  if (pick.index === null || !jev.isConfident(pick)) return null;
  const recipe = list[pick.index];
  const aligned = alignedVars(command, recipe);
  if (aligned) return { recipe, vars: aligned };
  const names = Object.keys(recipe.hints || {});
  const options = spans(command).map(s => s.text).slice(0, 250);
  // A second, narrower look: replaying the wrong task does real things.
  const questions = {
    same_task: { type: 'noul', instructions: 'Does `command` ask for exactly the same actions as the earlier command `example`, with at most the details in [brackets] of `pattern` changed? Asking for more, less, or other steps is not the same.' }
  };
  Object.assign(questions, Object.fromEntries(names.map(v => [v, {
    type: 'choice',
    instructions: `The assistant learned the task \`pattern\` from the earlier command \`example\`, where [${v}] was "${recipe.hints[v]}". Which words of the new \`command\` fill [${v}] now? Pick exactly those words, nothing around them.`,
    criteria: { ...Object.fromEntries(options.map((t, i) => [`s${i}`, t])), none: `The new command does not say what [${v}] is` }
  }])));
  const { answers } = await jev.ask({ command, pattern: recipe.pattern, example: recipe.example }, questions);
  if ((answers.same_task?.noul ?? 0) < 0.75) return null;
  const vars = {};
  for (const v of names) {
    const p = jev.asPick(answers[v]);
    if (p.index === null || !jev.isConfident(p)) return null;
    vars[v] = options[p.index];
  }
  return { recipe, vars };
}

/** Counts a replay; a learned way that keeps failing is forgotten. */
export function recordOutcome(name, ok) {
  const file = path.join(LEARNED_DIR, `${name}.json`);
  if (!fs.existsSync(file)) return {};
  const r = JSON.parse(fs.readFileSync(file, 'utf-8'));
  if (ok) {
    r.uses = (r.uses || 0) + 1;
    r.lastUsed = new Date().toISOString();
  } else {
    r.fails = (r.fails || 0) + 1;
    if (r.fails >= 2 && r.fails > (r.uses || 0)) {
      fs.rmSync(file, { force: true });
      return { forgotten: true };
    }
  }
  fs.writeFileSync(file, `${JSON.stringify(r, null, 2)}\n`);
  return {};
}
