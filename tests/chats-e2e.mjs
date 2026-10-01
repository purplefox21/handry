// Chats and their Claude sessions, with a stand-in brain that records what it
// is sent: the session continues, what JEVIS did without Claude is told to it
// ("Sen yokken…"), the screen goes with every message, the session is
// refreshed with a summary after ROTATE_TURNS turns or a model change,
// "yeni sohbet" and 2 hours of silence start a new chat, old chats can be
// picked up again. Works in a throwaway JEVIS home.
// Usage: node tests/chats-e2e.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.JEVIS_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'jevis-chats-'));
delete process.env.JEVIS_NO_CHAT;
const { runCommand } = await import('../core/runner.js');
const chats = await import('../core/chats.js');
const { loadState } = await import('../core/config.js');

const sent = [];
let sessions = 0;
const brain = {
  id: 'claude-code',
  label: 'Test beyni',
  run: async ({ text, sessionId }) => {
    sent.push({ text, sessionId });
    return { text: 'Tamam, yaptım.', sessionId: sessionId || `sess-${++sessions}` };
  }
};
const ask = (text, extra = {}) => runCommand({ text, brainId: 'claude-code', brainOverride: brain, ...extra });
const last = () => sent.at(-1);

let passed = 0;
let total = 0;
async function check(name, fn) {
  total++;
  const started = Date.now();
  let ok = false;
  let note = '';
  try { const r = await fn(); ok = Boolean(r?.ok ?? r); note = r?.note || ''; } catch (err) { note = err.message; }
  if (ok) passed++;
  console.log(`${ok ? '✅' : '❌'} ${String(Date.now() - started).padStart(6)} ms  ${name}${note ? `\n          → ${String(note).split('\n').slice(0, 5).join('\n            ')}` : ''}`);
}

try {
  let first;
  await check('İlk Claude mesajı: yeni oturum, ekranda ne olduğu da gidiyor', async () => {
    const out = await ask('Açık pencerelerin başlıklarını söyle');
    first = out.chat.id;
    return { ok: last().sessionId === null && /\[Şu an ekranda: .+\]/.test(last().text) && !/Sen yokken/.test(last().text) && out.chat.title.startsWith('Açık pencerelerin'), note: last().text.split('\n').find(l => l.startsWith('[Şu an')) };
  });

  await check('Hızlı yol işi sohbete yazılıyor, sonraki Claude mesajında "Sen yokken" diye geçiyor; oturum sürüyor', async () => {
    const quick = await ask('şu an hangi şarkı çalıyor');
    await ask('bunu bir daha yap');
    return { ok: quick.fast && last().sessionId === 'sess-1' && /Sen yokken Inaro'nun Claude'suz yaptıkları/.test(last().text) && /şu an hangi şarkı çalıyor/.test(last().text), note: last().text.split('\n').slice(0, 3).join(' / ') };
  });

  await check('Sen yokken listesi bir kez gidiyor (Claude artık biliyor)', async () => {
    await ask('peki şimdi ne durumdayız');
    return { ok: last().sessionId === 'sess-1' && !/Sen yokken/.test(last().text) };
  });

  await check('Model değişince bağlam özetle taşınıyor (yeni oturum)', async () => {
    await ask('aynısını daha dikkatli yap', { model: 'claude-opus-5-5' });
    return { ok: last().sessionId === null && /Bu sohbette daha önce \(Inaro'nun özeti\)/.test(last().text) && /şu an hangi şarkı çalıyor/.test(last().text), note: last().text.split('\n').slice(0, 4).join(' / ') };
  });

  await check(`${chats.ROTATE_TURNS} turda bir oturum özetle tazeleniyor (pahalılaşmasın diye)`, async () => {
    const chat = chats.loadChat(first);
    chat.claude.turns = chats.ROTATE_TURNS;
    fs.writeFileSync(path.join(process.env.JEVIS_HOME, 'chats', `${first}.json`), JSON.stringify(chat));
    await ask('devam et', { model: 'claude-opus-5-5' });
    const fresh = last().sessionId === null && /Bu sohbette daha önce/.test(last().text);
    await ask('sonra ne var', { model: 'claude-opus-5-5' });
    return { ok: fresh && last().sessionId !== null && chats.loadChat(first).claude.turns === 2, note: `tazelenen oturumdan sonra: ${last().sessionId}` };
  });

  let second;
  await check('"yeni sohbet" temiz bir sayfa açıyor; ilk mesajında eski sohbetten iz yok', async () => {
    const out = await ask('yeni sohbet');
    second = out.chat.id;
    await ask('Masaüstünde hangi klasörler var');
    const chat = chats.loadChat(second);
    return { ok: out.newChat && second !== first && last().sessionId === null && !/Bu sohbette daha önce/.test(last().text) && chat.title.startsWith('Masaüstünde'), note: `yeni sohbet: ${chat.title}` };
  });

  await check('Eski sohbete dönülünce onun oturumu kaldığı yerden sürüyor', async () => {
    const oldSession = chats.loadChat(first).claude.sessionId;
    await ask('ilk konuya dönelim', { chatId: first, model: 'claude-opus-5-5' });
    return { ok: last().sessionId === oldSession && loadState().chat === first, note: `oturum ${oldSession}` };
  });

  await check('2 saat sessizlikten sonra yeni sohbet açılıyor, eskisi listede duruyor', async () => {
    const chat = chats.loadChat(loadState().chat);
    chat.updated = Date.now() - chats.IDLE_MS - 60000;
    fs.writeFileSync(path.join(process.env.JEVIS_HOME, 'chats', `${chat.id}.json`), JSON.stringify(chat));
    const out = await ask('bugün ne yapıyoruz');
    const list = chats.listChats();
    return { ok: out.chat.id !== chat.id && list.some(c => c.id === chat.id) && list.length === 3, note: `${list.length} sohbet: ${list.map(c => c.title).join(' | ')}` };
  });

  await check('chat: false (inaro_do gibi) sohbete yazılmıyor', async () => {
    const before = chats.loadChat(loadState().chat).entries.length;
    await runCommand({ text: 'şu an hangi şarkı çalıyor', chat: false, brainOverride: brain });
    return chats.loadChat(loadState().chat).entries.length === before;
  });
} finally {
  fs.rmSync(process.env.JEVIS_HOME, { recursive: true, force: true });
}

console.log(`\n${passed}/${total} geçti`);
process.exit(passed === total ? 0 : 1);
