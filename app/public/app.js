// JEVIS chat UI. Everything shown here can come from web pages or tools:
// untrusted text always goes through textContent, never innerHTML.

const TOKEN = document.querySelector('meta[name="jevis-token"]')?.content || '';
const api = (path, options = {}) => fetch(path, {
  ...options,
  headers: { 'Content-Type': 'application/json', 'X-Jevis-Token': TOKEN, ...(options.headers || {}) }
});
const $ = id => document.getElementById(id);

const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(`jevis_${key}`); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(`jevis_${key}`, JSON.stringify(value)); } catch {}
  }
};

const state = {
  running: false,
  sessionId: null,
  sessionKey: null,
  brain: 'claude-code',
  model: null,
  effort: null,
  fast: store.get('fast', true),
  speak: store.get('speak', false)
};

const MODEL_NAMES = { 'claude-sonnet-5': 'Sonnet 5', 'claude-opus-5-5': 'Opus 5.5', 'claude-haiku-4-5': 'Haiku 4.5' };
const BRAIN_NAMES = { 'claude-code': 'Claude Code', codex: 'Codex', anthropic: 'Claude API', openai: 'OpenAI uyumlu', ollama: 'Ollama' };
const ROUTE_NAMES = { system_quick: 'sistem komutu', page_click: 'sayfada tıklama' };

// ---------------------------------------------------------------------------
// Small DOM helpers
// ---------------------------------------------------------------------------

const ICONS = {
  zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  'chevron-down': '<polyline points="6 9 12 15 18 9"/>',
  globe: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  pointer: '<path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="M13 13l6 6"/>',
  type: '<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/>',
  list: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
  'check-square': '<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  command: '<path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z"/>',
  'arrow-down': '<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>',
  back: '<polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>',
  layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  'check-circle': '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
  power: '<path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/>',
  sliders: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  bookmark: '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
  play: '<polygon points="5 3 19 12 5 21 5 3"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'
};

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = ICONS[name] || ICONS.zap; // fixed strings above, never user data
  return svg;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const short = (s, n = 60) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const host = url => { try { return new URL(/^[a-z]+:/i.test(url) ? url : `https://${url}`).host || url; } catch { return url; } };
const pretty = name => String(name).replace(/-/g, ' ');

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
// What each tool call looks like to a person
// ---------------------------------------------------------------------------

const MAC_ACTIONS = {
  volume: a => `Ses %${a.value} yapılıyor`, mute: () => 'Ses kapatılıyor', unmute: () => 'Ses açılıyor',
  play_pause: () => 'Müzik başlat/durdur', next_track: () => 'Sonraki şarkı', previous_track: () => 'Önceki şarkı',
  dark_mode: () => 'Görünüm değiştiriliyor', lock_screen: () => 'Ekran kilitleniyor', notify: a => `Bildirim: ${short(a.value)}`,
  spotify_search: a => `Spotify'da aranıyor: ${short(a.value)}`, note: a => `Not ekleniyor: ${short(a.title || a.value)}`
};

const STEPS = {
  browser_open: [a => `Sayfa açılıyor: ${host(a.url)}`, 'globe'],
  browser_read: [() => 'Sayfa okunuyor', 'eye'],
  browser_click: [a => `Tıklanıyor: ${short(a.target)}`, 'pointer'],
  browser_type: [a => `Yazılıyor: “${short(a.text, 40)}” → ${short(a.target, 30)}`, 'type'],
  browser_select: [a => `Seçiliyor: ${short(a.option, 30)} (${short(a.target, 30)})`, 'list'],
  browser_check: [a => `${a.checked === false ? 'İşaret kaldırılıyor' : 'İşaretleniyor'}: ${short(a.target)}`, 'check-square'],
  browser_upload: [a => `Dosya yükleniyor: ${String(a.file_path || '').split('/').pop()}`, 'upload'],
  browser_fill_secret: [a => `Şifre giriliyor (${a.secret})`, 'lock'],
  wait_for_user: [a => `Seni bekliyor: ${short(a.message, 80)}`, 'user'],
  browser_press: [a => `Tuş: ${a.key}`, 'command'],
  browser_scroll: [a => `Sayfa kaydırılıyor${a.direction === 'up' ? ' (yukarı)' : ''}`, 'arrow-down'],
  browser_back: [() => 'Geri gidiliyor', 'back'],
  browser_tabs: [a => (a.action === 'switch' ? `Sekmeye geçiliyor: ${short(a.tab)}` : a.action === 'close' ? 'Sekme kapatılıyor' : 'Sekmelere bakılıyor'), 'layers'],
  browser_screenshot: [() => 'Sayfanın görüntüsü alınıyor', 'camera'],
  browser_verify: [a => `Kontrol ediliyor: ${short(a.expectation, 70)}`, 'check-circle'],
  browser_wait: [a => (a.text ? `Bekleniyor: “${short(a.text, 40)}”` : 'Bekleniyor'), 'clock'],
  desktop_apps: [() => 'Açık uygulamalara bakılıyor', 'grid'],
  desktop_open_app: [a => `Uygulama açılıyor: ${a.name}`, 'monitor'],
  desktop_quit_app: [a => `Uygulama kapatılıyor: ${a.name}`, 'power'],
  desktop_read: [a => `${a.app || 'Öndeki uygulama'} okunuyor`, 'eye'],
  desktop_click: [a => `Basılıyor: ${short(a.target)}${a.app ? ` (${a.app})` : ''}`, 'pointer'],
  desktop_type: [a => `Yazılıyor: “${short(a.text, 40)}”${a.target ? ` → ${short(a.target, 30)}` : ''}`, 'type'],
  desktop_key: [a => `Kısayol: ${a.keys}`, 'command'],
  desktop_screenshot: [() => 'Pencerenin görüntüsü alınıyor', 'camera'],
  mac_action: [a => (MAC_ACTIONS[a.action] || (() => a.action))(a), 'sliders'],
  jev_ask: [() => 'Jev\'e soruluyor', 'zap']
};

