// Handry · © 2026 Berat Olekli (purplefox) · github.com/purplefox21/handry
// The one place that talks to TypeSafe Jev, plus the ready-made judgments
// Handry needs: which element to use, whether an action is risky, and whether
// the page is in the expected state. Without Jev (no key, or turned off) the
// same judgments come from core/nojev.js, made with words and rules.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, config, HOME } from './config.js';
import { JevisError } from './errors.js';
import { T } from './i18n.js';
import * as local from './nojev.js';

// JEVIS_JEV_URL points the client somewhere else (tests use a local stand-in).
const API_URL = process.env.JEVIS_JEV_URL || 'https://api.typesafe.ai/v1/systemone';
const NONE = 'None of these elements matches the instruction';

let apiKey;

export function getApiKey() {
  if (apiKey) return apiKey;
  apiKey = process.env.TYPESAFE_API_KEY || process.env.JEV_KEY;
  if (!apiKey) {
    for (const file of [path.join(ROOT, '.env'), path.join(HOME, '.env')]) { // ~/.jevis/.env: the downloaded app has no project folder
      try {
        const match = fs.readFileSync(file, 'utf-8').match(/(?:JEV_KEY|TYPESAFE_API_KEY)=([^\r\n]+)/);
        if (match) { apiKey = match[1].trim(); break; }
      } catch {}
    }
  }
  if (!apiKey) throw new Error(T('TypeSafe API anahtarı bulunamadı: .env dosyasına JEV_KEY=... ekleyin.', 'No TypeSafe API key found: add JEV_KEY=... to the .env file.'));
  return apiKey;
}

const hasKey = () => { try { getApiKey(); return true; } catch { return false; } };

/**
 * Handry works without Jev: when there is no key, when config jev.enabled is false, or with JEVIS_JEV=off
 * for one run (JEVIS_JEV=on insists on Jev). The judgments below then come from core/nojev.js.
 */
export function jevOff() {
  if (process.env.JEVIS_JEV === 'off') return true;
  if (process.env.JEVIS_JEV === 'on') return false;
  if (config().jev?.enabled === false) return true;
  return !hasKey();
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Busy (429, 529 "system_overloaded"), server errors and network failures are tried again after these waits.
// A busy Jev may say how long to wait (Retry-After); at most 3 s, so a click never hangs for long.
const RETRY_WAITS = [600, 1500];
const retryWait = (attempt, res) => {
  const said = Number(res?.headers?.get('retry-after')) * 1000;
  return Math.min(Math.max(RETRY_WAITS[attempt], Number.isFinite(said) ? said : 0), 3000);
};

/**
 * Raw Jev call. Throws JevisError JEV_DOWN when Jev can't be reached or stays busy
 * (callers can then go on without it), JEV_ERROR for other failures.
 */
export async function ask(state, questions) {
  if (jevOff()) throw new JevisError('JEV_OFF', local.offNote());
  const started = Date.now();
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(API_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getApiKey()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: config().jev.model, state, questions }),
        // Jev cevap vermezse araç sonsuza kadar beklemesin
        signal: AbortSignal.timeout(20000)
      });
    } catch (err) {
      if (attempt < RETRY_WAITS.length) { await sleep(retryWait(attempt)); continue; }
      throw new JevisError('JEV_DOWN', `${T("Jev'e ulaşılamadı", "Couldn't reach Jev")}: ${err.message}`);
    }
    const text = await res.text();
    if (res.ok) {
      const data = JSON.parse(text);
      return { answers: data.answers || {}, usage: data.usage, ms: Date.now() - started };
    }
    const busy = res.status === 429 || res.status >= 500;
    if (busy && attempt < RETRY_WAITS.length) { await sleep(retryWait(attempt, res)); continue; }
    throw new JevisError(busy ? 'JEV_DOWN' : 'JEV_ERROR', `${T('Jev API hatası', 'Jev API error')} (${res.status}): ${text.slice(0, 300)}`, { status: res.status });
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

