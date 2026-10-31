// Handry · © 2026 Berat Olekli (purplefox) · github.com/purplefox21/handry
import { execFile } from 'node:child_process';
import util from 'node:util';
import path from 'node:path';
import os from 'node:os';
import { APP_NAME } from '../core/brand.js';
import { T } from '../core/i18n.js';

// execFile passes arguments straight to the program (no shell), so user text
// with quotes or apostrophes ("Ali'ye") can neither break nor inject commands.
const execFileAsync = util.promisify(execFile);

// Runs an AppleScript; extra values arrive in the script as `item N of argv`
// instead of being spliced into the source text.
function runAppleScript(lines, args = []) {
  const script = Array.isArray(lines) ? lines.join('\n') : lines;
  return execFileAsync('osascript', ['-e', script, ...args]);
}

// Map common app aliases to exact macOS application names
const APP_NAMES = {
  vscode: 'Visual Studio Code',
  spotify: 'Spotify',
  safari: 'Safari',
  chrome: 'Google Chrome',
  terminal: 'Terminal',
  finder: 'Finder',
  notes: 'Notes',
  calculator: 'Calculator',
  settings: 'System Settings',
  music: 'Music',
  mail: 'Mail',
  calendar: 'Calendar'
};

/**
 * Open/activate an application on macOS
 */
export async function openApp(appKey) {
  const appName = APP_NAMES[appKey] || appKey;
  try {
    await execFileAsync('open', ['-a', appName]);
    return { success: true, message: T(`🚀 "${appName}" açıldı.`, `🚀 "${appName}" opened.`) };
  } catch (err) {
    return { success: false, error: T(`Uygulama açılamadı: ${err.message}`, `Couldn't open the app: ${err.message}`) };
  }
}

/**
 * Quit an application via AppleScript
 */
export async function quitApp(appKey) {
  const appName = APP_NAMES[appKey] || appKey;
  try {
    await runAppleScript(['on run argv', 'quit application (item 1 of argv)', 'end run'], [appName]);
    return { success: true, message: T(`🛑 "${appName}" kapatıldı.`, `🛑 "${appName}" closed.`) };
  } catch (err) {
    return { success: false, error: T(`Uygulama kapatılamadı: ${err.message}`, `Couldn't close the app: ${err.message}`) };
  }
}

/**
 * Set system output volume (0 to 100)
 */
export async function setVolume(percent) {
  const vol = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
  try {
    await runAppleScript(`set volume output volume ${vol}`);
    return { success: true, message: T(`🔊 Ses seviyesi %${vol} yapıldı.`, `🔊 Volume set to ${vol}%.`) };
  } catch (err) {
    return { success: false, error: T(`Ses ayarlanamadı: ${err.message}`, `Couldn't set the volume: ${err.message}`) };
  }
}

const PLAYER_SCRIPT = (command) => [
  'if application "Spotify" is running then',
  `  tell application "Spotify" to ${command}`,
  'else if application "Music" is running then',
  `  tell application "Music" to ${command}`,
  'else',
  T('  error "Açık bir müzik çalar (Spotify / Müzik) yok."', '  error "No music player (Spotify / Music) is open."'),
  'end if'
];

// What a media action did, in English (the Turkish reply names the action).
const MEDIA_DONE_EN = { play_pause: 'Play/pause pressed.', toggle: 'Play/pause pressed.', next: 'Next track.', previous: 'Previous track.', mute: 'Sound muted.', unmute: 'Sound back on.' };

/**
 * Media player control (Spotify or Apple Music)
 */
