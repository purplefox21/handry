// Shared by the chat page (app.js) and the compact bar (bar.js): talking to
// the JEVIS server, how each tool call reads to a person, small DOM helpers
// and the audio helpers for whisper. Untrusted text always goes through
// textContent, never innerHTML.

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

// The app's name and its Turkish endings (core/brand.js, put into the page by the server).
const BRAND = (() => { try { return JSON.parse(decodeURIComponent(document.querySelector('meta[name="app-brand"]').content)); } catch { return {}; } })();
const APP_NAME = BRAND.name || 'Handry';
const SAY_TO = `${BRAND.dative || "Handry'ye"} söyle…`;

const MODEL_NAMES = { 'claude-sonnet-5-5': 'Sonnet 5.5', 'claude-sonnet-5': 'Sonnet 5', 'claude-opus-5-5': 'Opus 5.5', 'claude-haiku-4-5': 'Haiku 4.5' };
const BRAIN_NAMES = { 'claude-code': 'Claude Code', codex: 'Codex', anthropic: 'Claude API', openai: 'OpenAI uyumlu', ollama: 'Ollama' };
const ROUTE_NAMES = {
  volume: 'ses', mute: 'ses', music: 'müzik', now_playing: 'çalan şarkı', app_open: 'uygulama açma', app_quit: 'uygulama kapatma',
  web_open: 'site açma', web_search: 'arama', page_click: 'sayfada tıklama', dark_mode: 'görünüm', lock_screen: 'ekran kilidi', screenshot: 'ekran görüntüsü',
  spotify_play: 'Spotify', note_add: 'not', calendar_show: 'takvim', reminders_show: 'anımsatıcılar',
  timer: 'zamanlayıcı', power_lock: 'ekran kilidi', power_sleep: 'uyku', power_restart: 'yeniden başlatma', power_shutdown: 'kapatma'
};

// Small DOM helpers

const ICONS = {
  zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
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

// What each tool call looks like to a person

const MAC_ACTIONS = {
  volume: a => `Ses %${a.value} yapılıyor`, volume_up: () => 'Ses açılıyor', volume_down: () => 'Ses kısılıyor', mute: () => 'Ses kapatılıyor', unmute: () => 'Ses açılıyor',
  now_playing: () => 'Çalan şarkıya bakılıyor', screenshot: () => 'Ekran görüntüsü alınıyor',
  play_pause: () => 'Müzik başlat/durdur', next_track: () => 'Sonraki şarkı', previous_track: () => 'Önceki şarkı',
  dark_mode: () => 'Görünüm değiştiriliyor', lock_screen: () => 'Ekran kilitleniyor', sleep: () => 'Mac uyutuluyor', restart: () => 'Mac yeniden başlatılıyor', shutdown: () => 'Mac kapatılıyor', notify: a => `Bildirim: ${short(a.value)}`,
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
  desktop_click_at: [a => `Ekranda tıklanıyor: ${short(a.description)}`, 'pointer'],
  desktop_windows: [a => `${a.app || 'Öndeki uygulama'} pencerelerine bakılıyor`, 'layers'],
  desktop_focus_window: [a => `Pencereye geçiliyor: ${short(a.window, 40)} (${a.app})`, 'layers'],
  desktop_wait: [a => `${a.gone ? 'Kaybolması bekleniyor' : 'Bekleniyor'}: “${short(a.text, 40)}”`, 'clock'],
  files_list: [a => `Klasöre bakılıyor: ${short(a.path, 50)}`, 'folder'],
  files_search: [a => `Dosya aranıyor: “${short(a.query, 40)}”`, 'folder'],
  files_recent: [a => ({ apps: 'Son kullanılan uygulamalara bakılıyor', projects: 'Son projelere bakılıyor' }[a.kind] || 'Son açılan dosyalara bakılıyor'), 'clock'],
  files_read: [a => `Dosya okunuyor: ${String(a.path || '').split('/').pop()}`, 'file'],
  files_open: [a => `Açılıyor: ${String(a.path || '').split('/').pop()}${a.app ? ` (${a.app})` : ''}`, 'folder'],
  project_activity: [a => `Projede ne yapıldığına bakılıyor: ${String(a.path || '').split('/').filter(Boolean).pop()}`, 'layers'],
  spotify_play: [a => (a.liked ? 'Spotify: Beğenilen Şarkılar çalınıyor' : `Spotify'da çalınıyor: ${short(a.what, 40)}`), 'play'],
  music_play: [a => `Müzik'te çalınıyor: ${short(a.query, 40)}`, 'play'],
  notes_add: [a => `Not ekleniyor: ${short(a.title || a.text, 50)}`, 'file'],
  notes_find: [a => `Notlarda aranıyor: “${short(a.query, 40)}”`, 'file'],
  reminders_add: [a => `Anımsatıcı ekleniyor: ${short(a.text, 50)}`, 'clock'],
  reminders_list: [() => 'Anımsatıcılara bakılıyor', 'clock'],
  calendar_events: [a => (a.from === 1 ? 'Yarının takvimine bakılıyor' : (a.days || 1) > 1 ? 'Haftanın takvimine bakılıyor' : 'Bugünün takvimine bakılıyor'), 'clock'],
  calendar_add: [a => `Takvime ekleniyor: ${short(a.title, 40)}`, 'clock'],
  mac_action: [a => (MAC_ACTIONS[a.action] || (() => a.action))(a), 'sliders'],
  jev_ask: [() => 'Jev\'e soruluyor', 'zap'],
  files_make_folder: [a => `Klasör oluşturuluyor: ${short(a.path, 50)}`, 'folder'],
  files_move: [a => `Taşınıyor: ${short([].concat(a.from || []).map(p => String(p).split('/').pop()).join(', '), 40)} → ${short(a.to, 40)}`, 'folder'],
  files_copy: [a => `Kopyalanıyor: ${short([].concat(a.from || []).map(p => String(p).split('/').pop()).join(', '), 40)} → ${short(a.to, 40)}`, 'folder'],
  files_trash: [a => `Çöp Sepeti'ne atılıyor: ${short([].concat(a.paths || []).map(p => String(p).split('/').pop()).join(', '), 50)}`, 'trash'],
  files_undo: [() => 'Son dosya işi geri alınıyor', 'back'],
  schedule_task: [a => `Zamanlayıcı kuruluyor: ${short(a.said || a.text || a.action, 50)}`, 'clock'],
  scheduled_tasks: [() => 'Zamanlayıcılara bakılıyor', 'clock'],
  cancel_scheduled: [() => 'Zamanlayıcı iptal ediliyor', 'clock'],
  claude_sessions: [() => 'Açık Claude oturumlarına bakılıyor', 'layers'],
  handry_do: [a => `Hızlı yola veriliyor: “${short(a.command, 50)}”`, 'zap'],
  handry_teach: [a => `Öğreniliyor: “${short(a.command, 50)}”`, 'bookmark'],
  inaro_do: [a => `Hızlı yola veriliyor: “${short(a.command, 50)}”`, 'zap'],
  inaro_teach: [a => `Öğreniliyor: “${short(a.command, 50)}”`, 'bookmark'],
  browser_fill: [a => `Form dolduruluyor (${Object.keys(a.fields || {}).length} alan)`, 'type'],
  browser_sessions: [() => 'Girişlere bakılıyor', 'user'],
  browser_download: [a => `İndiriliyor: ${short(a.target, 40)}`, 'arrow-down'],
  browser_save_value: [a => `Değer kaydediliyor: ${short(a.target, 40)}`, 'lock'],
  browser_table: [a => `Tablo okunuyor${a.which ? `: ${short(a.which, 30)}` : ''}`, 'list'],
  site_note: [a => `Site notu: ${short(a.note || a.site, 50)}`, 'bookmark']
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

// Runs one command on the server and calls onEvent for every streamed event
// (route, status, tool, tool_result, text, done, error). Resolves when done.
async function runStream(body, onEvent, signal) {
  const res = await api('/api/run', { method: 'POST', body: JSON.stringify(body), signal });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    onEvent({ type: 'error', message: err.error || `Sunucu hata verdi (${res.status}).` });
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
      if (line.trim()) onEvent(JSON.parse(line));
    }
  }
}

