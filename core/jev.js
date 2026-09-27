// The one place that talks to TypeSafe Jev, plus the ready-made judgments
// JEVIS needs: which element to use, whether an action is risky, and whether
// the page is in the expected state.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, config } from './config.js';

const API_URL = 'https://api.typesafe.ai/v1/systemone';
const NONE = 'None of these elements matches the instruction';

let apiKey;

export function getApiKey() {
  if (apiKey) return apiKey;
  apiKey = process.env.TYPESAFE_API_KEY || process.env.JEV_KEY;
  if (!apiKey) {
    try {
      const match = fs.readFileSync(path.join(ROOT, '.env'), 'utf-8').match(/(?:JEV_KEY|TYPESAFE_API_KEY)=([^\r\n]+)/);
      if (match) apiKey = match[1].trim();
    } catch {}
  }
  if (!apiKey) throw new Error('TypeSafe API anahtarı bulunamadı: .env dosyasına JEV_KEY=... ekleyin.');
  return apiKey;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Raw Jev call. Retries once on rate limits, server errors and network failures. */
export async function ask(state, questions) {
  const started = Date.now();
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(API_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getApiKey()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: config().jev.model, state, questions })
      });
    } catch (err) {
      if (attempt === 0) { await sleep(400); continue; }
      throw new Error(`Jev'e ulaşılamadı: ${err.message}`);
    }
    const text = await res.text();
    if (res.ok) {
      const data = JSON.parse(text);
      return { answers: data.answers || {}, usage: data.usage, ms: Date.now() - started };
    }
    if (attempt === 0 && (res.status === 429 || res.status >= 500)) { await sleep(600); continue; }
    throw new Error(`Jev API hatası (${res.status}): ${text.slice(0, 300)}`);
  }
}

const PICK_INSTRUCTIONS = 'Which on-screen element should be used to carry out `instruction` on this `page`? Each option is one element written as "[role] name — surrounding text {state}".';
const RISK_INSTRUCTIONS = 'Would carrying out `instruction` on this `page` send, submit, publish, delete, pay, buy, change a price, or make another change that is hard to undo or that other people will see?';

function topAlternatives(answer) {
  return Object.entries(answer.probabilities || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([key, p]) => ({ index: key === 'none' ? null : Number(key.slice(1)), p }));
}

function choiceQuestion(entries) {
  const criteria = Object.fromEntries(entries.map(([i, label]) => [`e${i}`, label]));
  criteria.none = NONE;
  return { type: 'choice', instructions: PICK_INSTRUCTIONS, criteria };
}

/**
 * Picks the element that matches a natural-language instruction.
 * labels: array of element descriptions. Returns
 * { index|null, confidence, alternatives:[{index,p}], risk (0-1|null), ms, tokens }.
 * More than `maxChoices` candidates are split into groups asked in parallel,
 * then the group winners compete in a second, small question.
 */
export async function pickElement(instruction, labels, page = {}, { withRisk = false } = {}) {
  const max = config().jev.maxChoices;
  const state = { page, instruction };
  const indexed = labels.map((label, i) => [i, label]);
  const groups = [];
  for (let s = 0; s < indexed.length; s += max) groups.push(indexed.slice(s, s + max));

  const questions = {};
  groups.forEach((group, gi) => { questions[`g${gi}`] = choiceQuestion(group); });
  if (withRisk) questions.risk = { type: 'noul', instructions: RISK_INSTRUCTIONS };

  const first = await ask(state, questions);
  let tokens = first.usage?.input_tokens || 0;
  let ms = first.ms;
  const risk = withRisk ? (first.answers.risk?.noul ?? null) : null;

  const answers = groups.map((_, gi) => first.answers[`g${gi}`]).filter(Boolean);
  const winners = answers.filter(a => a.choice !== 'none');

  let final;
  if (groups.length === 1 || winners.length <= 1) {
    final = winners[0] || answers[0];
  } else {
    const round2 = await ask(state, {
      g: choiceQuestion(winners.map(a => { const i = Number(a.choice.slice(1)); return [i, labels[i]]; }))
    });
    tokens += round2.usage?.input_tokens || 0;
    ms += round2.ms;
    final = round2.answers.g;
  }

  if (!final) return { index: null, confidence: 0, alternatives: [], risk, ms, tokens };
  return {
    index: final.choice === 'none' ? null : Number(final.choice.slice(1)),
    confidence: final.confidence ?? 0,
    alternatives: topAlternatives(final),
    risk,
    ms,
    tokens
  };
}

const OPTION_INSTRUCTIONS = 'Which option of `field` means the same as `wanted`? `wanted` may be written in another language (often Turkish) than the options.';

/** Picks the option that matches `wanted` (dropdown entries, tabs...). Same result shape as pickElement. */
export async function pickOption(field, wanted, options) {
  const criteria = Object.fromEntries(options.map((o, i) => [`e${i}`, o]));
  criteria.none = 'None of the options matches';
  const { answers, ms, usage } = await ask({ field, wanted }, { pick: { type: 'choice', instructions: OPTION_INSTRUCTIONS, criteria } });
  const a = answers.pick;
  return {
    index: a.choice === 'none' ? null : Number(a.choice.slice(1)),
    confidence: a.confidence ?? 0,
    alternatives: topAlternatives(a),
    risk: null,
    ms,
    tokens: usage?.input_tokens || 0
  };
}

/** Does the page (url/title/text/alerts) show that `expectation` holds? */
export async function checkState(expectation, page) {
  const { answers, ms } = await ask({ page, expectation }, {
    holds: {
      type: 'noul',
      instructions: 'Based on the current `page` (its url, title, visible text, alerts and form controls with their values and checked states), is `expectation` true right now?'
    }
  });
  const p = answers.holds?.noul ?? 0;
  return { yes: p >= 0.5, p, ms };
}

/** Is this action risky? Used when no element pick happened (e.g. pressing Enter). */
export async function isRisky(instruction, page = {}) {
  const { answers, ms } = await ask({ page, instruction }, { risk: { type: 'noul', instructions: RISK_INSTRUCTIONS } });
  return { p: answers.risk?.noul ?? 0, ms };
}
