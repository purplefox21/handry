// Handry · © 2026 Berat Olekli (purplefox) · github.com/purplefox21/handry
// Handry chat UI (the big window). Shared pieces live in common.js. Everything
// shown here can come from web pages or tools: untrusted text always goes
// through textContent, never innerHTML.

const state = {
  running: false,
  chatId: null, // the chat shown here; commands typed here go to it
  shownEntries: 0, // how many of its entries are on screen (the bar and voice add more)
  brain: 'claude-code',
  model: null,
  effort: null,
  fast: store.get('fast', true),
  speak: store.get('speak', false)
};

let toastTimer;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

function setStatus(kind, text) {
  $('status').dataset.state = kind;
  $('statusText').textContent = text;
}

// ---------------------------------------------------------------------------
// Conversation
// ---------------------------------------------------------------------------

const chat = $('chat');
let stickToBottom = true;
chat.addEventListener('scroll', () => {
  stickToBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 90;
});
function scrollDown(force = false) {
  if (force || stickToBottom) chat.scrollTop = chat.scrollHeight;
}

function showWelcome(show) {
  $('welcome').hidden = !show;
}

function addUser(text) {
  $('messages').append(el('div', 'msg-user', text));
  scrollDown(true);
}

function newTurn() {
  const wrap = el('div', 'turn');
  const avatar = el('div', 'turn-avatar brand-mark');
  avatar.append(icon('zap'));
  const body = el('div', 'turn-body');
  const activity = el('div', 'activity open');
  const head = el('button', 'activity-head');
  head.type = 'button';
  const stateEl = el('span', 'state');
  stateEl.append(el('span', 'spinner'));
  const label = el('span', 'label', T('Başlıyor…', 'Starting…'));
  const chev = icon('chevron-down');
  chev.classList.add('chev');
  head.append(stateEl, label, chev);
  head.addEventListener('click', () => activity.classList.toggle('open'));
  const steps = el('ol', 'steps');
  activity.append(head, steps);
  body.append(activity);
  wrap.append(avatar, body);
  $('messages').append(wrap);
  scrollDown(true);
  return { wrap, body, activity, stateEl, label, steps, pending: [], tools: 0, texts: [], lastNote: null, who: '', finished: false };
}

function addStep(turn, { name, title, kind = 'run' }) {
  const li = el('li', `step ${kind}`);
  const ic = el('span', 'step-icon');
  ic.append(icon(kind === 'note' ? 'message' : stepIcon(name)));
  const main = el('div', 'step-main');
  main.append(el('div', 'step-title', title));
  const mark = el('span', 'step-mark');
  if (kind === 'run') mark.append(el('span', 'spinner'));
  li.append(ic, main, mark);
  turn.steps.append(li);
  return li;
}

function settleStep(li, { ok, detail, image }) {
  li.classList.remove('run');
  li.classList.add(ok ? 'ok' : 'err');
  li.querySelector('.step-mark').replaceChildren(icon(ok ? 'check' : 'x'));
  const main = li.querySelector('.step-main');
  if (detail) main.append(el('div', 'step-detail', detail));
  if (image?.data) {
    const img = el('img', 'step-shot');
    img.src = `data:${image.mimeType || 'image/jpeg'};base64,${image.data}`;
    img.alt = T('ekran görüntüsü', 'screenshot');
    img.addEventListener('click', () => img.classList.toggle('big'));
    main.append(img);
  }
}

function setLabel(turn, text) {
  if (!turn.finished) turn.label.textContent = text;
}

const liveLabel = (turn, doing) => `${turn.who || T('Çalışıyor', 'Working')}${turn.tools ? ` · ${stepCount(turn.tools)}` : ''}${doing ? ` — ${doing}` : ''}`;

function handleEvent(turn, ev) {
  switch (ev.type) {
    case 'route':
      turn.who = ev.route === 'needs_brain' ? currentBrainLabel() : ev.route === 'learned' ? T('Öğrenilmiş yol', 'Learned way') : `${T('Hızlı yol', 'Fast path')} · ${ROUTE_NAMES[ev.route] || ev.route}`;
      setLabel(turn, liveLabel(turn, ev.route === 'needs_brain' ? T('düşünüyor', 'thinking') : ''));
      break;
    case 'status':
      // The runner's "… düşünüyor…" / "Claude başladı" (English: "… is thinking…" / "Claude started").
      if (/düşünüyor|başladı|thinking…?$|started$/.test(ev.text)) {
        turn.who = currentBrainLabel();
        setLabel(turn, liveLabel(turn, T('düşünüyor', 'thinking')));
      } else if (ev.text.startsWith('📌')) {
        if (turn.who !== T('Öğrenilmiş yol', 'Learned way')) turn.who = T('Tarif', 'Recipe');
        setLabel(turn, liveLabel(turn, ''));
      } else {
        addStep(turn, { title: ev.text, kind: 'note' });
      }
      break;
    case 'tool': {
      turn.tools++;
      const title = describe(ev.name, ev.args);
      turn.pending.push({ name: ev.name, args: ev.args, li: addStep(turn, { name: ev.name, title }) });
      setLabel(turn, liveLabel(turn, title));
      break;
    }
    case 'tool_result': {
      const i = turn.pending.findIndex(p => p.name === ev.name);
      let li;
      if (i >= 0) {
        const { li: pendingLi, args } = turn.pending.splice(i, 1)[0];
        li = pendingLi;
        // "#6" only means something to the brain: show the element's name instead ("Öğe:"; in English "Element:" or "Control:").
        const named = String(ev.text || '').match(/(?:Öğe|Element|Control|Item): "([^"]+)"/)?.[1];
        if (named && /^#/.test(args?.target || '')) li.querySelector('.step-title').textContent = describe(ev.name, { ...args, target: named });
      } else {
        turn.tools++;
        const fastSystem = String(ev.name).startsWith('mac:');
        li = addStep(turn, { name: ev.name, title: fastSystem ? ev.text : describe(ev.name) });
        if (fastSystem) { settleStep(li, { ok: !ev.isError }); break; }
      }
      settleStep(li, { ok: !ev.isError, detail: summarize(ev.text), image: ev.image });
      break;
    }
    case 'text':
      turn.texts.push(ev.text);
      turn.lastNote = addStep(turn, { title: ev.text, kind: 'note' });
      break;
    case 'done':
      finishTurn(turn, ev);
      refreshTimers(); // the command may have set or cancelled a timer
      break;
    case 'error':
      failTurn(turn, ev.message);
      break;
  }
  scrollDown();
}