export async function mediaControl(action) {
  let script;
  switch (action) {
    case 'play_pause':
    case 'toggle':
      script = [
        'if application "Spotify" is running then',
        '  tell application "Spotify" to playpause',
        'else if application "Music" is running then',
        '  tell application "Music" to playpause',
        'else',
        '  tell application "Spotify" to activate',
        '  delay 1',
        '  tell application "Spotify" to play',
        'end if'
      ];
      break;
    case 'next':
      script = PLAYER_SCRIPT('next track');
      break;
    case 'previous':
      script = PLAYER_SCRIPT('previous track');
      break;
    case 'mute':
      script = 'set volume output muted true';
      break;
    case 'unmute':
      script = 'set volume output muted false';
      break;
    default:
      return { success: false, error: T(`Bilinmeyen medya aksiyonu: ${action}`, `Unknown media action: ${action}`) };
  }

  try {
    await runAppleScript(script);
    return { success: true, message: T(`🎵 Medya aksiyonu uygulandı (${action}).`, `🎵 ${MEDIA_DONE_EN[action]}`) };
  } catch (err) {
    return { success: false, error: T(`Medya kontrol hatası: ${err.message}`, `Media control failed: ${err.message}`) };
  }
}

/**
 * Play specific song or artist on Spotify
 */
export async function playSpotifySearch(query) {
  try {
    await execFileAsync('open', [`spotify:search:${encodeURIComponent(query)}`]);
    return { success: true, message: T(`🎵 Spotify'da "${query}" arandı ve açıldı.`, `🎵 Searched Spotify for "${query}".`) };
  } catch (err) {
    return { success: false, error: T(`Spotify açılamadı: ${err.message}`, `Couldn't open Spotify: ${err.message}`) };
  }
}

/**
 * Create a real note in Apple Notes
 */
export async function createNote(title, body) {
  const noteTitle = title || T('Yeni Not', 'New Note');
  try {
    await runAppleScript([
      'on run argv',
      'tell application "Notes" to make new note at folder "Notes" with properties {name:(item 1 of argv), body:(item 2 of argv)}',
      'end run'
    ], [noteTitle, body || '']);
    await execFileAsync('open', ['-a', 'Notes']);
    return { success: true, message: T(`📝 Notlar'a "${noteTitle}" notu eklendi.`, `📝 Added the note "${noteTitle}" to Notes.`) };
  } catch (err) {
    return { success: false, error: T(`Not oluşturulamadı: ${err.message}`, `Couldn't create the note: ${err.message}`) };
  }
}

/**
 * Web search or open URL in Safari / Chrome / Default browser
 */
export async function openWebSearch(query, platform = 'google', browser = 'default') {
  let targetUrl = '';
  const cleanQ = query.trim();

  if (cleanQ.startsWith('http://') || cleanQ.startsWith('https://')) {
    targetUrl = cleanQ;
  } else if (platform === 'youtube') {
    targetUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(cleanQ)}`;
  } else {
    targetUrl = `https://www.google.com/search?q=${encodeURIComponent(cleanQ)}`;
  }

  try {
    if (browser === 'safari') {
      await execFileAsync('open', ['-a', 'Safari', targetUrl]);
      return { success: true, message: T(`🌐 Safari'de açıldı: ${cleanQ} (${platform.toUpperCase()})`, `🌐 Opened in Safari: ${cleanQ} (${platform.toUpperCase()})`) };
    } else if (browser === 'chrome') {
      await execFileAsync('open', ['-a', 'Google Chrome', targetUrl]);
      return { success: true, message: T(`🌐 Chrome'da açıldı: ${cleanQ} (${platform.toUpperCase()})`, `🌐 Opened in Chrome: ${cleanQ} (${platform.toUpperCase()})`) };
    } else {
      await execFileAsync('open', [targetUrl]);
      return { success: true, message: T(`🌐 Tarayıcıda açıldı: ${cleanQ} (${platform.toUpperCase()})`, `🌐 Opened in the browser: ${cleanQ} (${platform.toUpperCase()})`) };
    }
  } catch (err) {
    return { success: false, error: T(`Tarayıcı açılamadı: ${err.message}`, `Couldn't open the browser: ${err.message}`) };
  }
}

/**
 * Toggle macOS Dark/Light appearance
 */
