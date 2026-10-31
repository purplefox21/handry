// Handry · © 2026 Berat Olekli (purplefox) · github.com/purplefox21/handry
// Shared by the chat page (app.js) and the compact bar (bar.js): talking to
// the Handry server, how each tool call reads to a person, small DOM helpers
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

// The language Handry speaks (core/i18n.js), as the server said when it sent
// the page. It stays the same until the page reloads (a change in Settings
// reloads it), so texts picked once at load are fine here.
const LANG = BRAND.lang === 'en' ? 'en' : 'tr';
/** The Turkish or the English text, by the page's language. */
const T = (tr, en) => (LANG === 'en' ? en : tr);
const LOCALE = T('tr-TR', 'en-US');
/** "3 adım" / "3 steps" */
const stepCount = n => T(`${n} adım`, `${n} ${n === 1 ? 'step' : 'steps'}`);

// The HTML is in Turkish; English sits next to it in data-en (the element's
// HTML: fixed text from our own files, never user data), data-en-placeholder,
// data-en-title, data-en-aria-label and data-en-cmd (a suggestion's command).
function applyLanguage() {
  document.documentElement.lang = LANG;
  if (LANG !== 'en') return;
  for (const node of document.querySelectorAll('[data-en]')) node.innerHTML = node.dataset.en;
  for (const [from, to] of [['placeholder', 'placeholder'], ['title', 'title'], ['aria-label', 'aria-label'], ['cmd', 'data-cmd']]) {
    for (const node of document.querySelectorAll(`[data-en-${from}]`)) node.setAttribute(to, node.getAttribute(`data-en-${from}`));
  }
}
applyLanguage();

const SAY_TO = T(`${BRAND.dative || "Handry'ye"} söyle…`, `Tell ${APP_NAME}…`);

const MODEL_NAMES = { 'claude-sonnet-5-5': 'Sonnet 5.5', 'claude-sonnet-5': 'Sonnet 5', 'claude-opus-5-5': 'Opus 5.5', 'claude-haiku-4-5': 'Haiku 4.5' };
const BRAIN_NAMES = { 'claude-code': 'Claude Code', codex: 'Codex', anthropic: 'Claude API', openai: T('OpenAI uyumlu', 'OpenAI-compatible'), ollama: 'Ollama' };
const ROUTE_NAMES = {
  volume: T('ses', 'volume'), mute: T('ses', 'volume'), music: T('müzik', 'music'), now_playing: T('çalan şarkı', 'now playing'), app_open: T('uygulama açma', 'opening an app'), app_quit: T('uygulama kapatma', 'quitting an app'),
  web_open: T('site açma', 'opening a site'), web_search: T('arama', 'search'), page_click: T('sayfada tıklama', 'clicking on the page'), dark_mode: T('görünüm', 'appearance'), lock_screen: T('ekran kilidi', 'screen lock'), screenshot: T('ekran görüntüsü', 'screenshot'),
  spotify_play: 'Spotify', note_add: T('not', 'note'), calendar_show: T('takvim', 'calendar'), reminders_show: T('anımsatıcılar', 'reminders'),
  timer: T('zamanlayıcı', 'timer'), power_lock: T('ekran kilidi', 'screen lock'), power_sleep: T('uyku', 'sleep'), power_restart: T('yeniden başlatma', 'restart'), power_shutdown: T('kapatma', 'shut down')
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
  volume: a => T(`Ses %${a.value} yapılıyor`, `Setting the volume to ${a.value}%`), volume_up: () => T('Ses açılıyor', 'Turning the volume up'), volume_down: () => T('Ses kısılıyor', 'Turning the volume down'), mute: () => T('Ses kapatılıyor', 'Muting'), unmute: () => T('Ses açılıyor', 'Unmuting'),
  now_playing: () => T('Çalan şarkıya bakılıyor', 'Checking what is playing'), screenshot: () => T('Ekran görüntüsü alınıyor', 'Taking a screenshot'),
  play_pause: () => T('Müzik başlat/durdur', 'Play/pause music'), next_track: () => T('Sonraki şarkı', 'Next song'), previous_track: () => T('Önceki şarkı', 'Previous song'),
  dark_mode: () => T('Görünüm değiştiriliyor', 'Changing the appearance'), lock_screen: () => T('Ekran kilitleniyor', 'Locking the screen'), sleep: () => T('Mac uyutuluyor', 'Putting the Mac to sleep'), restart: () => T('Mac yeniden başlatılıyor', 'Restarting the Mac'), shutdown: () => T('Mac kapatılıyor', 'Shutting down the Mac'), notify: a => T(`Bildirim: ${short(a.value)}`, `Notification: ${short(a.value)}`),
  spotify_search: a => T(`Spotify'da aranıyor: ${short(a.value)}`, `Searching Spotify: ${short(a.value)}`), note: a => T(`Not ekleniyor: ${short(a.title || a.value)}`, `Adding a note: ${short(a.title || a.value)}`)
};