function finishTurn(turn, ev) {
  turn.finished = true;
  const final = ev.text || turn.texts.at(-1) || '';
  // The brain's last message is the answer: show it once, as the answer.
  if (turn.lastNote && turn.texts.at(-1) === final) turn.lastNote.remove();
  for (const p of turn.pending) settleStep(p.li, { ok: false, detail: T('yarıda kaldı', 'cut short') });
  turn.pending = [];
  const who = ev.fast ? T('Hızlı yol (Jev)', 'Fast path (Jev)') : ev.learnedReplay ? `${T('Öğrenilmiş yol', 'Learned way')}${ev.brain ? ' + Claude' : T(', Claude\'suz', ', no Claude')}` : ev.recipe ? `${T('Tarif', 'Recipe')}: ${pretty(ev.recipe)}` : (MODEL_NAMES[ev.model] || BRAIN_NAMES[ev.brain] || APP_NAME);
  const secs = ((ev.ms || 0) / 1000).toFixed(1);
  turn.activity.classList.remove('open');
  turn.activity.classList.add(ev.stopped ? 'failed' : 'done');
  turn.stateEl.replaceChildren(icon(ev.stopped ? 'x' : 'check'));
  turn.label.textContent = `${ev.stopped ? T('Durduruldu', 'Stopped') : T('Bitti', 'Done')} · ${who}${turn.tools ? ` · ${stepCount(turn.tools)}` : ''} · ${secs} ${T('sn', 's')}`;
  if (!turn.steps.children.length) turn.activity.querySelector('.chev').remove();
  if (final) turn.body.append(el('div', 'answer', final));
  if (ev.learned?.name) {
    const note = el('div', 'learned-note');
    note.append(icon('bookmark'), document.createTextNode(ev.learned.updated
      ? T('Bu işi zaten biliyordum; öğrendiğim yolu güncelledim.', 'I already knew this one; I updated the way I learned it.')
      : T('Bunu öğrendim. Benzer bir komutu bir dahaki sefere Claude\'a sormadan yaparım.', "Learned this. Next time I'll do a similar command without asking Claude.")));
    turn.body.append(note);
  }
  if (ev.chat && !ev.replay) { state.chatId = ev.chat.id; showChatTitle(ev.chat.title); }
  if (!ev.fast && !ev.recipe && !ev.learned?.name && !ev.stopped && ev.runId && turn.steps.querySelector('.step.ok')) addSaveRecipe(turn, ev.runId);
  if (state.speak && final && !ev.replay) api('/api/say', { method: 'POST', body: JSON.stringify({ text: final }) });
}

function failTurn(turn, message) {
  if (turn.finished) return;
  turn.finished = true;
  for (const p of turn.pending) settleStep(p.li, { ok: false });
  turn.activity.classList.add('failed', 'open');
  turn.stateEl.replaceChildren(icon('x'));
  turn.label.textContent = T('Olmadı', "Didn't work");
  if (!turn.steps.children.length) turn.activity.hidden = true;
  turn.body.append(el('div', 'answer error', message));
}

