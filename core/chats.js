// Handry · © 2026 Berat Olekli (purplefox) · github.com/purplefox21/handry
// Chats. Everything said to Handry goes into the current chat, whether it
// comes from the bar, the big window, voice or the terminal. Each chat has
// its own Claude session, so follow-ups ("bunu", "bi daha dene") are
// understood, and Handry keeps that session healthy:
//   - what Handry did without Claude (fast path, learned tasks, recipes) is
//     told to Claude with the next message it gets ("Sen yokken…");
//   - every message carries what is on screen right now, so Claude never
//     works from an old picture;
//   - every ROTATE_TURNS turns, or when the model changes, Claude starts a
//     fresh session with Handry's own summary of the chat (no extra LLM call),
//     so a long chat doesn't get slower or pricier;
//   - "yeni sohbet" / "yeni konu", or 2 hours of silence, starts a new chat;
//     old chats stay in the list and can be picked up again.
// Chats live in ~/.jevis/chats/<id>.json.
import fs from 'node:fs';
import path from 'node:path';
import { homeDir, loadState, saveState } from './config.js';
import { APP, APP_NAME } from './brand.js';
import { T } from './i18n.js';

export const ROTATE_TURNS = 12;
export const IDLE_MS = 2 * 60 * 60 * 1000;
const MAX_CHATS = 100;
const SUMMARY_EXCHANGES = 10;

export const NEW_CHAT = /^\s*(yeni\s+(bir\s+)?(sohbet|konu)(\s+(aç|başlat|başlayalım))?|new\s+chat|((let'?s\s+)?(start|open)\s+(a\s+)?)?new\s+(chat|conversation|topic)|start\s+over)\s*[.!]*\s*$/i;

const dir = () => homeDir('chats');
const fileOf = id => path.join(dir(), `${String(id).replace(/[^\w-]/g, '')}.json`);
const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const hhmm = t => T(new Date(t).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }), new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\u202f/g, ' '));
const via = v => T({ fast: 'hızlı yol', learned: 'öğrenilmiş iş', recipe: 'tarif', brain: 'Claude' }, { fast: 'fast path', learned: 'learned task', recipe: 'recipe', brain: 'Claude' })[v];

export function loadChat(id) {
  if (!id) return null;
  try { return JSON.parse(fs.readFileSync(fileOf(id), 'utf-8')); } catch { return null; }
}

function save(chat) {
  chat.updated = Date.now();
  fs.writeFileSync(fileOf(chat.id), JSON.stringify(chat, null, 1));
}

export function newChat() {
  const now = Date.now();
  const chat = { id: `c${now.toString(36)}${Math.random().toString(36).slice(2, 4)}`, title: '', created: now, updated: now, claude: null, entries: [] };
  save(chat);
  saveState({ chat: chat.id });
  for (const old of listChats().slice(MAX_CHATS)) fs.rmSync(fileOf(old.id), { force: true });
  return chat;
}

export function listChats() {
  return fs.readdirSync(dir()).filter(f => f.endsWith('.json')).map(f => {
    try {
      const c = JSON.parse(fs.readFileSync(path.join(dir(), f), 'utf-8'));
      return { id: c.id, title: c.title || T('Yeni sohbet', 'New chat'), created: c.created, updated: c.updated, count: c.entries.filter(e => e.role === 'user').length };
    } catch {
      return null;
    }
  }).filter(Boolean).sort((a, b) => b.updated - a.updated);
}

/**
 * The chat to use: the given one, else the current one unless it has been
 * quiet for 2 hours. switchTo: false writes to the given chat without making
 * it the current one (a timer's result goes back to where it was asked).
 */
export function currentChat(id, { switchTo = true } = {}) {
  const asked = loadChat(id);
  if (asked) {
    if (switchTo && loadState().chat !== asked.id) saveState({ chat: asked.id });
    return asked;
  }
  const current = loadChat(loadState().chat);
  if (current && (!current.entries.length || Date.now() - current.updated < IDLE_MS)) return current;
  return newChat();
}