const STEPS = {
  browser_open: [a => T(`Sayfa açılıyor: ${host(a.url)}`, `Opening a page: ${host(a.url)}`), 'globe'],
  browser_read: [() => T('Sayfa okunuyor', 'Reading the page'), 'eye'],
  browser_click: [a => T(`Tıklanıyor: ${short(a.target)}`, `Clicking: ${short(a.target)}`), 'pointer'],
  browser_type: [a => T(`Yazılıyor: “${short(a.text, 40)}” → ${short(a.target, 30)}`, `Typing: “${short(a.text, 40)}” → ${short(a.target, 30)}`), 'type'],
  browser_select: [a => T(`Seçiliyor: ${short(a.option, 30)} (${short(a.target, 30)})`, `Choosing: ${short(a.option, 30)} (${short(a.target, 30)})`), 'list'],
  browser_check: [a => `${a.checked === false ? T('İşaret kaldırılıyor', 'Unticking') : T('İşaretleniyor', 'Ticking')}: ${short(a.target)}`, 'check-square'],
  browser_upload: [a => T(`Dosya yükleniyor: ${String(a.file_path || '').split('/').pop()}`, `Uploading a file: ${String(a.file_path || '').split('/').pop()}`), 'upload'],
  browser_fill_secret: [a => T(`Şifre giriliyor (${a.secret})`, `Filling in a password (${a.secret})`), 'lock'],
  wait_for_user: [a => T(`Seni bekliyor: ${short(a.message, 80)}`, `Waiting for you: ${short(a.message, 80)}`), 'user'],
  human_mode: [a => (a.on === false ? T('İnsan gibi giriş kapatılıyor', 'Turning off human-like input') : a.on ? T('İnsan gibi giriş açılıyor (engel var)', 'Turning on human-like input (the site blocks bots)') : T('İnsan gibi giriş durumuna bakılıyor', 'Checking human-like input')), 'user'],
  browser_press: [a => T(`Tuş: ${a.key}`, `Key: ${a.key}`), 'command'],
  browser_scroll: [a => `${T('Sayfa kaydırılıyor', 'Scrolling the page')}${a.direction === 'up' ? T(' (yukarı)', ' (up)') : ''}`, 'arrow-down'],
  browser_back: [() => T('Geri gidiliyor', 'Going back'), 'back'],
  browser_tabs: [a => (a.action === 'switch' ? T(`Sekmeye geçiliyor: ${short(a.tab)}`, `Switching to a tab: ${short(a.tab)}`) : a.action === 'close' ? T('Sekme kapatılıyor', 'Closing a tab') : T('Sekmelere bakılıyor', 'Checking the tabs')), 'layers'],
  browser_screenshot: [() => T('Sayfanın görüntüsü alınıyor', 'Taking a picture of the page'), 'camera'],
  browser_verify: [a => T(`Kontrol ediliyor: ${short(a.expectation, 70)}`, `Checking: ${short(a.expectation, 70)}`), 'check-circle'],
  browser_wait: [a => (a.text ? T(`Bekleniyor: “${short(a.text, 40)}”`, `Waiting for: “${short(a.text, 40)}”`) : T('Bekleniyor', 'Waiting')), 'clock'],
  desktop_apps: [() => T('Açık uygulamalara bakılıyor', 'Checking the open apps'), 'grid'],
  desktop_open_app: [a => T(`Uygulama açılıyor: ${a.name}`, `Opening an app: ${a.name}`), 'monitor'],
  desktop_quit_app: [a => T(`Uygulama kapatılıyor: ${a.name}`, `Quitting an app: ${a.name}`), 'power'],
  desktop_read: [a => T(`${a.app || 'Öndeki uygulama'} okunuyor`, `Reading ${a.app || 'the front app'}`), 'eye'],
  desktop_click: [a => T(`Basılıyor: ${short(a.target)}${a.app ? ` (${a.app})` : ''}`, `Clicking: ${short(a.target)}${a.app ? ` (${a.app})` : ''}`), 'pointer'],
  desktop_type: [a => T(`Yazılıyor: “${short(a.text, 40)}”`, `Typing: “${short(a.text, 40)}”`) + (a.target ? ` → ${short(a.target, 30)}` : ''), 'type'],
  desktop_key: [a => T(`Kısayol: ${a.keys}`, `Shortcut: ${a.keys}`), 'command'],
  desktop_screenshot: [() => T('Pencerenin görüntüsü alınıyor', 'Taking a picture of the window'), 'camera'],
  desktop_click_at: [a => T(`Ekranda tıklanıyor: ${short(a.description)}`, `Clicking on the screen: ${short(a.description)}`), 'pointer'],
  desktop_windows: [a => T(`${a.app || 'Öndeki uygulama'} pencerelerine bakılıyor`, `Checking the windows of ${a.app || 'the front app'}`), 'layers'],
  desktop_focus_window: [a => T(`Pencereye geçiliyor: ${short(a.window, 40)} (${a.app})`, `Switching to a window: ${short(a.window, 40)} (${a.app})`), 'layers'],
  desktop_wait: [a => `${a.gone ? T('Kaybolması bekleniyor', 'Waiting for it to go') : T('Bekleniyor', 'Waiting for')}: “${short(a.text, 40)}”`, 'clock'],
  files_list: [a => T(`Klasöre bakılıyor: ${short(a.path, 50)}`, `Looking in a folder: ${short(a.path, 50)}`), 'folder'],
  files_search: [a => T(`Dosya aranıyor: “${short(a.query, 40)}”`, `Searching files: “${short(a.query, 40)}”`), 'folder'],
  files_recent: [a => ({ apps: T('Son kullanılan uygulamalara bakılıyor', 'Checking recently used apps'), projects: T('Son projelere bakılıyor', 'Checking recent projects') }[a.kind] || T('Son açılan dosyalara bakılıyor', 'Checking recently opened files')), 'clock'],
  files_read: [a => T(`Dosya okunuyor: ${String(a.path || '').split('/').pop()}`, `Reading a file: ${String(a.path || '').split('/').pop()}`), 'file'],
  files_open: [a => T(`Açılıyor: ${String(a.path || '').split('/').pop()}${a.app ? ` (${a.app})` : ''}`, `Opening: ${String(a.path || '').split('/').pop()}${a.app ? ` (${a.app})` : ''}`), 'folder'],
  project_activity: [a => T(`Projede ne yapıldığına bakılıyor: ${String(a.path || '').split('/').filter(Boolean).pop()}`, `Checking what was done in the project: ${String(a.path || '').split('/').filter(Boolean).pop()}`), 'layers'],
  spotify_play: [a => (a.liked ? T('Spotify: Beğenilen Şarkılar çalınıyor', 'Spotify: playing Liked Songs') : T(`Spotify'da çalınıyor: ${short(a.what, 40)}`, `Playing on Spotify: ${short(a.what, 40)}`)), 'play'],
  music_play: [a => T(`Müzik'te çalınıyor: ${short(a.query, 40)}`, `Playing in Music: ${short(a.query, 40)}`), 'play'],
  notes_add: [a => T(`Not ekleniyor: ${short(a.title || a.text, 50)}`, `Adding a note: ${short(a.title || a.text, 50)}`), 'file'],
  notes_find: [a => T(`Notlarda aranıyor: “${short(a.query, 40)}”`, `Searching Notes: “${short(a.query, 40)}”`), 'file'],
  reminders_add: [a => T(`Anımsatıcı ekleniyor: ${short(a.text, 50)}`, `Adding a reminder: ${short(a.text, 50)}`), 'clock'],
  reminders_list: [() => T('Anımsatıcılara bakılıyor', 'Checking Reminders'), 'clock'],
  calendar_events: [a => (a.from === 1 ? T('Yarının takvimine bakılıyor', "Checking tomorrow's calendar") : (a.days || 1) > 1 ? T('Haftanın takvimine bakılıyor', "Checking the week's calendar") : T('Bugünün takvimine bakılıyor', "Checking today's calendar")), 'clock'],
  calendar_add: [a => T(`Takvime ekleniyor: ${short(a.title, 40)}`, `Adding to the calendar: ${short(a.title, 40)}`), 'clock'],
  mac_action: [a => (MAC_ACTIONS[a.action] || (() => a.action))(a), 'sliders'],
  jev_ask: [() => T('Jev\'e soruluyor', 'Asking Jev'), 'zap'],
  files_make_folder: [a => T(`Klasör oluşturuluyor: ${short(a.path, 50)}`, `Making a folder: ${short(a.path, 50)}`), 'folder'],
  files_move: [a => `${T('Taşınıyor', 'Moving')}: ${short([].concat(a.from || []).map(p => String(p).split('/').pop()).join(', '), 40)} → ${short(a.to, 40)}`, 'folder'],
  files_copy: [a => `${T('Kopyalanıyor', 'Copying')}: ${short([].concat(a.from || []).map(p => String(p).split('/').pop()).join(', '), 40)} → ${short(a.to, 40)}`, 'folder'],
  files_trash: [a => `${T("Çöp Sepeti'ne atılıyor", 'Moving to the Trash')}: ${short([].concat(a.paths || []).map(p => String(p).split('/').pop()).join(', '), 50)}`, 'trash'],
  files_undo: [() => T('Son dosya işi geri alınıyor', 'Undoing the last file change'), 'back'],
  schedule_task: [a => T(`Zamanlayıcı kuruluyor: ${short(a.said || a.text || a.action, 50)}`, `Setting a timer: ${short(a.said || a.text || a.action, 50)}`), 'clock'],
  scheduled_tasks: [() => T('Zamanlayıcılara bakılıyor', 'Checking what is scheduled'), 'clock'],
  cancel_scheduled: [() => T('Zamanlayıcı iptal ediliyor', 'Cancelling a timer'), 'clock'],
  claude_sessions: [() => T('Açık Claude oturumlarına bakılıyor', 'Checking the open Claude sessions'), 'layers'],
  claude_start: [a => T(`VS Code'da Claude'a yazılıyor: ${short(a.task, 50)}`, `Writing to Claude in VS Code: ${short(a.task, 50)}`), 'layers'],
  claude_send: [a => T(`"${short(a.session, 30)}" oturumuna yazılıyor: ${short(a.text, 40)}`, `Writing to the "${short(a.session, 30)}" session: ${short(a.text, 40)}`), 'layers'],
  handry_do: [a => T(`Hızlı yola veriliyor: “${short(a.command, 50)}”`, `Handing to the fast path: “${short(a.command, 50)}”`), 'zap'],
  handry_teach: [a => T(`Öğreniliyor: “${short(a.command, 50)}”`, `Learning: “${short(a.command, 50)}”`), 'bookmark'],
  inaro_do: [a => T(`Hızlı yola veriliyor: “${short(a.command, 50)}”`, `Handing to the fast path: “${short(a.command, 50)}”`), 'zap'],
  inaro_teach: [a => T(`Öğreniliyor: “${short(a.command, 50)}”`, `Learning: “${short(a.command, 50)}”`), 'bookmark'],
  browser_fill: [a => T(`Form dolduruluyor (${Object.keys(a.fields || {}).length} alan)`, `Filling in a form (${Object.keys(a.fields || {}).length} fields)`), 'type'],
  browser_sessions: [() => T('Girişlere bakılıyor', 'Checking the logins'), 'user'],
  browser_download: [a => T(`İndiriliyor: ${short(a.target, 40)}`, `Downloading: ${short(a.target, 40)}`), 'arrow-down'],
  browser_save_value: [a => T(`Değer kaydediliyor: ${short(a.target, 40)}`, `Saving a value: ${short(a.target, 40)}`), 'lock'],
  browser_table: [a => `${T('Tablo okunuyor', 'Reading a table')}${a.which ? `: ${short(a.which, 30)}` : ''}`, 'list'],
  site_note: [a => T(`Site notu: ${short(a.note || a.site, 50)}`, `Site note: ${short(a.note || a.site, 50)}`), 'bookmark']
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
    onEvent({ type: 'error', message: err.error || T(`Sunucu hata verdi (${res.status}).`, `The server returned an error (${res.status}).`) });
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

// The model picked in the window or the bar is remembered. When Handry's
// default model changes (handry.config.json), both switch to it once; after
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

// "2 sa 14 dk", "12 dk 3 sn", "45 sn" (English: "2 h 14 min", "12 min 3 s", "45 s")
function timeLeft(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return T(`${h} sa ${m} dk`, `${h} h ${m} min`);
  if (m) return T(`${m} dk ${s % 60} sn`, `${m} min ${s % 60} s`);
  return T(`${s} sn`, `${s} s`);
}

const TIMER_ICONS = { shutdown: 'power', restart: 'power', sleep: 'clock', lock: 'lock', remind: 'message', command: 'play' };
const timerIcon = job => (job.kind === 'watch' ? 'eye' : TIMER_ICONS[job.action] || 'clock');

/** Seconds left of a shutdown countdown, or null. */
const countdownLeft = job => (job.firing ? Math.max(0, Math.ceil((job.firing.started + job.firing.seconds * 1000 - Date.now()) / 1000)) : null);

function timerSub(job) {
  const left = countdownLeft(job);
  if (left !== null) return T(`${left} sn sonra ${job.action === 'restart' ? 'yeniden başlıyor' : 'kapanıyor'}`, `${job.action === 'restart' ? 'Restarting' : 'Shutting down'} in ${left} s`);
  if (job.kind === 'watch') return `${job.when}${job.note ? T(` · son bakış: ${job.note}`, ` · last check: ${job.note}`) : T(' · bakılıyor', ' · checking')}`;
  return T(`${job.when} · ${timeLeft(job.at - Date.now())} kaldı`, `${job.when} · ${timeLeft(job.at - Date.now())} left`);
}

/** A button that asks "emin misin?" ("sure?") first; the second press within 3 s does it. */
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