function addSaveRecipe(turn, runId) {
  const foot = el('div', 'turn-foot');
  const button = el('button', 'link-btn');
  button.type = 'button';
  button.append(icon('bookmark'), document.createTextNode(T('Tarif olarak kaydet', 'Save as a recipe')));
  button.addEventListener('click', () => {
    const form = el('form', 'inline-form');
    const input = el('input');
    input.placeholder = T('Tarifin adı, ör. appstore-fiyat', 'Recipe name, e.g. appstore-price');
    input.required = true;
    const save = el('button', 'btn btn-primary', T('Kaydet', 'Save'));
    save.type = 'submit';
    const cancel = el('button', 'btn btn-ghost', T('Vazgeç', 'Cancel'));
    cancel.type = 'button';
    cancel.addEventListener('click', () => form.replaceWith(button));
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const res = await api('/api/recipes', { method: 'POST', body: JSON.stringify({ name: input.value.trim(), runId }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return toast(T(`Kaydedilemedi: ${data.error || res.status}`, `Couldn't save: ${data.error || res.status}`));
      foot.replaceChildren(el('span', 'recipe-meta', `${T('Tarif kaydedildi', 'Recipe saved')}: ${pretty(data.recipe.name)} (${stepCount(data.recipe.steps.length)})`));
      toast(T('Tarif kaydedildi', 'Recipe saved'));
      loadRecipes();
    });
    form.append(input, save, cancel);
    button.replaceWith(form);
    input.focus();
  });
  foot.append(button);
  turn.body.append(foot);
}

// ---------------------------------------------------------------------------
// Running a command
// ---------------------------------------------------------------------------

const input = $('input');
const sendBtn = $('sendBtn');
const stopBtn = $('stopBtn');

const currentBrainLabel = () => (state.brain === 'claude-code' ? (MODEL_NAMES[state.model] || 'Claude') : (BRAIN_NAMES[state.brain] || state.brain));

function setRunning(on) {
  state.running = on;
  sendBtn.hidden = on;
  stopBtn.hidden = !on;
  setStatus(on ? 'busy' : 'ready', on ? T('Çalışıyor…', 'Working…') : T('Hazır', 'Ready'));
  updateSendButton();
  if (!on) input.focus();
}

async function send(text) {
  text = String(text || '').trim();
  if (!text || state.running) return;
  let newChatDone = false;
  showWelcome(false);
  addUser(text);
  const turn = newTurn();
  setRunning(true);
  try {
    await runStream({
      text,
      brain: state.brain,
      chatId: state.chatId || undefined,
      fast: state.fast,
      source: 'window',
      ...(state.brain === 'claude-code' ? { model: state.model, effort: state.effort } : {})
    }, ev => { if (ev.newChat) newChatDone = true; handleEvent(turn, ev); });
    if (!turn.finished) failTurn(turn, T('Bağlantı yarıda kesildi.', 'The connection was cut off.'));
  } catch (err) {
    failTurn(turn, T(`Bağlantı hatası: ${err.message}`, `Connection error: ${err.message}`));
  } finally {
    setRunning(false);
  }
  // "yeni sohbet" ("new chat") said here: show the clean page; otherwise remember what is on screen.
  const { chat } = await (await api('/api/chats/current')).json().catch(() => ({}));
  if (newChatDone) { renderChat(chat); toast(T('Yeni sohbet açıldı.', 'New chat started.')); } else if (chat?.id === state.chatId) state.shownEntries = chat.entries.length;
}

function updateSendButton() {
  sendBtn.disabled = state.running || !input.value.trim();
}

function autoGrow() {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
}

input.addEventListener('input', () => { autoGrow(); updateSendButton(); });
input.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    submit();
  }
});

function submit() {
  if (state.running || !input.value.trim()) return;
  const text = input.value;
  input.value = '';
  autoGrow();
  updateSendButton();
  send(text);
}

// ---------------------------------------------------------------------------
// Chats: this window shows one; the bar, voice and the terminal write into the current one
// ---------------------------------------------------------------------------

const SOURCES = { bar: T('Çubuktan', 'From the bar'), cli: T('Terminalden', 'From the terminal'), voice: T('Sesle', 'By voice'), timer: T('Zamanlayıcıdan', 'From a timer') };
const VIA_ROUTE = { fast: { fast: true }, learned: { learnedReplay: true }, recipe: { recipe: T('tarif', 'recipe') } };

// A chat without a title yet is called "Yeni sohbet" ("New chat"): nothing to show then.
function showChatTitle(title) {
  $('chatTitle').textContent = title && title !== 'Yeni sohbet' && title !== 'New chat' ? short(title, 36) : '';
}

/** Past entries of a chat, as finished turns. */
function renderEntries(entries) {
  let source = null;
  for (const e of entries) {
    if (e.role === 'user') {
      showWelcome(false);
      addUser(e.text);
      source = e.source;
      continue;
    }
    const turn = newTurn();
    turn.tools = e.steps?.length || 0;
    if (e.via === 'error') failTurn(turn, e.text);
    else {
      finishTurn(turn, { type: 'done', text: e.text, ms: e.ms, runId: e.runId, model: e.model, replay: true, ...(VIA_ROUTE[e.via] || {}) });
      if (SOURCES[source]) turn.label.textContent = `${SOURCES[source]} · ${turn.label.textContent}`;
    }
  }
}

function renderChat(chat) {
  $('messages').replaceChildren();
  state.chatId = chat?.id || null;
  state.shownEntries = chat?.entries.length || 0;
  showChatTitle(chat?.title);
  if (!chat?.entries.length) { showWelcome(true); return; }
  renderEntries(chat.entries);
  scrollDown(true);
}

// When this window is looked at: what the bar or voice added, or the chat they moved to.
async function syncChat() {
  if (state.running) return;
  const { chat, stale } = await (await api('/api/chats/current')).json();
  if (!chat || stale) return;
  if (chat.id !== state.chatId) return renderChat(chat);
  if (chat.entries.length > state.shownEntries) {
    renderEntries(chat.entries.slice(state.shownEntries));
    state.shownEntries = chat.entries.length;
    showChatTitle(chat.title);
    scrollDown(true);
  }
}
window.addEventListener('focus', () => syncChat().catch(() => {}));
document.addEventListener('visibilitychange', () => { if (!document.hidden) syncChat().catch(() => {}); });

