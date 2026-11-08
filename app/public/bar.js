// Handry · © 2026 Berat Olekli (purplefox) · github.com/purplefox21/handry
// The compact Handry bar. Handry.app shows it on a floating panel at the top of
// the screen (⌥Space, or "Hey Handry"); it talks to the app through
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

const MODELS = [['claude-sonnet-5-5', T('Hızlı', 'Fast')], ['claude-opus-5-5', T('Güçlü', 'Strong')]];
const STOP_WORDS = /^(dur|durdur|iptal|vazgeç|stop|cancel)[.!]*$/i;

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
// The picked model, or the first one if the saved pick is no longer offered
// (so the chip and what is sent always agree).
function currentModel() {
  const model = store.get('model', MODELS[0][0]);
  return MODELS.some(([id]) => id === model) ? model : MODELS[0][0];
}

function showModel() {
  const entry = MODELS.find(([id]) => id === currentModel());
  modelBtn.textContent = entry[1];
  modelBtn.classList.toggle('strong', entry[0] === MODELS[1][0]);
  modelBtn.title = T(`Model: ${entry[1]} (${MODEL_NAMES[entry[0]]}). Değiştirmek için tıkla.`, `Model: ${entry[1]} (${MODEL_NAMES[entry[0]]}). Click to change it.`);
}
modelBtn.addEventListener('click', () => {
  store.set('model', currentModel() === MODELS[0][0] ? MODELS[1][0] : MODELS[0][0]);
  showModel();
  input.focus();
});
showModel();
api('/api/brains').then(r => r.json()).then(d => { adoptDefaultModel(d.claudeCode?.model); showModel(); }).catch(() => {});

$('expandBtn').addEventListener('click', () => native({ type: 'openMain' }));
$('micBtn').addEventListener('click', () => native({ type: 'mic' }));
$('penBtn').addEventListener('click', () => native({ type: 'pen' }));

// ---------------------------------------------------------------------------
// The pen: a question asked here goes with the user's drawing (Handry.app opens the bar after they drew).
// It can also go on to a Claude Code session open in VS Code.
// ---------------------------------------------------------------------------

const penChip = $('penChip');
const restPlaceholder = () => (pen.on ? T('Çizdiğin yer hakkında sor…', 'Ask about what you drew…') : SAY_TO);
const penTargets = $('penTargets');
const pen = { on: false };
function setPen(on) {
  pen.on = Boolean(on);
  penChip.hidden = !pen.on;
  input.placeholder = restPlaceholder();
  penTargets.hidden = true;
  penTargets.replaceChildren();
  if (pen.on) showPenTargets();
}
async function showPenTargets() {
  try {
    const { targets = [] } = await (await api('/api/marks')).json();
    if (!pen.on || !targets.length) return;
    const label = document.createElement('span');
    label.textContent = T('ya da gönder:', 'or send to:');
    penTargets.append(label, ...targets.slice(0, 3).map(t => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = `→ ${t.name} (Claude)`;
      b.title = T(`Soruyu çizimle birlikte VS Code'daki "${t.name}" oturumuna yaz`, `Write the question with the drawing to the "${t.name}" session in VS Code`);
      b.addEventListener('click', () => forwardPen(t));
      return b;
    }));
    penTargets.hidden = false;
  } catch {}
}
async function forwardPen(target) {
  const text = input.value.trim();
  if (!text) { input.focus(); input.placeholder = T('Önce sorunu yaz…', 'Write your question first…'); return; }
  clearPanel();
  panel.hidden = false;
  answer.hidden = false;
  try {
    const res = await api('/api/marks/forward', { method: 'POST', body: JSON.stringify({ session: target.id || target.name, text }) });
    const out = await res.json();
    if (!res.ok) throw new Error(out.error);
    answer.textContent = T(`Gönderildi: "${out.session}" oturumu çizimine bakıp cevap verecek.`, `Sent: the "${out.session}" session will look at your drawing and answer.`);
    input.value = '';
    setPen(false);
    scheduleHide(6000);
  } catch (err) {
    answer.classList.add('error');
    answer.textContent = err.message;
  }
}
penChip.addEventListener('click', () => setPen(false));

// ---------------------------------------------------------------------------
// Timers: "⏰ 2" when some wait; a click lists them (✕ asks once more). A
// shutdown countdown opens the list by itself with a big Cancel (İptal) and keeps the
// bar up until it is over.
// ---------------------------------------------------------------------------

const timersChip = $('timersChip');
const timersPanel = $('timersPanel');
const timerRows = $('timerRows');
const alarm = $('alarm');
const timers = { jobs: [], open: false, alarmOn: false };

