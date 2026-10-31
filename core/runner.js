// Runs one user command: a recipe ("tarif: isim"), the Jev fast path, or the
// chosen brain. Shared by the chat server and the CLI (`do`, `listen --do`).
import { config, saveState } from './config.js';
import { tryFast } from './router.js';
import { runRecipe, listRecipes, slug } from './recipes.js';
import { learnFromRun, recordOutcome } from './learn.js';
import { getBrain } from '../brain/index.js';
import { clearStop } from '../guard/stop.js';
import { setActivity } from './activity.js';
import { currentChat, newChat, addUser, addAnswer, brainTurn, brainDone, stepText, NEW_CHAT } from './chats.js';
import * as desktop from '../hands/desktop.js';
import { APP_NAME } from './brand.js';
import { T } from './i18n.js';

// Brains get the local date and time with each message ("yarın 9'da" needs
// it). It rides in the message, not the system prompt, so prompt caching holds.
const withNow = text => T(
  `${text}\n\n[Şu an: ${new Date().toLocaleString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}]`,
  `${text}\n\n[Now: ${new Date().toLocaleString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' }).replace(/\u202f/g, ' ')}]`
);

const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/**
 * What is on screen now, told to the brain with each message: the front app
 * and window, and the Handry Chrome tab (Chrome is only asked, never started).
 */
async function screenNow() {
  const parts = [];
  const front = await desktop.frontmost().catch(() => null);
  if (front?.app) parts.push(`${T('önde', 'in front:')} ${front.app}${front.window ? ` — "${clip(front.window, 60)}"` : ''}`);
  try {
    const tabs = await (await fetch(`http://127.0.0.1:${config().browser.cdpPort}/json/list`, { signal: AbortSignal.timeout(600) })).json();
    const ui = process.env.JEVIS_UI_PORT ? `:${process.env.JEVIS_UI_PORT}/` : null;
    const tab = tabs.find(t => t.type === 'page' && !/^(devtools|chrome-extension|chrome):/.test(t.url) && !(ui && t.url.includes(ui)));
    if (tab) parts.push(T(`${APP_NAME} Chrome'da açık sekme "${clip(tab.title, 60)}" (${clip(tab.url, 90)})`, `open tab in ${APP_NAME}'s Chrome: "${clip(tab.title, 60)}" (${clip(tab.url, 90)})`));
  } catch {}
  return parts.join('; ');
}

// "Claude (Sonnet 5.5)" rather than the name of the program Claude runs in.
const MODEL_NAMES = { 'claude-sonnet-5-5': 'Sonnet 5.5', 'claude-sonnet-5': 'Sonnet 5', 'claude-opus-5-5': 'Opus 5.5', 'claude-haiku-4-5': 'Haiku 4.5' };
function thinker(brain, model) {
  if (brain.id !== 'claude-code') return brain.label;
  const id = model || config().brain.providers['claude-code']?.model;
  return `Claude (${MODEL_NAMES[id] || id || T('abonelik', 'subscription')})`;
}

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
  if (res.ok || res.stopped) return { text: res.ok ? (doneText || T(`"${name}" tarifi bitti.`, `The "${name}" recipe is done.`)) : T('Durduruldu.', 'Stopped.'), sessionId: session, stopped: res.stopped, ok: res.ok };
  onEvent({ type: 'status', text: T(`Tarif ${res.failedAt + 1}. adımda takıldı; ${brain.label} kaldığı yerden devam ediyor.`, `The recipe got stuck at step ${res.failedAt + 1}; ${brain.label} goes on from there.`) });
  const out = await askBrain(T([
    `"${name}" tarifini adım adım çalıştırıyordum. ${res.failedAt + 1}. adım olmadı:`,
    `${JSON.stringify(res.step)} → ${res.error}`,
    `Yapılması gereken kalan adımlar: ${JSON.stringify(res.remaining)}`,
    'Sayfaya ya da uygulamaya bakıp kalan adımları tamamla. Sayfa değişmiş olabilir; aynı amaca giden yolu bul.'
  ], [
    `I was running the "${name}" recipe step by step. Step ${res.failedAt + 1} did not work:`,
    `${JSON.stringify(res.step)} → ${res.error}`,
    `Steps still to do: ${JSON.stringify(res.remaining)}`,
    'Look at the page or the app and finish the remaining steps. The page may have changed; find the way to the same goal.'
  ]).join('\n'));
  return { text: out.text, sessionId: out.sessionId, handedOff: true };
}

const sources = () => T(
  { bar: 'çubuk', window: 'pencere', voice: 'ses', cli: 'terminal', timer: 'zamanlayıcı', phone: 'telefon (iMessage)' },
  { bar: 'bar', window: 'window', voice: 'voice', cli: 'terminal', timer: 'timer', phone: 'phone (iMessage)' }
);

/**
 * chat: false keeps the command out of the chats (tests, jevis_do from other
 * Claude sessions). chatId picks a chat; otherwise the current one is used.
 */