const ago = t => {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return T('az önce', 'just now');
  if (m < 60) return T(`${m} dk önce`, `${m} min ago`);
  const h = Math.round(m / 60);
  if (m < 1440) return T(`${h} saat önce`, `${h} ${h === 1 ? 'hour' : 'hours'} ago`);
  return new Date(t).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' });
};

async function loadChats() {
  const { chats } = await (await api('/api/chats')).json();
  const list = $('chatList');
  if (!chats.length) { list.replaceChildren(el('div', 'empty', T('Henüz sohbet yok.', 'No chats yet.'))); return; }
  list.replaceChildren(...chats.map(c => {
    const item = el('div', `chat-item${c.id === state.chatId ? ' current' : ''}`);
    const textBox = el('div', 'chat-item-text');
    textBox.append(el('div', 'chat-item-title', c.title), el('div', 'chat-item-meta', `${T(`${c.count} komut`, `${c.count} ${c.count === 1 ? 'command' : 'commands'}`)} · ${ago(c.updated)}`));
    const del = el('button', 'icon-btn');
    del.title = T('Sil', 'Delete');
    del.append(icon('trash'));
    del.addEventListener('click', async e => {
      e.stopPropagation();
      if (!del.dataset.sure) { del.dataset.sure = '1'; del.title = T('Emin misin? Tekrar bas', 'Sure? Press again'); del.classList.add('danger'); setTimeout(() => { delete del.dataset.sure; del.classList.remove('danger'); }, 3000); return; }
      await api('/api/chats/delete', { method: 'POST', body: JSON.stringify({ id: c.id }) });
      if (c.id === state.chatId) renderChat(null);
      loadChats();
    });
    item.append(textBox, del);
    item.addEventListener('click', async () => {
      if (state.running) return toast(T('Önce çalışan işi bitir ya da durdur.', 'Finish or stop the running task first.'));
      const { chat } = await (await api('/api/chats/switch', { method: 'POST', body: JSON.stringify({ id: c.id }) })).json();
      renderChat(chat);
      closeDrawer();
    });
    return item;
  }));
}

async function startNewChat() {
  if (state.running) return toast(T('Önce çalışan işi bitir ya da durdur.', 'Finish or stop the running task first.'));
  const { chat } = await (await api('/api/chats/new', { method: 'POST' })).json();
  renderChat(chat);
  closeDrawer();
  input.focus();
}

sendBtn.addEventListener('click', submit);
stopBtn.addEventListener('click', async () => {
  setStatus('stopping', T('Durduruluyor…', 'Stopping…'));
  await api('/api/stop', { method: 'POST' });
});

$('newChatBtn').addEventListener('click', () => startNewChat().catch(err => toast(err.message)));
$('newChatInDrawer').addEventListener('click', () => startNewChat().catch(err => toast(err.message)));
$('chatsBtn').addEventListener('click', () => toggleDrawer('chatsDrawer'));

document.querySelectorAll('.suggestion').forEach(card => card.addEventListener('click', () => {
  if (card.dataset.open === 'recipes') openDrawer('recipesDrawer');
  else send(card.dataset.cmd);
}));

// ---------------------------------------------------------------------------
// Model, effort and settings
// ---------------------------------------------------------------------------

function setChecked(container, attr, value) {
  container.querySelectorAll(`[data-${attr}]`).forEach(b => b.setAttribute('aria-checked', String(b.dataset[attr] === value)));
}

function chooseModel(model) {
  state.model = model;
  store.set('model', model);
  setChecked($('modelSwitch'), 'model', model);
}

function chooseEffort(effort) {
  state.effort = effort;
  store.set('effort', effort);
  setChecked($('effortSwitch'), 'effort', effort);
}

$('modelSwitch').addEventListener('click', e => {
  const b = e.target.closest('[data-model]');
  if (b) chooseModel(b.dataset.model);
});
$('effortSwitch').addEventListener('click', e => {
  const b = e.target.closest('[data-effort]');
  if (b) chooseEffort(b.dataset.effort);
});

const fastToggle = $('fastToggle');
const speakToggle = $('speakToggle');
fastToggle.checked = state.fast;
speakToggle.checked = state.speak;
fastToggle.addEventListener('change', () => { state.fast = fastToggle.checked; store.set('fast', state.fast); });
speakToggle.addEventListener('change', () => { state.speak = speakToggle.checked; store.set('speak', state.speak); });

function syncBrain() {
  const claude = state.brain === 'claude-code';
  $('modelSwitch').classList.toggle('disabled', !claude);
  $('modelSwitch').title = claude ? '' : T('Model seçimi sadece Claude Code beyninde', 'The model can only be picked with the Claude Code brain');
}

$('brainSelect').addEventListener('change', e => {
  state.brain = e.target.value;
  store.set('brain', state.brain);
  syncBrain();
});

async function loadBrains() {
  const data = await (await api('/api/brains')).json();
  const cc = data.claudeCode || {};
  adoptDefaultModel(cc.model);
  const savedModel = store.get('model', null);
  const savedEffort = store.get('effort', null);
  chooseModel(cc.models?.includes(savedModel) ? savedModel : cc.model);
  chooseEffort(cc.efforts?.includes(savedEffort) ? savedEffort : cc.effort);

  const select = $('brainSelect');
  select.replaceChildren(...data.brains.map(b => {
    const option = el('option', null, b.available ? b.label : `${b.label} — ${b.reason}`);
    option.value = b.id;
    option.disabled = !b.available;
    return option;
  }));
  const saved = store.get('brain', null);
  state.brain = data.brains.some(b => b.id === saved && b.available) ? saved : data.default;
  select.value = state.brain;
  syncBrain();
}

