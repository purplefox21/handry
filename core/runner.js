// Runs one user command: a recipe ("tarif: isim"), the Jev fast path, or the
// chosen brain. Shared by the chat server and the CLI (`do`, `listen --do`).
import { config, saveState } from './config.js';
import { tryFast } from './router.js';
import { runRecipe, listRecipes, slug } from './recipes.js';
import { learnFromRun, recordOutcome } from './learn.js';
import { getBrain } from '../brain/index.js';
import { clearStop } from '../guard/stop.js';

// Brains get the local date and time with each message ("yarın 9'da" needs
// it). It rides in the message, not the system prompt, so prompt caching holds.
const withNow = text => `${text}\n\n[Şu an: ${new Date().toLocaleString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}]`;

// "tarif: sabah-rutini isim=Berat site=example.com"
function recipeCall(text) {
  const m = text.trim().match(/^(?:tarif|recipe)\s*[:\-]?\s*(\S+)(.*)$/i);
  const name = m ? m[1] : text.trim();
  if (!listRecipes().some(r => r.name === slug(name))) return null;
  const vars = Object.fromEntries([...(m?.[2] || '').matchAll(/(\w+)=("[^"]*"|\S+)/g)].map(([, k, v]) => [k, v.replace(/^"|"$/g, '')]));
  return { name, vars };
}

/** Replays a recipe; if a step fails, the brain continues from there. */
export async function runRecipeWithHandoff({ name, vars, brain, sessionId, onEvent, signal, model, effort, doneText }) {
  let session = sessionId;
  const askBrain = async prompt => {
    const out = await brain.run({ text: prompt, sessionId: session, onEvent, signal, model, effort });
    session = out.sessionId;
    return out;
  };
  const res = await runRecipe(name, { vars, onEvent, signal, askBrain });
  if (res.ok || res.stopped) return { text: res.ok ? (doneText || `"${name}" tarifi bitti.`) : 'Durduruldu.', sessionId: session, stopped: res.stopped, ok: res.ok };
  onEvent({ type: 'status', text: `Tarif ${res.failedAt + 1}. adımda takıldı; ${brain.label} kaldığı yerden devam ediyor.` });
  const out = await askBrain([
    `"${name}" tarifini adım adım çalıştırıyordum. ${res.failedAt + 1}. adım olmadı:`,
    `${JSON.stringify(res.step)} → ${res.error}`,
    `Yapılması gereken kalan adımlar: ${JSON.stringify(res.remaining)}`,
    'Sayfaya ya da uygulamaya bakıp kalan adımları tamamla. Sayfa değişmiş olabilir; aynı amaca giden yolu bul.'
  ].join('\n'));
  return { text: out.text, sessionId: out.sessionId, handedOff: true };
}

export async function runCommand({ text, brainId = config().brain.default, sessionId, fast = true, model, effort, onEvent, signal, brainOverride }) {
  const started = Date.now();
  const runId = `run-${Date.now().toString(36)}`;
  const previousRun = process.env.JEVIS_RUN_ID;
  process.env.JEVIS_RUN_ID = runId; // every logged action of this run carries it
  saveState({ lastRunId: runId });
  clearStop(); // a new command from the user means "go on"
  const finish = (out, extra = {}) => ({ type: 'done', runId, ms: Date.now() - started, ...out, ...extra });
  try {
    const recipe = recipeCall(text);
    if (recipe) {
      const out = await runRecipeWithHandoff({ ...recipe, brain: getBrain(brainId), sessionId, onEvent, signal, model, effort });
      return finish(out, { recipe: recipe.name, brain: brainId, stopped: Boolean(out.stopped) });
    }
    const brainFor = () => brainOverride || getBrain(brainId);
    const learning = fast && config().learn?.enabled !== false;
    if (fast) {
      const quick = await tryFast(text, onEvent);
      if (quick.handled) return finish({ text: quick.text }, { fast: true });
      if (quick.learned && learning) {
        const { recipe, vars } = quick.learned;
        const brain = brainFor();
        const out = await runRecipeWithHandoff({ name: recipe.name, vars, brain, sessionId, onEvent, signal, model, effort, doneText: 'Tamam, öğrendiğim yoldan yaptım.' });
        if (!out.stopped) recordOutcome(recipe.name, Boolean(out.ok));
        return finish(out, { recipe: recipe.name, learnedReplay: true, brain: out.handedOff ? brain.id : undefined, stopped: Boolean(out.stopped) });
      }
      if (quick.note) onEvent({ type: 'status', text: quick.note });
    }
    const brain = brainFor();
    onEvent({ type: 'status', text: `${brain.label} düşünüyor…` });
    const out = await brain.run({ text: withNow(text), sessionId, onEvent, signal, model, effort });
    const usedModel = brain.id === 'claude-code' ? (model || config().brain.providers['claude-code']?.model) : undefined;
    // Next time the same task (with other details) runs without the brain.
    let learned;
    if (learning && !out.stopped && !signal?.aborted) {
      const res = await learnFromRun({ command: text, runId, answer: out.text }).catch(err => ({ skipped: err.message }));
      learned = res.recipe ? { name: res.recipe.name, pattern: res.recipe.pattern, updated: res.updated } : { skipped: res.skipped };
    }
    return finish({ text: out.text, sessionId: out.sessionId }, { brain: brain.id, model: usedModel, stopped: Boolean(out.stopped), learned });
  } finally {
    if (previousRun === undefined) delete process.env.JEVIS_RUN_ID;
    else process.env.JEVIS_RUN_ID = previousRun;
  }
}