export async function runCommand({ text, brainId = config().brain.default, sessionId, fast = true, model, effort, onEvent = () => {}, signal, brainOverride, chatId, switchChat = true, source, chat: useChat = process.env.JEVIS_NO_CHAT !== '1' }) {
  const started = Date.now();
  const runId = `run-${Date.now().toString(36)}`;
  const finish = (out, extra = {}) => ({ type: 'done', runId, ms: Date.now() - started, ...out, ...extra });
  // "Yeni sohbet": a clean page, nothing else to do.
  if (useChat && NEW_CHAT.test(text)) {
    const fresh = newChat();
    return finish({ text: T('Yeni sohbet açıldı. Ne yapayım?', 'New chat started. What should I do?') }, { newChat: true, chat: { id: fresh.id, title: T('Yeni sohbet', 'New chat') } });
  }
  const previousRun = process.env.JEVIS_RUN_ID;
  process.env.JEVIS_RUN_ID = runId; // every logged action of this run carries it
  saveState({ lastRunId: runId });
  clearStop(); // a new command from the user means "go on"
  const chat = useChat ? currentChat(chatId, { switchTo: switchChat }) : null;
  // Who is asking, for the action log: the app itself and where the command came from.
  const previousCaller = process.env.JEVIS_CALLER;
  process.env.JEVIS_CALLER = `${APP_NAME} · ${sources()[source] || source || T('komut', 'command')}`;
  const previousChat = process.env.JEVIS_CHAT_ID;
  if (chat) process.env.JEVIS_CHAT_ID = chat.id; // a timer set now remembers the chat it was asked in
  else delete process.env.JEVIS_CHAT_ID;
  if (chat) addUser(chat, text, source);
  const steps = [];
  const emit = ev => { if (ev.type === 'tool') steps.push(stepText(ev.name, ev.args)); onEvent(ev); };
  // Into the chat, with how it was done; the answer names the chat.
  const record = (done, via) => {
    setActivity(done.stopped ? 'idle' : 'done');
    if (!chat) return done;
    addAnswer(chat, { text: done.text || '', via, steps, ms: done.ms, runId, model: done.model, ok: !done.stopped });
    return { ...done, chat: { id: chat.id, title: chat.title } };
  };
  try {
    const recipe = recipeCall(text);
    if (recipe) {
      const out = await runRecipeWithHandoff({ ...recipe, brain: getBrain(brainId), onEvent: emit, signal, model, effort });
      return record(finish(out, { recipe: recipe.name, brain: brainId, stopped: Boolean(out.stopped) }), 'recipe');
    }
    const brainFor = () => brainOverride || getBrain(brainId);
    const learning = fast && config().learn?.enabled !== false;
    if (fast) {
      // What Handry said just before, so an answer to it isn't taken for a new command.
      const before = chat?.entries.slice(0, -1).findLast(e => e.role === 'jevis');
      const previous = before && Date.now() - before.at < 10 * 60 * 1000 ? String(before.text || '').slice(0, 400) : '';
      const quick = await tryFast(text, emit, { previous });
      if (quick.handled) return record(finish({ text: quick.text }, { fast: true }), 'fast');
      if (quick.learned && learning) {
        const { recipe: task, vars } = quick.learned;
        const brain = brainFor();
        const out = await runRecipeWithHandoff({ name: task.name, vars, brain, onEvent: emit, signal, model, effort, doneText: T('Tamam, öğrendiğim yoldan yaptım.', 'Done, the way I learned it.') });
        if (!out.stopped) recordOutcome(task.name, Boolean(out.ok));
        return record(finish(out, { recipe: task.name, learnedReplay: true, brain: out.handedOff ? brain.id : undefined, stopped: Boolean(out.stopped) }), 'learned');
      }
      if (quick.note) emit({ type: 'status', text: quick.note });
    }
    const brain = brainFor();
    const usedModel = brain.id === 'claude-code' ? (model || config().brain.providers['claude-code']?.model) : undefined;
    emit({ type: 'status', text: T(`${thinker(brain, model)} düşünüyor…`, `${thinker(brain, model)} is thinking…`) });
    setActivity('thinking');
    // The chat's own session, told what happened without it and what is on screen now.
    const key = `${brain.id}|${usedModel || model || ''}`;
    const turn = chat ? brainTurn(chat, text, { key, screen: await screenNow() }) : { message: text, sessionId, fresh: !sessionId };
    const out = await brain.run({ text: withNow(turn.message), sessionId: turn.sessionId, onEvent: emit, signal, model, effort });
    if (chat) brainDone(chat, { sessionId: out.sessionId, key, fresh: turn.fresh });
    // Next time the same task (with other details) runs without the brain.
    let learned;
    if (learning && !out.stopped && !signal?.aborted) {
      const res = await learnFromRun({ command: text, runId, answer: out.text }).catch(err => ({ skipped: err.message }));
      learned = res.recipe ? { name: res.recipe.name, pattern: res.recipe.pattern, updated: res.updated } : { skipped: res.skipped };
    }
    return record(finish({ text: out.text, sessionId: out.sessionId }, { brain: brain.id, model: usedModel, stopped: Boolean(out.stopped), learned }), 'brain');
  } catch (err) {
    setActivity(signal?.aborted ? 'idle' : 'error');
    if (chat) addAnswer(chat, { text: signal?.aborted ? T('Durduruldu.', 'Stopped.') : T(`Olmadı: ${err.message}`, `That did not work: ${err.message}`), via: 'error', steps, runId, ok: false });
    throw err;
  } finally {
    if (previousRun === undefined) delete process.env.JEVIS_RUN_ID;
    else process.env.JEVIS_RUN_ID = previousRun;
    if (previousChat === undefined) delete process.env.JEVIS_CHAT_ID;
    else process.env.JEVIS_CHAT_ID = previousChat;
    if (previousCaller === undefined) delete process.env.JEVIS_CALLER;
    else process.env.JEVIS_CALLER = previousCaller;
  }
}