function describe(name, args = {}) {
  const entry = STEPS[name];
  return entry ? entry[0](args || {}) : name;
}
const stepIcon = name => (STEPS[name]?.[1]) || (String(name).startsWith('mac:') ? 'sliders' : 'zap');

// First lines of a tool result: "Öğe: …", "Şu an: …", or the error.
function summarize(text) {
  const lines = String(text || '').split('\n').map(s => s.trim()).filter(Boolean);
  return lines.slice(0, 2).join(' · ').replace(/\s+/g, ' ').slice(0, 180);
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
      turn.who = ev.route === 'needs_brain' ? currentBrainLabel() : `Hızlı yol · ${ROUTE_NAMES[ev.route] || ev.route}`;
      setLabel(turn, liveLabel(turn, ev.route === 'needs_brain' ? 'düşünüyor' : ''));
      break;
    case 'status':
      if (/düşünüyor|başladı/.test(ev.text)) {
        turn.who = currentBrainLabel();
        setLabel(turn, liveLabel(turn, 'düşünüyor'));
      } else if (ev.text.startsWith('📌')) {
        turn.who = 'Tarif';
        setLabel(turn, ev.text.replace(/^📌\s*/, ''));
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
  const who = ev.fast ? 'Hızlı yol (Jev)' : ev.recipe ? `Tarif: ${pretty(ev.recipe)}` : (MODEL_NAMES[ev.model] || BRAIN_NAMES[ev.brain] || 'JEVIS');
  const secs = ((ev.ms || 0) / 1000).toFixed(1);
  turn.activity.classList.remove('open');
  turn.activity.classList.add(ev.stopped ? 'failed' : 'done');
  turn.stateEl.replaceChildren(icon(ev.stopped ? 'x' : 'check'));
  turn.label.textContent = `${ev.stopped ? 'Durduruldu' : 'Bitti'} · ${who}${turn.tools ? ` · ${turn.tools} adım` : ''} · ${secs} sn`;
  if (!turn.steps.children.length) turn.activity.querySelector('.chev').remove();
  if (final) turn.body.append(el('div', 'answer', final));
  if (ev.sessionId) {
    state.sessionId = ev.sessionId;
    state.sessionKey = sessionKey();
  }
  if (!ev.fast && !ev.recipe && !ev.stopped && ev.runId && turn.steps.querySelector('.step.ok')) addSaveRecipe(turn, ev.runId);
  if (state.speak && final) api('/api/say', { method: 'POST', body: JSON.stringify({ text: final }) });
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
const sessionKey = () => `${state.brain}|${state.model}`;

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
  showWelcome(false);
  addUser(text);
  const turn = newTurn();
  if (state.sessionKey && state.sessionKey !== sessionKey()) state.sessionId = null;
  setRunning(true);
  try {
    const res = await api('/api/run', {
      method: 'POST',
      body: JSON.stringify({
        text,
        brain: state.brain,
        sessionId: state.sessionId,
        fast: state.fast,
        ...(state.brain === 'claude-code' ? { model: state.model, effort: state.effort } : {})
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      failTurn(turn, err.error || `Sunucu hata verdi (${res.status}).`);
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.trim()) handleEvent(turn, JSON.parse(line));
      }
    }
    if (!turn.finished) failTurn(turn, 'Bağlantı yarıda kesildi.');
  } catch (err) {
    failTurn(turn, `Bağlantı hatası: ${err.message}`);
  } finally {
    setRunning(false);
  }
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

sendBtn.addEventListener('click', submit);
stopBtn.addEventListener('click', async () => {
  setStatus('stopping', 'Durduruluyor…');
  await api('/api/stop', { method: 'POST' });
});

$('newChatBtn').addEventListener('click', () => {
  if (state.running) return toast('Önce çalışan işi bitir ya da durdur.');
  state.sessionId = null;
  state.sessionKey = null;
  $('messages').replaceChildren();
  showWelcome(true);
  input.focus();
});

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
  top.append(el('span', 'recipe-name', pretty(r.name)), el('span', 'recipe-meta', `${r.steps} adım`));
  card.append(top);
  if (r.description) card.append(el('div', 'recipe-desc', r.description));

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

function toWav(samples, rate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (offset, s) => [...s].forEach((ch, i) => view.setUint8(offset + i, ch.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 0x7fff, true));
  return buffer;
}

// Resamples to the 16 kHz whisper.cpp expects with the browser's own
// resampler (a plain average smears speech and hurts accuracy).
async function resample(chunks, fromRate, toRate) {
  const data = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) { data.set(c, offset); offset += c.length; }
  const offline = new OfflineAudioContext(1, Math.ceil(data.length * toRate / fromRate), toRate);
  const buffer = offline.createBuffer(1, data.length, fromRate);
  buffer.copyToChannel(data, 0);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start();
  return (await offline.startRendering()).getChannelData(0);
}

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
  input.focus();
}

init().catch(err => toast(`Yüklenemedi: ${err.message}`));