async function refreshTimers() {
  try { timers.jobs = await fetchTimers(); } catch { return; }
  renderTimers();
}

function timerRow(job) {
  const li = el('li', 'timer-row');
  li.dataset.id = job.id;
  const text = el('div', 'timer-row-text');
  text.append(el('div', 'timer-row-title', job.what), el('div', 'timer-row-sub'));
  // A click opens the chat it was asked in, in the big window.
  if (job.chatId) {
    li.classList.add('linked');
    li.title = T('Kurulduğu sohbeti aç', 'Open the chat it was set in');
    text.addEventListener('click', async () => {
      await api('/api/chats/switch', { method: 'POST', body: JSON.stringify({ id: job.chatId }) });
      native({ type: 'openMain' });
    });
  }
  const x = el('button', 'icon-btn timer-x', '✕');
  x.type = 'button';
  x.title = T('İptal', 'Cancel');
  twoStep(x, T('İptal?', 'Cancel?'), async () => { await cancelTimer(job.id); refreshTimers(); });
  li.append(text, x);
  return li;
}

function renderTimers() {
  const { jobs } = timers;
  timersChip.hidden = !jobs.length;
  timersChip.textContent = `⏰ ${jobs.length}`;
  const firing = jobs.find(j => j.firing);
  if (!jobs.length) timers.open = false;
  alarm.hidden = !firing;
  if (firing) alarm.dataset.id = firing.id;
  // Keep the bar up while a shutdown is counting down (the app hides an idle bar).
  if (Boolean(firing) !== timers.alarmOn) {
    timers.alarmOn = Boolean(firing);
    if (firing) clearTimeout(hideTimer);
    native({ type: 'busy', value: timers.alarmOn || run.active });
  }
  timersPanel.hidden = !(timers.open || firing);
  const sig = jobs.filter(j => !j.firing).map(j => j.id).join();
  if (timerRows.dataset.sig !== sig) {
    timerRows.replaceChildren(...jobs.filter(j => !j.firing).map(timerRow));
    timerRows.dataset.sig = sig;
  }
  timerRows.hidden = !timers.open;
  updateTimerTexts();
}

function updateTimerTexts() {
  const firing = timers.jobs.find(j => j.firing);
  if (firing) $('alarmText').textContent = `${firing.what} · ${timerSub(firing)}`;
  for (const li of timerRows.children) {
    const job = timers.jobs.find(j => j.id === li.dataset.id);
    if (job) li.querySelector('.timer-row-sub').textContent = timerSub(job);
  }
}