export async function toggleDarkMode() {
  try {
    await runAppleScript('tell application "System Events" to tell appearance preferences to set dark mode to not dark mode');
    return { success: true, message: T(`🌓 Görünüm modu (Açık/Koyu) değiştirildi.`, `🌓 Switched between light and dark mode.`) };
  } catch (err) {
    if (err.message.includes('-1743') || err.message.includes('yetkisi yok') || /not authori[sz]ed/i.test(err.message)) {
      return {
        success: false,
        error: T(`macOS Otomasyon İzni Gerekli: Lütfen "Sistem Ayarları > Gizlilik ve Güvenlik > Otomasyon" bölümünden izin verin.`, `macOS Automation permission needed: allow it in "System Settings > Privacy & Security > Automation".`)
      };
    }
    return { success: false, error: T(`Tema değiştirilemedi: ${err.message}`, `Couldn't change the appearance: ${err.message}`) };
  }
}

/**
 * Take full screenshot and save to Desktop
 */
export async function takeScreenshot() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${T('Ekran-Resmi', 'Screenshot')}-${timestamp}.png`;
  const destPath = path.join(os.homedir(), 'Desktop', filename);

  try {
    await execFileAsync('screencapture', ['-x', destPath]);
    return { success: true, message: T(`📸 Ekran görüntüsü Masaüstüne kaydedildi: ${filename}`, `📸 Screenshot saved to the Desktop: ${filename}`), filePath: destPath };
  } catch (err) {
    return {
      success: false,
      error: T(`Ekran görüntüsü alınamadı (Ekran Kaydı izni gerekebilir): ${err.message}`, `Couldn't take a screenshot (Screen Recording permission may be needed): ${err.message}`)
    };
  }
}

/**
 * Lock the Mac screen: Apple menu › Ekranı Kilitle (a real lock, not sleep).
 * Without Accessibility, turning the display off locks it too if a password is required.
 */
export async function lockScreen() {
  try {
    const { power } = await import('./power.js');
    return await power('lock');
  } catch {}
  try {
    await execFileAsync('pmset', ['displaysleepnow']);
    return { success: true, message: T('🔒 Ekran kapatıldı (şifre isteniyorsa kilitlendi).', '🔒 Display turned off (locked, if a password is required).') };
  } catch (err) {
    return { success: false, error: T(`Ekran kilitlenemedi: ${err.message}`, `Couldn't lock the screen: ${err.message}`) };
  }
}

/**
 * Show a macOS notification
 */
export async function notify(title, message) {
  try {
    await runAppleScript(['on run argv', 'display notification (item 2 of argv) with title (item 1 of argv)', 'end run'], [title || APP_NAME, message || '']);
    return { success: true, message: T(`🔔 Bildirim gösterildi: ${message}`, `🔔 Notification shown: ${message}`) };
  } catch (err) {
    return { success: false, error: T(`Bildirim gösterilemedi: ${err.message}`, `Couldn't show the notification: ${err.message}`) };
  }
}

/**
 * Current output volume (0-100)
 */
export async function getVolume() {
  const { stdout } = await runAppleScript('output volume of (get volume settings)');
  return Number(stdout.trim()) || 0;
}

/**
 * The song playing in Spotify or Music, if any
 */
export async function nowPlaying() {
  const script = [
    'if application "Spotify" is running then',
    '  tell application "Spotify" to if player state is playing then return (name of current track) & " — " & (artist of current track)',
    'end if',
    'if application "Music" is running then',
    '  tell application "Music" to if player state is playing then return (name of current track) & " — " & (artist of current track)',
    'end if',
    'return ""'
  ];
  try {
    const { stdout } = await runAppleScript(script);
    const song = stdout.trim();
    return { success: true, message: song ? T(`🎵 Şu an çalıyor: ${song}`, `🎵 Now playing: ${song}`) : T('🎵 Şu an bir şey çalmıyor.', '🎵 Nothing is playing right now.') };
  } catch (err) {
    return { success: false, error: T(`Çalan şarkı okunamadı: ${err.message}`, `Couldn't read the song playing: ${err.message}`) };
  }
}
