// The compact JEVIS bar. JEVIS.app shows it on a floating panel at the top of
// the screen (⌥Space, or "Hey Jev"); it talks to the app through
// window.webkit.messageHandlers.bar and the app calls window.jevisBar.
// Typing: Enter sends, Esc hides. Voice: the app streams the words as they
// are heard and hands over the finished phrase, which is sent after a short
// countdown unless the user edits it (any key) or cancels it (Esc).

const bar = $('bar');
const input = $('input');
const panel = $('panel');
const now = $('now');
const nowText = $('nowText');
const stepsList = $('steps');
const answer = $('answer');
const foot = $('foot');
const countdown = $('countdown');

const nativeBridge = window.webkit?.messageHandlers?.bar;
const native = msg => { try { nativeBridge?.postMessage(msg); } catch {} };
if (!nativeBridge) document.body.classList.add('standalone');

const MODELS = [['claude-sonnet-5', 'Hızlı'], ['claude-opus-5-5', 'Güçlü']];
const STOP_WORDS = /^(dur|durdur|iptal|vazgeç|stop)[.!]*$/i;

const run = { active: false, finishedAt: 0, tools: 0, fromVoice: false };
const voice = { listening: false, pending: null, edited: false };
let hideTimer = null;

// ---------------------------------------------------------------------------
// Size and state towards the app
// ---------------------------------------------------------------------------

new ResizeObserver(() => native({ type: 'height', value: Math.ceil(bar.getBoundingClientRect().height) })).observe(bar);

function setState(name) {
  bar.dataset.state = name;
  native({ type: 'busy', value: name !== 'idle' });
}

function scheduleHide(ms) {
  clearTimeout(hideTimer);
  if (ms) hideTimer = setTimeout(() => { if (!bar.matches(':hover')) native({ type: 'hide' }); else scheduleHide(3000); }, ms);
}

// ---------------------------------------------------------------------------
// Model chip (shared with the chat window)
// ---------------------------------------------------------------------------

const modelBtn = $('modelBtn');
function showModel() {
  const model = store.get('model', MODELS[0][0]);
  const entry = MODELS.find(([id]) => id === model) || MODELS[0];
  modelBtn.textContent = entry[1];
  modelBtn.classList.toggle('strong', entry[0] === MODELS[1][0]);
  modelBtn.title = `Model: ${entry[1]} (${MODEL_NAMES[entry[0]]}). Değiştirmek için tıkla.`;
}
modelBtn.addEventListener('click', () => {
  const current = store.get('model', MODELS[0][0]);
  store.set('model', current === MODELS[0][0] ? MODELS[1][0] : MODELS[0][0]);
  showModel();
  input.focus();
});
showModel();

$('expandBtn').addEventListener('click', () => native({ type: 'openMain' }));
$('micBtn').addEventListener('click', () => native({ type: 'mic' }));

// ---------------------------------------------------------------------------
// Result panel
// ---------------------------------------------------------------------------

function clearPanel() {
  panel.hidden = true;
  now.hidden = true;
  stepsList.replaceChildren();
  answer.hidden = true;
  answer.textContent = '';
  answer.classList.remove('error');
  foot.hidden = true;
  foot.replaceChildren();
}

function addStep(title) {
  const li = el('li');
  li.append(el('span', null, title));
  stepsList.append(li);
  while (stepsList.children.length > 5) stepsList.firstChild.remove();
  return li;
}