async function loadStatus() {
  const s = await (await api('/api/status')).json();
  const rows = [
    [s.jev, T('Jev (karar modeli)', 'Jev (decision model)'), T("yok; Jev'siz çalışıyor (anahtar: .env › JEV_KEY)", 'none; working without it (key: .env › JEV_KEY)')],
    [s.claude, T('Claude Code (aboneliğin)', 'Claude Code (your subscription)'), T('claude komutu bulunamadı', 'the claude command was not found')],
    [s.chrome, `${APP_NAME} Chrome`, T('Chrome bulunamadı', 'Chrome was not found')],
    [s.voice, T('Ses tanıma (whisper)', 'Speech recognition (whisper)'), T('kurulu değil', 'not installed')]
  ];
  $('statusList').replaceChildren(...rows.map(([ok, label, fix]) => {
    const li = el('li');
    const mark = el('span', ok ? 'ok' : 'no');
    mark.append(icon(ok ? 'check' : 'x'));
    li.append(mark, el('span', null, ok ? label : `${label}: ${fix}`));
    return li;
  }));
}

// Language: Türkçe, English or the Mac's own. Handry.app notices the change and
// restarts itself with its server: the page waits until the server answers
// again, then reloads. A server on its own (npm start) keeps answering, so the
// page reloads at once.
const langSwitch = $('langSwitch');

async function loadLanguage() {
  const { setting } = await (await api('/api/language')).json();
  setChecked(langSwitch, 'lang', setting);
}

async function serverPid() {
  try { return (await (await fetch('/api/ping', { cache: 'no-store' })).json()).pid; } catch { return null; }
}

/** Waits (up to 20 s) until the server went away and came back, or another one answers. */
async function serverRestarted(pid) {
  let down = false;
  for (const end = Date.now() + 20000; Date.now() < end;) {
    await new Promise(r => setTimeout(r, 400));
    const now = await serverPid();
    if (now === null) down = true;
    else if (down || now !== pid) return;
  }
}

async function chooseLanguage(value) {
  const pid = await serverPid();
  const res = await api('/api/language', { method: 'POST', body: JSON.stringify({ language: value }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return toast(data.error || T(`Dil değişmedi (${res.status}).`, `The language didn't change (${res.status}).`));
  setChecked(langSwitch, 'lang', value);
  if (data.language === LANG) return; // "auto" may mean the language already shown
  const note = $('langNote');
  note.textContent = data.language === 'en' ? 'Restarting…' : 'Yeniden başlıyor…';
  note.hidden = false;
  langSwitch.classList.add('disabled');
  if (data.restart) await serverRestarted(pid);
  location.reload();
}

langSwitch.addEventListener('click', e => {
  const b = e.target.closest('[data-lang]');
  if (b && b.getAttribute('aria-checked') !== 'true' && !langSwitch.classList.contains('disabled')) chooseLanguage(b.dataset.lang).catch(err => toast(err.message));
});

// ---------------------------------------------------------------------------
// Drawers: settings and recipes
// ---------------------------------------------------------------------------

let openDrawerId = null;

// Drawers open under the top bar, so the button that opened one stays in reach to close it again.
const DRAWER_BUTTONS = { settingsDrawer: 'settingsBtn', timersDrawer: 'timersBtn', logDrawer: 'logBtn', recipesDrawer: 'recipesBtn', chatsDrawer: 'chatsBtn' };
const topbar = document.querySelector('.topbar');
new ResizeObserver(() => document.documentElement.style.setProperty('--topbar-h', `${topbar.offsetHeight}px`)).observe(topbar);

function markDrawerButton(id, on) {
  const button = DRAWER_BUTTONS[id] && $(DRAWER_BUTTONS[id]);
  if (button) { button.classList.toggle('active', on); button.setAttribute('aria-expanded', String(on)); }
}

function openDrawer(id) {
  closeDrawer();
  openDrawerId = id;
  $('scrim').hidden = false;
  $(id).hidden = false;
  markDrawerButton(id, true);
  if (id === 'timersDrawer') { renderTimers(); refreshTimers(); }
  if (id === 'logDrawer') loadLog().catch(err => toast(err.message));
  if (id === 'recipesDrawer') loadRecipes();
  if (id === 'chatsDrawer') loadChats().catch(err => toast(err.message));
  if (id === 'settingsDrawer') { loadStatus().catch(() => {}); loadLanguage().catch(() => {}); }
}

function closeDrawer() {
  if (!openDrawerId) return;
  $(openDrawerId).hidden = true;
  $('scrim').hidden = true;
  markDrawerButton(openDrawerId, false);
  openDrawerId = null;
}

/** A top bar button: opens its drawer, or closes it when it is the one open. */
function toggleDrawer(id) {
  if (openDrawerId === id) closeDrawer();
  else openDrawer(id);
}

$('settingsBtn').addEventListener('click', () => toggleDrawer('settingsDrawer'));
$('timersBtn').addEventListener('click', () => toggleDrawer('timersDrawer'));
$('logBtn').addEventListener('click', () => toggleDrawer('logDrawer'));
$('recipesBtn').addEventListener('click', () => toggleDrawer('recipesDrawer'));
$('scrim').addEventListener('click', closeDrawer);
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeDrawer));
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });

// ---------------------------------------------------------------------------
// Timers and watches: a count on the ⏰ button, the list in a drawer, cancel
// one (asks "emin misin?" first) or all. The list is fetched every few
// seconds, so a timer set from the bar, by voice or from another Claude
// session shows up by itself; the time left counts down every second.
// ---------------------------------------------------------------------------

let timerJobs = [];

async function refreshTimers() {
  try { timerJobs = await fetchTimers(); } catch { return; }
  const badge = $('timersBadge');
  badge.hidden = !timerJobs.length;
  badge.textContent = String(timerJobs.length);
  $('timersBtn').classList.toggle('alarm', timerJobs.some(j => j.firing));
  if (openDrawerId === 'timersDrawer') renderTimers();
}

/** Shows a chat in the window (also called by Handry.app's menu: "Sohbeti Aç"). */
async function openChatById(id) {
  if (state.running) { toast(T('Önce çalışan işi bitir ya da durdur.', 'Finish or stop the running task first.')); return false; }
  const res = await api('/api/chats/switch', { method: 'POST', body: JSON.stringify({ id }) });
  if (!res.ok) { toast(T('Bu sohbet artık yok.', 'This chat is gone.')); return false; }
  renderChat((await res.json()).chat);
  closeDrawer();
  return true;
}

function timerItem(job) {
  const item = el('div', `timer-item${job.chatId ? ' linked' : ''}`);
  item.dataset.id = job.id;
  // A click opens the chat the timer was asked in.
  if (job.chatId) {
    item.title = T('Bu zamanlayıcının kurulduğu sohbeti aç', 'Open the chat this timer was set in');
    item.addEventListener('click', () => openChatById(job.chatId));
  }
  const mark = el('span', 'timer-icon');
  mark.append(icon(timerIcon(job)));
  const text = el('div', 'timer-text');
  text.append(el('div', 'timer-title', job.what), el('div', 'timer-sub'));
  const from = job.source === 'mcp' ? T("VS Code'dan kuruldu", 'Set from VS Code') : '';
  if (job.said || from) text.append(el('div', 'timer-said', [job.said && `“${job.said}”`, from].filter(Boolean).join(' · ')));
  const cancel = el('button', 'btn btn-danger-ghost timer-cancel', T('İptal', 'Cancel'));
  cancel.type = 'button';
  const done = async () => {
    await cancelTimer(job.id);
    toast(T(`İptal edildi: ${job.what}`, `Cancelled: ${job.what}`));
    refreshTimers();
  };
  // A running shutdown countdown is cancelled at once; anything else asks first.
  if (job.firing) cancel.addEventListener('click', e => { e.stopPropagation(); done(); });
  else twoStep(cancel, T('Emin misin?', 'Sure?'), done);
  item.append(mark, text, cancel);
  return item;
}

function updateTimerTexts() {
  for (const item of $('timerList').querySelectorAll('.timer-item')) {
    const job = timerJobs.find(j => j.id === item.dataset.id);
    if (!job) continue;
    item.querySelector('.timer-sub').textContent = timerSub(job);
    item.classList.toggle('firing', Boolean(job.firing));
  }
}

function renderTimers() {
  const list = $('timerList');
  $('cancelAllTimers').hidden = timerJobs.length < 2;
  if (!timerJobs.length) {
    list.replaceChildren(el('div', 'empty', T('Bekleyen zamanlayıcı yok.', 'Nothing scheduled.')));
    list.dataset.sig = '';
    return;
  }
  // Same tasks as on screen: only the texts change (an armed "emin misin?" stays armed).
  const sig = timerJobs.map(j => `${j.id}${j.firing ? '!' : ''}`).join();
  if (list.dataset.sig !== sig) {
    list.replaceChildren(...timerJobs.map(timerItem));
    list.dataset.sig = sig;
  }
  updateTimerTexts();
}

twoStep($('cancelAllTimers'), T('Hepsi iptal olsun mu?', 'Cancel them all?'), async () => {
  await cancelTimer('all');
  $('cancelAllTimers').disabled = false;
  toast(T('Bütün zamanlayıcılar iptal edildi.', 'Everything scheduled was cancelled.'));
  refreshTimers();
});

setInterval(() => { if (openDrawerId === 'timersDrawer') updateTimerTexts(); }, 1000);
setInterval(refreshTimers, 4000);
window.addEventListener('focus', () => refreshTimers());

// ---------------------------------------------------------------------------
// Yapılanlar: the action log the code writes (not the AI's own account), one
// day at a time, grouped by who did it; the last file change can be undone.
// ---------------------------------------------------------------------------

let logDay = null;
// 24-hour clock in both languages, so the "10:02–10:05" range below keeps working.
const hhmmOf = ts => new Date(ts).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

function dayLabel(day) {
  const d = new Date(`${day}T12:00:00`);
  const today = new Date();
  const diff = Math.round((new Date(today.toDateString()) - new Date(d.toDateString())) / 86400000);
  return diff === 0 ? T('Bugün', 'Today') : diff === 1 ? T('Dün', 'Yesterday') : d.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' });
}