timersChip.addEventListener('click', () => {
  timers.open = !timers.open;
  renderTimers();
  input.focus();
});
$('alarmCancel').addEventListener('click', async () => {
  await cancelTimer(alarm.dataset.id);
  refreshTimers();
});
setInterval(updateTimerTexts, 1000);
setInterval(refreshTimers, 3000);
refreshTimers();

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
      if (ev.route === 'learned') nowText.textContent = T('Öğrendiğim yoldan yapıyorum…', 'Doing it the way I learned…');
      else if (ev.route === 'needs_brain') nowText.textContent = T(`Claude (${MODEL_NAMES[currentModel()]}) düşünüyor…`, `Claude (${MODEL_NAMES[currentModel()]}) is thinking…`);
      else nowText.textContent = `${T('Hızlı yol', 'Fast path')} · ${ROUTE_NAMES[ev.route] || ev.route}`;
      break;
    case 'status':
      // "… başladı" ("… started") only says the brain program started; the line keeps "Claude düşünüyor".
      if (!/^📌/.test(ev.text) && !/(başladı|started)$/.test(ev.text)) nowText.textContent = ev.text.replace(/^[^\p{L}\p{N}"“]+/u, '');
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
  if (pen.on) setPen(false); // one question per drawing; draw again for the next one
  run.active = false;
  run.finishedAt = Date.now();
  now.hidden = true;
  for (const p of pending.splice(0)) p.li.classList.add('fail');
  const text = ev.text || '';
  answer.textContent = text || (ev.stopped ? T('Durduruldu.', 'Stopped.') : T('Tamam.', 'Done.'));
  answer.hidden = false;
  const who = ev.fast ? T('Hızlı yol', 'Fast path') : ev.learnedReplay ? `${T('Öğrenilmiş yol', 'Learned way')}${ev.brain ? ' + Claude' : ''}` : ev.recipe ? `${T('Tarif', 'Recipe')}: ${pretty(ev.recipe)}` : (MODEL_NAMES[ev.model] || APP_NAME);
  const bits = [`${ev.stopped ? T('Durduruldu', 'Stopped') : T('Bitti', 'Done')} · ${who}${run.tools ? ` · ${stepCount(run.tools)}` : ''} · ${((ev.ms || 0) / 1000).toFixed(1)} ${T('sn', 's')}`];
  if (ev.learned?.name) bits.push(T('Bunu öğrendim; bir dahakine Claude\'suz', 'Learned this; next time without Claude'));
  if (ev.chat) bits.push(ev.newChat ? T('Yeni sohbet', 'New chat') : `${T('Sohbet', 'Chat')}: ${short(ev.chat.title, 30)}`);
  foot.replaceChildren(...bits.map(b => el('span', null, b)));
  const more = el('a', null, T('Ayrıntılar', 'Details'));
  more.href = '#';
  more.addEventListener('click', e => { e.preventDefault(); native({ type: 'openMain' }); });
  foot.append(more);
  foot.hidden = false;
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
  penTargets.hidden = true;
  input.value = text;
  input.select();
  Object.assign(run, { active: true, tools: 0, fromVoice });
  panel.hidden = false;
  now.hidden = false;
  nowText.textContent = T('Anlıyorum…', 'Understanding…');
  setState('busy');
  const brain = store.get('brain', 'claude-code');
  try {
    await runStream({
      text,
      brain,
      ...(pen.on ? { marks: true } : {}),
      fast: store.get('fast', true),
      source: run.fromVoice ? 'voice' : 'bar',
      ...(brain === 'claude-code' ? { model: currentModel(), effort: store.get('effort', undefined) } : {})
    }, handle);
    if (run.active) fail(T('Bağlantı yarıda kesildi.', 'The connection was cut off.'));
  } catch (err) {
    if (run.active) fail(T(`Bağlantı hatası: ${err.message}`, `Connection error: ${err.message}`));
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
// Voice (the app listens; see Handry.swift)
// ---------------------------------------------------------------------------

function cancelCountdown() {
  countdown.classList.remove('running');
  if (voice.pending) voice.pending.cancelled = true;
  voice.pending = null;
}

async function voiceFinished({ text, file, wake }) {
  voice.listening = false;
  setState(run.active ? 'busy' : 'idle');
  input.placeholder = restPlaceholder();
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
  // whisper knows names like Handry, VS Code and Claude better than the live recognizer.
  let better = null;
  if (file) {
    try {
      const res = await api('/api/voice/file', { method: 'POST', body: JSON.stringify({ file, wake: Boolean(wake) }) });
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
// Called by Handry.app
// ---------------------------------------------------------------------------

window.jevisBar = {
  // Handry.app: the user just drew (or talks after drawing): the next question goes with the drawing.
  pen(on) { setPen(on); },
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
        input.placeholder = T('Dinliyorum…', 'Listening…');
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
        input.placeholder = restPlaceholder();
        setState(run.active ? 'busy' : 'idle');
        break;
      case 'error':
        voice.listening = false;
        input.placeholder = restPlaceholder();
        setState(run.active ? 'busy' : 'idle');
        panel.hidden = false;
        answer.hidden = false;
        answer.classList.add('error');
        answer.textContent = ev.message || T('Mikrofon çalışmadı.', "The microphone didn't work.");
        break;
    }
  },
  // How loud the voice is while listening (0…1): the mark's bars follow it.
  level(v) {
    $('mark').style.setProperty('--lv', Math.max(0, Math.min(1, Number(v) || 0)).toFixed(2));
  },
  // A tool needs the user (a login, a code). Shown without taking the keyboard.
  attention(ev) {
    if (ev.type === 'resolved') {
      if (bar.dataset.attention) { answer.textContent = T('Teşekkürler, devam ediyorum.', 'Thanks, carrying on.'); answer.classList.remove('error'); delete bar.dataset.attention; }
      return;
    }
    clearTimeout(hideTimer);
    panel.hidden = false;
    now.hidden = true;
    stepsList.replaceChildren();
    answer.hidden = false;
    answer.classList.add('error');
    answer.textContent = `${ev.title}: ${ev.message}`;
    // Timer notices, reminders and Claude reports are news, not a login Handry waits for (titles in either language).
    const news = ['Zamanlayıcı', 'Hatırlatma', 'Claude', 'Timer', 'Reminder'].includes(ev.title);
    answer.classList.toggle('error', !news);
    foot.replaceChildren(el('span', null, news ? '' : T(`Bitirince ${APP_NAME} kendiliğinden devam eder.`, `When you're done, ${APP_NAME} carries on by itself.`)));
    foot.hidden = news;
    refreshTimers();
    bar.dataset.attention = '1';
  },
  submit
};

input.focus();