// The model picked in the window or the bar is remembered. When JEVIS's
// default model changes (jevis.config.json), both switch to it once; after
// that the user's own pick is kept again.
function adoptDefaultModel(defaultModel) {
  if (!defaultModel || store.get('modelDefault', null) === defaultModel) return;
  store.set('modelDefault', defaultModel);
  store.set('model', defaultModel);
}

// Timers and watches (the window's list and the bar's list share these).

async function fetchTimers() {
  return (await (await api('/api/timers')).json()).jobs;
}

async function cancelTimer(id) {
  await api('/api/timers/cancel', { method: 'POST', body: JSON.stringify(id === 'all' ? { all: true } : { id }) });
}

// "2 sa 14 dk", "12 dk 3 sn", "45 sn"
function timeLeft(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h} sa ${m} dk`;
  if (m) return `${m} dk ${s % 60} sn`;
  return `${s} sn`;
}

const TIMER_ICONS = { shutdown: 'power', restart: 'power', sleep: 'clock', lock: 'lock', remind: 'message', command: 'play' };
const timerIcon = job => (job.kind === 'watch' ? 'eye' : TIMER_ICONS[job.action] || 'clock');

/** Seconds left of a shutdown countdown, or null. */
const countdownLeft = job => (job.firing ? Math.max(0, Math.ceil((job.firing.started + job.firing.seconds * 1000 - Date.now()) / 1000)) : null);

function timerSub(job) {
  const left = countdownLeft(job);
  if (left !== null) return `${left} sn sonra ${job.action === 'restart' ? 'yeniden başlıyor' : 'kapanıyor'}`;
  if (job.kind === 'watch') return `${job.when}${job.note ? ` · son bakış: ${job.note}` : ' · bakılıyor'}`;
  return `${job.when} · ${timeLeft(job.at - Date.now())} kaldı`;
}

/** A button that asks "emin misin?" first; the second press within 3 s does it. */
function twoStep(button, sureLabel, action) {
  const label = button.textContent;
  button.addEventListener('click', async e => {
    e.stopPropagation();
    if (!button.dataset.sure) {
      button.dataset.sure = '1';
      button.textContent = sureLabel;
      button.classList.add('sure');
      setTimeout(() => { delete button.dataset.sure; button.textContent = label; button.classList.remove('sure'); }, 3000);
      return;
    }
    button.disabled = true;
    await action();
  });
}

// Audio for whisper.cpp: 16 kHz mono WAV.

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
