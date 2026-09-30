// JEVIS chat UI (the big window). Shared pieces live in common.js. Everything
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
  const label = el('span', 'label', 'Başlıyor…');
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
    img.alt = 'ekran görüntüsü';
    img.addEventListener('click', () => img.classList.toggle('big'));
    main.append(img);
  }
}

function setLabel(turn, text) {
  if (!turn.finished) turn.label.textContent = text;
}

const liveLabel = (turn, doing) => `${turn.who || 'Çalışıyor'}${turn.tools ? ` · ${turn.tools} adım` : ''}${doing ? ` — ${doing}` : ''}`;

function handleEvent(turn, ev) {
  switch (ev.type) {
    case 'route':
      turn.who = ev.route === 'needs_brain' ? currentBrainLabel() : ev.route === 'learned' ? 'Öğrenilmiş yol' : `Hızlı yol · ${ROUTE_NAMES[ev.route] || ev.route}`;
      setLabel(turn, liveLabel(turn, ev.route === 'needs_brain' ? 'düşünüyor' : ''));
      break;
    case 'status':
      if (/düşünüyor|başladı/.test(ev.text)) {
        turn.who = currentBrainLabel();
        setLabel(turn, liveLabel(turn, 'düşünüyor'));
      } else if (ev.text.startsWith('📌')) {
        if (turn.who !== 'Öğrenilmiş yol') turn.who = 'Tarif';
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
        // "#6" only means something to the brain: show the element's name instead.
        const named = String(ev.text || '').match(/Öğe: "([^"]+)"/)?.[1];
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
  for (const p of turn.pending) settleStep(p.li, { ok: false, detail: 'yarıda kaldı' });
  turn.pending = [];
  const who = ev.fast ? 'Hızlı yol (Jev)' : ev.learnedReplay ? `Öğrenilmiş yol${ev.brain ? ' + Claude' : ', Claude\'suz'}` : ev.recipe ? `Tarif: ${pretty(ev.recipe)}` : (MODEL_NAMES[ev.model] || BRAIN_NAMES[ev.brain] || 'JEVIS');
  const secs = ((ev.ms || 0) / 1000).toFixed(1);
  turn.activity.classList.remove('open');
  turn.activity.classList.add(ev.stopped ? 'failed' : 'done');
  turn.stateEl.replaceChildren(icon(ev.stopped ? 'x' : 'check'));
  turn.label.textContent = `${ev.stopped ? 'Durduruldu' : 'Bitti'} · ${who}${turn.tools ? ` · ${turn.tools} adım` : ''} · ${secs} sn`;
  if (!turn.steps.children.length) turn.activity.querySelector('.chev').remove();
  if (final) turn.body.append(el('div', 'answer', final));
  if (ev.learned?.name) {
    const note = el('div', 'learned-note');
    note.append(icon('bookmark'), document.createTextNode(ev.learned.updated ? 'Bu işi zaten biliyordum; öğrendiğim yolu güncelledim.' : 'Bunu öğrendim. Benzer bir komutu bir dahaki sefere Claude\'a sormadan yaparım.'));
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
  turn.label.textContent = 'Olmadı';
  if (!turn.steps.children.length) turn.activity.hidden = true;
  turn.body.append(el('div', 'answer error', message));
}

function addSaveRecipe(turn, runId) {
  const foot = el('div', 'turn-foot');
  const button = el('button', 'link-btn');
  button.type = 'button';
  button.append(icon('bookmark'), document.createTextNode('Tarif olarak kaydet'));
  button.addEventListener('click', () => {
    const form = el('form', 'inline-form');
    const input = el('input');
    input.placeholder = 'Tarifin adı, ör. appstore-fiyat';
    input.required = true;
    const save = el('button', 'btn btn-primary', 'Kaydet');
    save.type = 'submit';
    const cancel = el('button', 'btn btn-ghost', 'Vazgeç');
    cancel.type = 'button';
    cancel.addEventListener('click', () => form.replaceWith(button));
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const res = await api('/api/recipes', { method: 'POST', body: JSON.stringify({ name: input.value.trim(), runId }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return toast(`Kaydedilemedi: ${data.error || res.status}`);
      foot.replaceChildren(el('span', 'recipe-meta', `Tarif kaydedildi: ${pretty(data.recipe.name)} (${data.recipe.steps.length} adım)`));
      toast('Tarif kaydedildi');
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
  setStatus(on ? 'busy' : 'ready', on ? 'Çalışıyor…' : 'Hazır');
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
    if (!turn.finished) failTurn(turn, 'Bağlantı yarıda kesildi.');
  } catch (err) {
    failTurn(turn, `Bağlantı hatası: ${err.message}`);
  } finally {
    setRunning(false);
  }
  // "yeni sohbet" said here: show the clean page; otherwise remember what is on screen.
  const { chat } = await (await api('/api/chats/current')).json().catch(() => ({}));
  if (newChatDone) { renderChat(chat); toast('Yeni sohbet açıldı.'); } else if (chat?.id === state.chatId) state.shownEntries = chat.entries.length;
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

const SOURCES = { bar: 'Çubuktan', cli: 'Terminalden', voice: 'Sesle' };
const VIA_ROUTE = { fast: { fast: true }, learned: { learnedReplay: true }, recipe: { recipe: 'tarif' } };

function showChatTitle(title) {
  $('chatTitle').textContent = title && title !== 'Yeni sohbet' ? short(title, 36) : '';
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
  if (m < 1) return 'az önce';
  if (m < 60) return `${m} dk önce`;
  if (m < 1440) return `${Math.round(m / 60)} saat önce`;
  return new Date(t).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
};

async function loadChats() {
  const { chats } = await (await api('/api/chats')).json();
  const list = $('chatList');
  if (!chats.length) { list.replaceChildren(el('div', 'empty', 'Henüz sohbet yok.')); return; }
  list.replaceChildren(...chats.map(c => {
    const item = el('div', `chat-item${c.id === state.chatId ? ' current' : ''}`);
    const textBox = el('div', 'chat-item-text');
    textBox.append(el('div', 'chat-item-title', c.title), el('div', 'chat-item-meta', `${c.count} komut · ${ago(c.updated)}`));
    const del = el('button', 'icon-btn');
    del.title = 'Sil';
    del.append(icon('trash'));
    del.addEventListener('click', async e => {
      e.stopPropagation();
      if (!del.dataset.sure) { del.dataset.sure = '1'; del.title = 'Emin misin? Tekrar bas'; del.classList.add('danger'); setTimeout(() => { delete del.dataset.sure; del.classList.remove('danger'); }, 3000); return; }
      await api('/api/chats/delete', { method: 'POST', body: JSON.stringify({ id: c.id }) });
      if (c.id === state.chatId) renderChat(null);
      loadChats();
    });
    item.append(textBox, del);
    item.addEventListener('click', async () => {
      if (state.running) return toast('Önce çalışan işi bitir ya da durdur.');
      const { chat } = await (await api('/api/chats/switch', { method: 'POST', body: JSON.stringify({ id: c.id }) })).json();
      renderChat(chat);
      closeDrawer();
    });
    return item;
  }));
}

async function startNewChat() {
  if (state.running) return toast('Önce çalışan işi bitir ya da durdur.');
  const { chat } = await (await api('/api/chats/new', { method: 'POST' })).json();
  renderChat(chat);
  closeDrawer();
  input.focus();
}

sendBtn.addEventListener('click', submit);
stopBtn.addEventListener('click', async () => {
  setStatus('stopping', 'Durduruluyor…');
  await api('/api/stop', { method: 'POST' });
});

$('newChatBtn').addEventListener('click', () => startNewChat().catch(err => toast(err.message)));
$('newChatInDrawer').addEventListener('click', () => startNewChat().catch(err => toast(err.message)));
$('chatsBtn').addEventListener('click', () => openDrawer('chatsDrawer'));

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
  $('modelSwitch').title = claude ? '' : 'Model seçimi sadece Claude Code beyninde';
}

$('brainSelect').addEventListener('change', e => {
  state.brain = e.target.value;
  store.set('brain', state.brain);
  syncBrain();
});

async function loadBrains() {
  const data = await (await api('/api/brains')).json();
  const cc = data.claudeCode || {};
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
    [s.jev, 'Jev (karar modeli)', 'TypeSafe anahtarı yok (.env › JEV_KEY)'],
    [s.claude, 'Claude Code (aboneliğin)', 'claude komutu bulunamadı'],
    [s.chrome, 'JEVIS Chrome', 'Chrome bulunamadı'],
    [s.voice, 'Ses tanıma (whisper)', 'kurulu değil']
  ];
  $('statusList').replaceChildren(...rows.map(([ok, label, fix]) => {
    const li = el('li');
    const mark = el('span', ok ? 'ok' : 'no');
    mark.append(icon(ok ? 'check' : 'x'));
    li.append(mark, el('span', null, ok ? label : `${label}: ${fix}`));
    return li;
  }));
}

// ---------------------------------------------------------------------------
// Drawers: settings and recipes
// ---------------------------------------------------------------------------

let openDrawerId = null;

function openDrawer(id) {
  closeDrawer();
  openDrawerId = id;
  $('scrim').hidden = false;
  $(id).hidden = false;
  if (id === 'recipesDrawer') loadRecipes();
  if (id === 'chatsDrawer') loadChats().catch(err => toast(err.message));
  if (id === 'settingsDrawer') loadStatus().catch(() => {});
}

function closeDrawer() {
  if (!openDrawerId) return;
  $(openDrawerId).hidden = true;
  $('scrim').hidden = true;
  openDrawerId = null;
}

$('settingsBtn').addEventListener('click', () => openDrawer('settingsDrawer'));
$('recipesBtn').addEventListener('click', () => openDrawer('recipesDrawer'));
$('scrim').addEventListener('click', closeDrawer);
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeDrawer));
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });

async function loadRecipes() {
  const { recipes } = await (await api('/api/recipes')).json();
  const list = $('recipeList');
  if (!recipes.length) {
    list.replaceChildren(el('div', 'empty', 'Henüz tarif yok. Bir işi bitirince altındaki "Tarif olarak kaydet"e bas.'));
    return;
  }
  list.replaceChildren(...recipes.map(recipeCard));
}

function recipeCard(r) {
  const card = el('div', 'recipe');
  const top = el('div', 'recipe-top');
  if (r.learned) {
    top.append(el('span', 'recipe-name', r.pattern), el('span', 'recipe-badge', 'öğrenildi'));
    card.append(top, el('div', 'recipe-desc', `${r.steps} adım · ${r.uses ? `${r.uses} kez Claude'suz yapıldı` : 'henüz tekrar kullanılmadı'}`));
  } else {
    top.append(el('span', 'recipe-name', pretty(r.name)), el('span', 'recipe-meta', `${r.steps} adım`));
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
  run.append(icon('play'), document.createTextNode('Çalıştır'));
  run.addEventListener('click', () => {
    const missing = inputs.find(i => !i.value.trim());
    if (missing) { missing.focus(); return toast(`"${missing.name}" değerini yaz`); }
    inputs.forEach(i => store.set(`var_${r.name}_${i.name}`, i.value));
    const args = inputs.map(i => `${i.name}="${i.value.replace(/"/g, '')}"`).join(' ');
    closeDrawer();
    send(`tarif: ${r.name} ${args}`.trim());
  });
  const del = el('button', 'btn btn-danger-ghost');
  del.append(icon('trash'), document.createTextNode('Sil'));
  del.addEventListener('click', async () => {
    if (!del.dataset.sure) {
      del.dataset.sure = '1';
      del.lastChild.textContent = 'Emin misin?';
      setTimeout(() => { delete del.dataset.sure; del.lastChild.textContent = 'Sil'; }, 3000);
      return;
    }
    await api('/api/recipes/delete', { method: 'POST', body: JSON.stringify({ name: r.name }) });
    toast('Tarif silindi');
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
const HINT = 'Enter ile gönder · Shift+Enter yeni satır';
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
    hint.textContent = `Dinliyorum… 0:${String(s).padStart(2, '0')} · bırakınca gönderilir`;
  }, 250);
  recording = { stream, ctx, node, chunks, started, timer };
  composer.classList.add('recording');
  setStatus('listening', 'Dinliyorum…');
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
  if (samples.length < 16000 * 0.4) { setStatus('ready', 'Hazır'); return; }
  setStatus('busy', 'Yazıya çeviriyorum…');
  const res = await fetch('/api/voice', { method: 'POST', headers: { 'Content-Type': 'audio/wav', 'X-Jevis-Token': TOKEN }, body: toWav(samples, 16000) });
  const data = await res.json().catch(() => ({}));
  setStatus('ready', 'Hazır');
  if (!res.ok) return toast(`Ses çevrilemedi: ${data.error || res.status}`);
  if (!data.text) return toast('Bir şey duyamadım, tekrar dener misin?');
  send(data.text);
}

// Hold to talk; a short tap toggles instead (tap to start, tap to stop).
let pressedAt = 0;
micBtn.addEventListener('pointerdown', async () => {
  if (recording) return;
  pressedAt = Date.now();
  try { await startListening(); } catch (err) { toast(`Mikrofon açılamadı: ${err.message}`); }
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

init().catch(err => toast(`Yüklenemedi: ${err.message}`));
