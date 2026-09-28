// Pieces of a command ("select, don't generate"): every run of a few words,
// so Jev can pick the exact words that name something (a song, a note's
// text, a search) instead of an LLM writing them.
import * as jev from './jev.js';

/** The command's words with their positions; quotes and trailing punctuation left out. */
function words(command) {
  const out = [];
  for (const m of command.matchAll(/\S+/g)) {
    const lead = m[0].match(/^["“”'‘’(\[]*/)[0].length;
    const w = m[0].slice(lead).replace(/[,.;:!?"“”'‘’)\]]+$/, '');
    if (w) out.push({ w, start: m.index + lead, end: m.index + lead + w.length });
  }
  return out;
}

/** Every run of up to `maxWords` words, plus "Tarkan" for "Tarkan'ı" (Turkish suffixes). */
export function spans(command, maxWords = 8) {
  const ws = words(command);
  const out = [];
  const seen = new Set();
  const add = (start, end) => {
    const text = command.slice(start, end);
    // A detail doesn't run across punctuation or quotes ("$1.99" keeps its dot).
    if (text.length < 2 || seen.has(text) || /[,;:!?"“”]|\.(\s|$)/.test(text)) return;
    seen.add(text);
    out.push({ text, start, end });
  };
  for (let i = 0; i < ws.length; i++) {
    for (let j = i; j < Math.min(ws.length, i + maxWords); j++) {
      add(ws[i].start, ws[j].end);
      const apostrophe = ws[j].w.search(/['’]/);
      if (apostrophe > 0) add(ws[i].start, ws[j].start + apostrophe);
    }
  }
  return out;
}

/**
 * The words of `command` that answer `question` (e.g. "what should be
 * played?"), picked by Jev among the command's own word runs; null when Jev
 * is not sure or the command doesn't say.
 */
export async function pickSpan(command, question, { maxWords = 8 } = {}) {
  const options = spans(command, maxWords).map(s => s.text).slice(0, 250);
  if (!options.length) return null;
  const criteria = Object.fromEntries(options.map((t, i) => [`s${i}`, t]));
  criteria.none = 'The command does not say it';
  const { answers } = await jev.ask({ command }, { span: { type: 'choice', instructions: `${question} Pick exactly those words of \`command\`, nothing around them.`, criteria } });
  const pick = jev.asPick(answers.span);
  return pick.index !== null && jev.isConfident(pick) ? options[pick.index] : null;
}