/** A raw choice answer whose options are keyed "x0", "x1"… (plus "none") as a pick. */
export function asPick(answer) {
  if (!answer?.choice) return { index: null, confidence: 0, alternatives: [] };
  return { index: answer.choice === 'none' ? null : Number(answer.choice.slice(1)), confidence: answer.confidence ?? 0, alternatives: topAlternatives(answer) };
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
  if (jevOff()) return local.pickElement(instruction, labels, { withRisk, page });
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
  if (jevOff()) return local.pickOption(wanted, options);
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
  if (jevOff()) return local.checkState(expectation, page);
  const { answers, ms } = await ask({ page, expectation }, {
    holds: {
      type: 'noul',
      instructions: 'Based on the current `page` (its url, title, visible text, alerts and form controls with their values and checked states), is `expectation` true right now?'
    }
  });
  const p = answers.holds?.noul ?? 0;
  return { yes: p >= 0.5, p, ms };
}

const KIND_QUESTION = {
  type: 'choice',
  instructions: 'What kind of action is `action` (done on a computer, on behalf of its user)?',
  criteria: {
    para: 'Spends or moves money: pay, buy, place an order, subscribe, transfer, change a price or a bill.',
    silme: 'Permanently destroys something that already exists and cannot be restored: deleting an account, a project, a published post, stored data, files, or messages. NOT removing an item from a form, a draft or an upload area that is still being edited, NOT clearing a field, NOT closing a dialog.',
    disari: 'Sends or publishes something that other people will see: an email, a message, a comment, a post, a submitted form or application, a review, publishing or launching a product, saving a change to a public profile. NOT signing in: a login form or a sign-in verification code (Doğrula, Verify, Giriş yap) only lets the user into their own account.',
    yetki: 'Changes access or security settings: passwords, users, permissions, roles, API keys, turning two-step verification on or off, connecting apps, installing software. NOT entering a password or a sign-in code to log in.',
    diger: 'None of these: signing in to an account or entering a sign-in / two-step verification code, saving or editing a private draft, removing or replacing an item inside a draft or form, uploading into a draft, creating something private, searching, navigating, downloading, filling a form without submitting it.'
  }
};

/**
 * What kind of action is this (para, silme, disari, yetki, diger)? Asked together with the page, so removing an
 * image from a draft is "diger" and not "silme". Used to skip the confirmation for harmless, undoable actions.
 * When Jev can't be reached the answer is 'bilinmiyor': the caller then asks the user.
 */
export async function actionKind(action) {
  try {
    const { answers } = await ask({ action: String(action).slice(0, 1500) }, { tur: KIND_QUESTION });
    return answers.tur?.choice || 'bilinmiyor';
  } catch {
    return 'bilinmiyor';
  }
}

/** Is this action risky? Used when no element pick happened (e.g. pressing Enter). */
export async function isRisky(instruction, page = {}) {
  if (jevOff()) return { p: local.riskOf(instruction), ms: 0 };
  const { answers, ms } = await ask({ page, instruction }, { risk: { type: 'noul', instructions: RISK_INSTRUCTIONS } });
  return { p: answers.risk?.noul ?? 0, ms };
}

/**
 * Sure enough to act: high confidence, or a clear winner well ahead of every
 * other candidate. Mass on "none" is doubt, not a competing element; mixing up
 * two real elements is the mistake that matters, and risky actions are
 * confirmed by the user anyway.
 */
export function isConfident(pick) {
  const { autoThreshold, minTop, minMargin } = config().jev;
  if (pick.confidence >= autoThreshold) return true;
  const [top, ...rest] = pick.alternatives;
  if (!top || top.index === null || top.p < minTop) return false;
  const rival = rest.find(a => a.index !== null)?.p || 0;
  return top.p - rival >= minMargin;
}