// Older entries have no "who": the run id still tells the app from a Claude session.
const whoOf = e => e.who || (String(e.run).startsWith('mcp-') ? T('Claude oturumu', 'Claude session') : String(e.run).startsWith('run-') ? APP_NAME : T('elle', 'by hand'));

function logRow(e) {
  const row = el('div', `log-row${e.ok ? '' : ' failed'}`);
  const line = el('button', 'log-line');
  line.type = 'button';
  const mark = el('span', 'log-icon');
  mark.append(icon(stepIcon(e.tool)));
  const what = el('span', 'log-what', describe(e.tool, e.args));
  line.append(el('span', 'log-time', hhmmOf(e.ts)), mark, what);
  const summary = String(e.summary || '');
  // The tools' own words, in either language (older entries are in Turkish).
  if (/Kullanıcı onayladı|The user (?:allowed|approved)/.test(summary)) line.append(el('span', 'log-badge asked', T('sen onayladın', 'you approved')));
  if (/izin vermedi|DENIED|didn't allow|did not allow/.test(summary)) line.append(el('span', 'log-badge denied', T('sen reddettin', 'you refused')));
  line.append(el('span', `log-badge ${e.ok ? 'ok' : 'err'}`, e.ok ? '✓' : '✗'));
  const detail = el('pre', 'log-detail', `${e.tool} ${JSON.stringify(e.args || {})}\n\n${summary}${e.ms !== undefined ? `\n\n${e.ms} ms` : ''}`);
  detail.hidden = true;
  line.addEventListener('click', () => { detail.hidden = !detail.hidden; });
  row.append(line, detail);
  return row;
}

async function loadLog(day = logDay) {
  const data = await (await api(`/api/log${day ? `?day=${day}` : ''}`)).json();
  logDay = data.day;
  $('logDays').replaceChildren(...data.days.slice(0, 7).map(d => {
    const chip = el('button', `log-day${d === data.day ? ' active' : ''}`, dayLabel(d));
    chip.type = 'button';
    chip.addEventListener('click', () => loadLog(d));
    return chip;
  }));
  const list = $('logList');
  if (!data.entries.length) { list.replaceChildren(el('div', 'empty', T('Bu gün kayıt yok.', 'Nothing was logged that day.'))); return; }
  // Newest first; one group per run (one command, or one Claude session's work).
  const groups = [];
  for (const e of data.entries) {
    const g = groups.at(-1);
    if (g && g.run === e.run) g.items.push(e);
    else groups.push({ run: e.run, who: whoOf(e), items: [e] });
  }
  list.replaceChildren(...groups.map(g => {
    const box = el('section', 'log-group');
    const failed = g.items.filter(e => !e.ok).length;
    const head = el('div', 'log-head');
    const count = g.items.length;
    head.append(el('span', 'log-who', g.who), el('span', 'log-meta', `${hhmmOf(g.items.at(-1).ts).slice(0, 5)}–${hhmmOf(g.items[0].ts).slice(0, 5)} · ${T(`${count} işlem`, `${count} ${count === 1 ? 'action' : 'actions'}`)}${failed ? T(` · ${failed} olmadı`, ` · ${failed} failed`) : ''}`));
    box.append(head, ...[...g.items].reverse().map(logRow));
    return box;
  }));
}

$('undoFilesBtn').addEventListener('click', async () => {
  const r = await (await api('/api/files/undo', { method: 'POST' })).json();
  toast(r.text);
  if (openDrawerId === 'logDrawer') loadLog();
});
setInterval(() => { if (openDrawerId === 'logDrawer' && logDay === new Date().toISOString().slice(0, 10)) loadLog().catch(() => {}); }, 5000);

async function loadRecipes() {
  const { recipes } = await (await api('/api/recipes')).json();
  const list = $('recipeList');
  if (!recipes.length) {
    list.replaceChildren(el('div', 'empty', T('Henüz tarif yok. Bir işi bitirince altındaki "Tarif olarak kaydet"e bas.', 'No recipes yet. When a task is done, press "Save as a recipe" under it.')));
    return;
  }
  list.replaceChildren(...recipes.map(recipeCard));
}

function recipeCard(r) {
  const card = el('div', 'recipe');
  const top = el('div', 'recipe-top');
  if (r.learned) {
    top.append(el('span', 'recipe-name', r.pattern), el('span', 'recipe-badge', T('öğrenildi', 'learned')));
    const uses = r.uses ? T(`${r.uses} kez Claude'suz yapıldı`, `done ${r.uses} ${r.uses === 1 ? 'time' : 'times'} without Claude`) : T('henüz tekrar kullanılmadı', 'not used again yet');
    card.append(top, el('div', 'recipe-desc', `${stepCount(r.steps)} · ${uses}`));
  } else {
    top.append(el('span', 'recipe-name', pretty(r.name)), el('span', 'recipe-meta', stepCount(r.steps)));
    card.append(top);
    if (r.description) card.append(el('div', 'recipe-desc', r.description));
  }

  const vars = el('div', 'recipe-vars');
  const inputs = r.vars.map(v => {
    const label = el('label', null, v);
    const field = el('input');
    field.name = v;
    field.placeholder = r.hints?.[v] || '';
    field.value = store.get(`var_${r.name}_${v}`, '');
    label.append(field);
    vars.append(label);
    return field;
  });
  if (inputs.length) card.append(vars);

  const actions = el('div', 'recipe-actions');
  const run = el('button', 'btn btn-primary');
  run.append(icon('play'), document.createTextNode(T('Çalıştır', 'Run')));
  run.addEventListener('click', () => {
    const missing = inputs.find(i => !i.value.trim());
    if (missing) { missing.focus(); return toast(T(`"${missing.name}" değerini yaz`, `Fill in "${missing.name}"`)); }
    inputs.forEach(i => store.set(`var_${r.name}_${i.name}`, i.value));
    const args = inputs.map(i => `${i.name}="${i.value.replace(/"/g, '')}"`).join(' ');
    closeDrawer();
    send(`${T('tarif', 'recipe')}: ${r.name} ${args}`.trim());
  });
  const del = el('button', 'btn btn-danger-ghost');
  del.append(icon('trash'), document.createTextNode(T('Sil', 'Delete')));
  del.addEventListener('click', async () => {
    if (!del.dataset.sure) {
      del.dataset.sure = '1';
      del.lastChild.textContent = T('Emin misin?', 'Sure?');
      setTimeout(() => { delete del.dataset.sure; del.lastChild.textContent = T('Sil', 'Delete'); }, 3000);
      return;
    }
    await api('/api/recipes/delete', { method: 'POST', body: JSON.stringify({ name: r.name }) });
    toast(T('Tarif silindi', 'Recipe deleted'));
    loadRecipes();
  });
  actions.append(run, del);
  card.append(actions);
  return card;
}

// ---------------------------------------------------------------------------
// Voice: push to talk (whisper.cpp on the Mac) and spoken replies (say)
// ---------------------------------------------------------------------------

const micBtn = $('micBtn');
const composer = $('composer');
const hint = $('hint');
const HINT = T('Enter ile gönder · Shift+Enter yeni satır', 'Enter to send · Shift+Enter for a new line');
let recording = null;

async function startListening() {
  if (recording || state.running) return;
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const node = ctx.createScriptProcessor(4096, 1, 1);
  const chunks = [];
  node.onaudioprocess = e => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  source.connect(node);
  node.connect(ctx.destination);
  const started = Date.now();
  const timer = setInterval(() => {
    const s = Math.floor((Date.now() - started) / 1000);
    hint.textContent = T(`Dinliyorum… 0:${String(s).padStart(2, '0')} · bırakınca gönderilir`, `Listening… 0:${String(s).padStart(2, '0')} · sent when you let go`);
  }, 250);
  recording = { stream, ctx, node, chunks, started, timer };
  composer.classList.add('recording');
  setStatus('listening', T('Dinliyorum…', 'Listening…'));
}

async function stopListening() {
  if (!recording) return;
  const { stream, ctx, node, chunks, timer } = recording;
  recording = null;
  clearInterval(timer);
  node.disconnect();
  stream.getTracks().forEach(t => t.stop());
  const rate = ctx.sampleRate;
  await ctx.close();
  composer.classList.remove('recording');
  hint.textContent = HINT;
  const samples = await resample(chunks, rate, 16000);
  if (samples.length < 16000 * 0.4) { setStatus('ready', T('Hazır', 'Ready')); return; }
  setStatus('busy', T('Yazıya çeviriyorum…', 'Turning it into text…'));
  const res = await fetch('/api/voice', { method: 'POST', headers: { 'Content-Type': 'audio/wav', 'X-Jevis-Token': TOKEN }, body: toWav(samples, 16000) });
  const data = await res.json().catch(() => ({}));
  setStatus('ready', T('Hazır', 'Ready'));
  if (!res.ok) return toast(T(`Ses çevrilemedi: ${data.error || res.status}`, `Couldn't turn the speech into text: ${data.error || res.status}`));
  if (!data.text) return toast(T('Bir şey duyamadım, tekrar dener misin?', "I didn't hear anything. Try again?"));
  send(data.text);
}

// Hold to talk; a short tap toggles instead (tap to start, tap to stop).
let pressedAt = 0;
micBtn.addEventListener('pointerdown', async () => {
  if (recording) return;
  pressedAt = Date.now();
  try { await startListening(); } catch (err) { toast(T(`Mikrofon açılamadı: ${err.message}`, `Couldn't open the microphone: ${err.message}`)); }
});
micBtn.addEventListener('pointerup', () => {
  if (recording && Date.now() - pressedAt > 350) stopListening();
});

// The menu bar app's global keys call these.
window.jevisVoice = { start: startListening, stop: stopListening, send };

// ---------------------------------------------------------------------------

async function init() {
  hint.textContent = HINT;
  updateSendButton();
  await Promise.all([
    loadBrains(),
    loadRecipes().catch(() => {}),
    refreshTimers(),
    api('/api/voice').then(r => r.json()).then(v => {
      micBtn.hidden = !v.stt.ok;
      $('speakRow').hidden = !v.tts.ok;
    }).catch(() => {})
  ]);
  // The current chat, unless it went quiet 2 hours ago (then a clean page; it stays in Sohbetler).
  const { chat, stale } = await (await api('/api/chats/current')).json().catch(() => ({}));
  if (chat && !stale) renderChat(chat);
  input.focus();
}

init().catch(err => toast(T(`Yüklenemedi: ${err.message}`, `Couldn't load: ${err.message}`)));
