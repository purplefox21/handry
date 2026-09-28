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
export async function learnFromRun({ command, runId, answer = '' }) {
  const steps = stepsFromRun(runId);
  if (!steps.length) return { skipped: 'tekrar oynatılacak adım yok' };
  if (steps.length > MAX_STEPS) return { skipped: 'adım sayısı çok fazla' };
  if (steps.some(s => s.ask_brain)) return { skipped: 'görüntüye bakarak tıklama var' };

  // Which words of the command show up in the steps, and where.
  const uses = new Map(); // span text → [{ step, field, encoding }]
  const taken = new Map(); // "step/field" → ranges already matched by a longer span
  const all = spans(command).sort((a, b) => b.text.length - a.text.length);
  steps.forEach((step, si) => {
    for (const field of FIELDS) {
      const value = step.args?.[field];
      if (typeof value !== 'string' || !value) continue;
      const hay = lower(value);
      const key = `${si}/${field}`;
      for (const span of all) {
        for (const [encoding, encode] of ENCODINGS) {
          if (encoding && field !== 'url') continue;
          const needle = lower(encode(span.text));
          const at = wholeWordAt(hay, needle).filter(i => !(taken.get(key) || []).some(([a, b]) => i < b && i + needle.length > a));
          if (!at.length) continue;
          taken.set(key, [...(taken.get(key) || []), ...at.map(i => [i, i + needle.length])]);
          uses.set(span.text, [...(uses.get(span.text) || []), { step: si, field, encoding }]);
        }
      }
    }
  });
  // Longest first, and not a word inside a longer detail already chosen.
  const candidates = [...uses.keys()].sort((a, b) => b.length - a.length)
    .filter((t, i, list) => !list.slice(0, i).some(longer => lower(longer).includes(lower(t)))).slice(0, MAX_CANDIDATES);

  const questions = {
    doing: { type: 'noul', instructions: 'Is `command` only a request to do something on the computer (the done actions are the whole result), rather than a question or a request for information, a summary, a list or a text the assistant has to come up with?' },
    succeeded: { type: 'noul', instructions: 'Does the assistant\'s `answer` say that the task was done, without problems, open questions or missing parts?' }
  };
  candidates.forEach((c, i) => {
    questions[`c${i}`] = { type: 'noul', instructions: `In \`command\`, is "${c}" a detail that could be different the next time the same task is asked (a name, search words, a text to write, a number, a file or folder), rather than words saying what the task is (the app, the site, the action)?` };
  });
  const { answers } = await jev.ask({ command, answer: String(answer).slice(0, 1500) }, questions);
  if ((answers.doing?.noul ?? 0) < 0.5) return { skipped: 'bu bir soru ya da bilgi isteği' };
  if ((answers.succeeded?.noul ?? 0) < 0.5) return { skipped: 'iş tam bitmemiş görünüyor' };

  const chosen = candidates.filter((_, i) => (answers[`c${i}`]?.noul ?? 0) >= 0.5)
    .map(text => ({ text, at: lower(command).indexOf(lower(text)) }))
    .filter(v => v.at >= 0)
    .sort((a, b) => a.at - b.at)
    .filter((v, i, list) => !list.slice(0, i).some(u => v.at < u.at + u.text.length))
    .map((v, i) => ({ ...v, name: `x${i + 1}` }));
  if (chosen.reduce((n, v) => n + v.text.length, 0) > 0.7 * command.replace(/\s+/g, '').length) return { skipped: 'komutun neredeyse tamamı değişken' };

  // Put {{x1}} where the details were.
  const templated = steps.map(step => ({ ...step, args: { ...step.args } }));
  for (const v of chosen) {
    for (const use of uses.get(v.text)) {
      const value = templated[use.step].args[use.field];
      if (lower(value).length !== value.length) continue;
      const encode = ENCODINGS.find(([e]) => e === use.encoding)[1];
      const needle = lower(encode(v.text));
      const at = wholeWordAt(lower(value), needle);
      let out = value;
      for (const i of at.reverse()) out = `${out.slice(0, i)}{{${v.name}${use.encoding ? `:${use.encoding}` : ''}}}${out.slice(i + needle.length)}`;
      templated[use.step].args[use.field] = out;
    }
  }
  // Typing a text the brain came up with would repeat that old text next time.
  const invented = templated.find(s => TYPING.has(s.tool) && typeof s.args.text === 'string' && !/\{\{x\d+/.test(s.args.text)
    && s.args.text.trim().length > 2 && !lower(command).includes(lower(s.args.text.trim())));
  if (invented) return { skipped: 'yazılan metni Claude kendisi yazmış' };

  let pattern = command;
  for (const v of [...chosen].reverse()) pattern = `${pattern.slice(0, v.at)}[${v.name}]${pattern.slice(v.at + v.text.length)}`;
  const hints = Object.fromEntries(chosen.map(v => [v.name, command.slice(v.at, v.at + v.text.length)]));

  fs.mkdirSync(LEARNED_DIR, { recursive: true });
  const existing = listLearned();
  const same = existing.find(r => JSON.stringify(r.steps) === JSON.stringify(templated));
  let name = same?.name || slug(pattern.replace(/\[x\d+\]/g, ' ')).slice(0, 60).replace(/-$/, '') || 'ogrenilen';
  if (!same) for (let n = 2; existing.some(r => r.name === name); n++) name = `${name.replace(/-\d+$/, '')}-${n}`;
  const recipe = {
    ...(same || { uses: 0, fails: 0, created: new Date().toISOString() }),
    name,
    learned: true,
    description: `Öğrenildi: "${command}"`,
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
    instructions: 'JEVIS learned these tasks from earlier commands. Words in [brackets] are details that may differ next time (a name, search words, a text, a number). Is `command` exactly one of these tasks with only the bracketed details changed? Everything outside the brackets (the app or site, what to do, how many things) must mean the same.',
    criteria
  };
}

/**
 * The learned task the router's answer points at, with the new details taken
 * from the command. Returns { recipe, vars } or null.
 */
export async function matchLearned(command, answer, list) {
  const pick = jev.asPick(answer);
  if (pick.index === null || !jev.isConfident(pick)) return null;
  const recipe = list[pick.index];
  const names = Object.keys(recipe.hints || {});
  if (!names.length) return { recipe, vars: {} };
  const options = spans(command).map(s => s.text).slice(0, 250);
  const questions = Object.fromEntries(names.map(v => [v, {
    type: 'choice',
    instructions: `JEVIS learned the task \`pattern\` from the earlier command \`example\`, where [${v}] was "${recipe.hints[v]}". Which words of the new \`command\` fill [${v}] now? Pick exactly those words, nothing around them.`,
    criteria: { ...Object.fromEntries(options.map((t, i) => [`s${i}`, t])), none: `The new command does not say what [${v}] is` }
  }]));
  const { answers } = await jev.ask({ command, pattern: recipe.pattern, example: recipe.example }, questions);
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