/** The current chat without starting a new one (for showing it). */
export function peekChat() {
  return loadChat(loadState().chat);
}

export function switchChat(id) {
  const chat = loadChat(id);
  if (!chat) throw new Error(T('Böyle bir sohbet yok.', 'There is no such chat.'));
  saveState({ chat: chat.id });
  return chat;
}

export function deleteChat(id) {
  fs.rmSync(fileOf(id), { force: true });
  if (loadState().chat === id) saveState({ chat: null });
}

export function addUser(chat, text, source) {
  chat.entries.push({ at: Date.now(), role: 'user', text, source });
  if (!chat.title) chat.title = clip(text, 48);
  save(chat);
}

/** Handry's answer: how it was done (fast / learned / recipe / brain) and the steps taken. */
export function addAnswer(chat, answer) {
  chat.entries.push({ at: Date.now(), role: 'jevis', ...answer, steps: (answer.steps || []).slice(0, 30) });
  save(chat);
}

// Exchanges (a command and its answer) before the command being run now.
function exchanges(chat) {
  const out = [];
  for (let i = 0; i < chat.entries.length; i++) {
    const e = chat.entries[i];
    if (e.role !== 'jevis') continue;
    const asked = chat.entries[i - 1]?.role === 'user' ? chat.entries[i - 1] : null;
    out.push({ asked, answer: e });
  }
  return out;
}

const line = ({ asked, answer }) => `- ${hhmm(answer.at)} "${clip(asked?.text, 100)}" → ${clip(answer.text, 180) || T('(cevap yok)', '(no answer)')}${answer.via && answer.via !== 'brain' ? ` (${via(answer.via) || answer.via})` : ''}${answer.steps?.length ? ` [${answer.steps.slice(0, 6).join(', ')}]` : ''}`;

/**
 * The message for the brain and the session to continue. A fresh session
 * (carrying Handry's summary of the chat) when there is none for this
 * brain/model yet or after ROTATE_TURNS turns; otherwise the same session,
 * told what happened without it since its last answer. `screen` is what is
 * on screen now.
 */
export function brainTurn(chat, text, { key, screen }) {
  const c = chat.claude;
  const fresh = !c || c.key !== key || c.turns >= ROTATE_TURNS;
  const parts = [];
  const all = exchanges(chat);
  if (fresh) {
    const earlier = all.slice(-SUMMARY_EXCHANGES).map(line);
    if (earlier.length) parts.push(T(`[Bu sohbette daha önce (${APP.genitive} özeti):\n${earlier.join('\n')}]`, `[Earlier in this chat (${APP_NAME}'s summary):\n${earlier.join('\n')}]`));
  } else {
    const lastBrain = all.findLastIndex(x => x.answer.via === 'brain');
    const without = all.slice(lastBrain + 1).map(line);
    if (without.length) parts.push(T(`[Sen yokken ${APP.genitive} Claude'suz yaptıkları:\n${without.join('\n')}]`, `[While you were away, what ${APP_NAME} did without Claude:\n${without.join('\n')}]`));
  }
  if (screen) parts.push(T(`[Şu an ekranda: ${screen}]`, `[On screen now: ${screen}]`));
  parts.push(text);
  return { message: parts.join('\n\n'), sessionId: fresh ? null : c.sessionId, fresh };
}

export function brainDone(chat, { sessionId, key, fresh }) {
  if (!sessionId) return;
  chat.claude = { sessionId, key, turns: fresh ? 1 : (chat.claude?.turns || 0) + 1 };
  save(chat);
}

/** A short line for one tool call: "browser_open(godaddy.com)", "browser_fill(3 alan)". */
export function stepText(name, args = {}) {
  const tool = String(name).replace(/^mcp__.+?__/, '');
  const arg = args.url || args.target || args.name || args.what || args.command || args.query || args.text || args.action
    || (args.fields && typeof args.fields === 'object' ? T(`${Object.keys(args.fields).length} alan`, `${Object.keys(args.fields).length} fields`) : '');
  return `${tool}${arg ? `(${clip(arg, 40)})` : ''}`;
}