const pending = [];
function handle(ev) {
  switch (ev.type) {
    case 'route':
      if (ev.route === 'learned') nowText.textContent = 'Öğrendiğim yoldan yapıyorum…';
      else if (ev.route === 'needs_brain') nowText.textContent = `${MODEL_NAMES[store.get('model', MODELS[0][0])] || 'Claude'} düşünüyor…`;
      else nowText.textContent = `Hızlı yol · ${ROUTE_NAMES[ev.route] || ev.route}`;
      break;
    case 'status':
      if (!/^📌/.test(ev.text)) nowText.textContent = ev.text.replace(/^[^\p{L}\p{N}"“]+/u, '');
      break;
    case 'tool': {
      run.tools++;
      const title = describe(ev.name, ev.args);
      nowText.textContent = title;
      pending.push({ name: ev.name, li: addStep(title) });
      break;
    }
    case 'tool_result': {
      const i = pending.findIndex(p => p.name === ev.name);
      if (i >= 0) pending.splice(i, 1)[0].li.classList.add(ev.isError ? 'fail' : 'ok');
      break;
    }
    case 'done':
      finish(ev);
      break;
    case 'error':
      fail(ev.message);
      break;
  }
}

function finish(ev) {
  run.active = false;
  run.finishedAt = Date.now();
  now.hidden = true;
  for (const p of pending.splice(0)) p.li.classList.add('fail');
  const text = ev.text || '';
  answer.textContent = text || (ev.stopped ? 'Durduruldu.' : 'Tamam.');
  answer.hidden = false;
  const who = ev.fast ? 'Hızlı yol' : ev.learnedReplay ? `Öğrenilmiş yol${ev.brain ? ' + Claude' : ''}` : ev.recipe ? `Tarif: ${pretty(ev.recipe)}` : (MODEL_NAMES[ev.model] || 'JEVIS');
  const bits = [`${ev.stopped ? 'Durduruldu' : 'Bitti'} · ${who}${run.tools ? ` · ${run.tools} adım` : ''} · ${((ev.ms || 0) / 1000).toFixed(1)} sn`];
  if (ev.learned?.name) bits.push('Bunu öğrendim; bir dahakine Claude\'suz');
  foot.replaceChildren(...bits.map(b => el('span', null, b)));
  const more = el('a', null, 'Ayrıntılar');
  more.href = '#';
  more.addEventListener('click', e => { e.preventDefault(); native({ type: 'openMain' }); });
  foot.append(more);
  foot.hidden = false;
  if (ev.sessionId) saveSession(ev.sessionId, sessionKey());
  if (run.fromVoice && text) api('/api/say', { method: 'POST', body: JSON.stringify({ text }) }).catch(() => {});
  setState('idle');
  scheduleHide(text.length > 160 ? 20000 : 9000);
}

function fail(message) {
  run.active = false;
  run.finishedAt = Date.now();
  now.hidden = true;
  for (const p of pending.splice(0)) p.li.classList.add('fail');
  answer.textContent = message;
  answer.classList.add('error');
  answer.hidden = false;
  setState('idle');
  scheduleHide(12000);
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

const sessionKey = () => `${store.get('brain', 'claude-code')}|${store.get('model', MODELS[0][0])}`;

async function submit(text, { fromVoice = false } = {}) {
  text = String(text ?? input.value).trim();
  if (!text) return;
  cancelCountdown();
  if (STOP_WORDS.test(text)) {
    input.value = '';
    if (run.active) await api('/api/stop', { method: 'POST' }).catch(() => {});
    else native({ type: 'hide' });
    return;
  }
  if (run.active) return;
  clearTimeout(hideTimer);
  clearPanel();
  input.value = text;
  input.select();
  Object.assign(run, { active: true, tools: 0, fromVoice });
  panel.hidden = false;
  now.hidden = false;
  nowText.textContent = 'Anlıyorum…';
  setState('busy');
  const brain = store.get('brain', 'claude-code');
  try {
    await runStream({
      text,
      brain,
      sessionId: loadSession(sessionKey()),
      fast: store.get('fast', true),
      source: 'bar',
      ...(brain === 'claude-code' ? { model: store.get('model', MODELS[0][0]), effort: store.get('effort', undefined) } : {})
    }, handle);
    if (run.active) fail('Bağlantı yarıda kesildi.');
  } catch (err) {
    if (run.active) fail(`Bağlantı hatası: ${err.message}`);
  }
}

$('stopBtn').addEventListener('click', () => api('/api/stop', { method: 'POST' }).catch(() => {}));

input.addEventListener('keydown', e => {
  if (e.isComposing) return;
  if (e.key === 'Enter') {
    e.preventDefault();
    submit(input.value, { fromVoice: Boolean(voice.pending) && !voice.edited });
  } else if (e.key === 'Escape') {
    e.preventDefault();
    if (voice.listening) native({ type: 'stopVoice' });
    if (voice.pending) { cancelCountdown(); input.value = ''; return; }
    native({ type: 'hide' });
  } else if (voice.pending) {
    // Touching the keyboard means "let me fix it": no automatic send.
    voice.edited = true;
    cancelCountdown();
  }
});
input.addEventListener('input', () => clearTimeout(hideTimer));

// ---------------------------------------------------------------------------
// Voice (the app listens; see JEVIS.swift)
// ---------------------------------------------------------------------------

function cancelCountdown() {
  countdown.classList.remove('running');
  if (voice.pending) voice.pending.cancelled = true;
  voice.pending = null;
}

async function voiceFinished({ text, file }) {
  voice.listening = false;
  setState(run.active ? 'busy' : 'idle');
  input.placeholder = "JEVIS'e söyle…";
  const heard = String(text || '').trim();
  if (!heard && !file) { input.value = ''; return; }
  input.value = heard;
  voice.edited = false;
  const job = { cancelled: false };
  voice.pending = job;
  const ms = Number(store.get('voiceCountdownMs', 900));
  countdown.style.setProperty('--count-ms', `${ms}ms`);
  countdown.classList.remove('running');
  void countdown.offsetWidth; // restart the animation
  countdown.classList.add('running');
  const wait = new Promise(r => setTimeout(r, ms));
  // whisper knows names like JEVIS, VS Code and Claude better than the live recognizer.
  let better = null;
  if (file) {
    try {
      const res = await api('/api/voice/file', { method: 'POST', body: JSON.stringify({ file }) });
      better = (await res.json()).text || null;
    } catch {}
  }
  if (better && !voice.edited && voice.pending === job) input.value = better;
  await wait;
  if (job.cancelled || voice.pending !== job || voice.edited) return;
  voice.pending = null;
  countdown.classList.remove('running');
  const finalText = input.value.trim();
  if (finalText) submit(finalText, { fromVoice: true });
  else native({ type: 'hide' });
}

// ---------------------------------------------------------------------------
// Called by JEVIS.app
// ---------------------------------------------------------------------------

window.jevisBar = {
  show(mode = 'type') {
    clearTimeout(hideTimer);
    if (!run.active && Date.now() - run.finishedAt > 60000) { clearPanel(); input.value = ''; }
    showModel();
    input.focus();
    if (mode === 'type') input.select();
  },
  hidden() {
    clearTimeout(hideTimer);
    if (voice.listening) native({ type: 'stopVoice' });
    cancelCountdown();
  },
  voice(ev) {
    switch (ev.type) {
      case 'start':
        clearTimeout(hideTimer);
        cancelCountdown();
        voice.listening = true;
        voice.edited = false;
        input.value = '';
        input.placeholder = 'Dinliyorum…';
        setState('listening');
        break;
      case 'partial':
        if (!voice.edited) input.value = ev.text || '';
        break;
      case 'final':
        voiceFinished(ev);
        break;
      case 'cancel':
        voice.listening = false;
        input.placeholder = "JEVIS'e söyle…";
        setState(run.active ? 'busy' : 'idle');
        break;
      case 'error':
        voice.listening = false;
        input.placeholder = "JEVIS'e söyle…";
        setState(run.active ? 'busy' : 'idle');
        panel.hidden = false;
        answer.hidden = false;
        answer.classList.add('error');
        answer.textContent = ev.message || 'Mikrofon çalışmadı.';
        break;
    }
  },
  submit
};

input.focus();
