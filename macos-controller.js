import { exec } from 'node:child_process';
import util from 'node:util';
import path from 'node:path';
import os from 'node:os';

const execAsync = util.promisify(exec);

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
    await execAsync(`open -a "${appName}"`);
    return { success: true, message: `🚀 "${appName}" açıldı.` };
  } catch (err) {
    return { success: false, error: `Uygulama açılamadı: ${err.message}` };
  }
}

/**
 * Quit an application via AppleScript
 */
export async function quitApp(appKey) {
  const appName = APP_NAMES[appKey] || appKey;
  try {
    await execAsync(`osascript -e 'quit app "${appName}"'`);
    return { success: true, message: `🛑 "${appName}" kapatıldı.` };
  } catch (err) {
    return { success: false, error: `Uygulama kapatılamadı: ${err.message}` };
  }
}

/**
 * Set system output volume (0 to 100)
 */
export async function setVolume(percent) {
  const vol = Math.max(0, Math.min(100, Math.round(percent)));
  try {
    await execAsync(`osascript -e "set volume output volume ${vol}"`);
    return { success: true, message: `🔊 Ses seviyesi %${vol} yapıldı.` };
  } catch (err) {
    return { success: false, error: `Ses ayarlanamadı: ${err.message}` };
  }
}

/**
 * Media player control (Spotify or Apple Music)
 */
export async function mediaControl(action) {
  let script = '';
  switch (action) {
    case 'play_pause':
    case 'toggle':
      script = `
        tell application "System Events"
          if (exists process "Spotify") then
            tell application "Spotify" to playpause
          else if (exists process "Music") then
            tell application "Music" to playpause
          else
            tell application "Spotify" to activate
            delay 0.5
            tell application "Spotify" to play
          end if
        end tell
      `;
      break;
    case 'next':
      script = `
        tell application "System Events"
          if (exists process "Spotify") then
            tell application "Spotify" to next track
          else if (exists process "Music") then
            tell application "Music" to next track
          end if
        end tell
      `;
      break;
    case 'previous':
      script = `
        tell application "System Events"
          if (exists process "Spotify") then
            tell application "Spotify" to previous track
          else if (exists process "Music") then
            tell application "Music" to previous track
          end if
        end tell
      `;
      break;
    case 'mute':
      script = `set volume output muted true`;
      break;
    case 'unmute':
      script = `set volume output muted false`;
      break;
    default:
      return { success: false, error: `Bilinmeyen medya aksiyonu: ${action}` };
  }

  try {
    await execAsync(`osascript -e '${script.replace(/\n/g, ' ')}'`);
    return { success: true, message: `🎵 Medya aksiyonu uygulandı (${action}).` };
  } catch (err) {
    return { success: false, error: `Medya kontrol hatası: ${err.message}` };
  }
}

/**
 * Play specific song or artist on Spotify
 */
export async function playSpotifySearch(query) {
  try {
    await execAsync(`open "spotify:search:${encodeURIComponent(query)}"`);
    // Optional delay to trigger playback
    return { success: true, message: `🎵 Spotify'da "${query}" arandı ve açıldı.` };
  } catch (err) {
    return { success: false, error: `Spotify açılamadı: ${err.message}` };
  }
}

/**
 * Create a real note in Apple Notes
 */
export async function createNote(title, body) {
  const safeTitle = (title || 'Yeni Not').replace(/"/g, '\\"');
  const safeBody = (body || '').replace(/"/g, '\\"');
  try {
    await execAsync(`osascript -e 'tell application "Notes" to make new note at folder "Notes" with properties {name:"${safeTitle}", body:"${safeBody}"}'`);
    await execAsync(`open -a "Notes"`);
    return { success: true, message: `📝 Notlar'a "${safeTitle}" notu eklendi.` };
  } catch (err) {
    return { success: false, error: `Not oluşturulamadı: ${err.message}` };
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
      await execAsync(`open -a Safari "${targetUrl}"`);
      return { success: true, message: `🌐 Safari'de açıldı: ${cleanQ} (${platform.toUpperCase()})` };
    } else if (browser === 'chrome') {
      await execAsync(`open -a "Google Chrome" "${targetUrl}"`);
      return { success: true, message: `🌐 Chrome'da açıldı: ${cleanQ} (${platform.toUpperCase()})` };
    } else {
      await execAsync(`open "${targetUrl}"`);
      return { success: true, message: `🌐 Tarayıcıda açıldı: ${cleanQ} (${platform.toUpperCase()})` };
    }
  } catch (err) {
    return { success: false, error: `Tarayıcı açılamadı: ${err.message}` };
  }
}

/**
 * Toggle macOS Dark/Light appearance
 */
export async function toggleDarkMode() {
  try {
    await execAsync(`osascript -e 'tell app "System Events" to tell appearance preferences to set dark mode to not dark mode'`);
    return { success: true, message: `🌓 Görünüm modu (Açık/Koyu) değiştirildi.` };
  } catch (err) {
    if (err.message.includes('-1743') || err.message.includes('yetkisi yok')) {
      return {
        success: false,
        error: `macOS Otomasyon İzni Gerekli: Lütfen "Sistem Ayarları > Gizlilik ve Güvenlik > Otomasyon" bölümünden izin verin.`
      };
    }
    return { success: false, error: `Tema değiştirilemedi: ${err.message}` };
  }
}

/**
 * Take full screenshot and save to Desktop
 */
export async function takeScreenshot() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `Ekran-Resmi-${timestamp}.png`;
  const destPath = path.join(os.homedir(), 'Desktop', filename);

  try {
    await execAsync(`screencapture -x "${destPath}"`);
    return { success: true, message: `📸 Ekran görüntüsü Masaüstüne kaydedildi: ${filename}`, filePath: destPath };
  } catch (err) {
    return {
      success: false,
      error: `Ekran görüntüsü alınamadı (Ekran Kaydı izni gerekebilir): ${err.message}`
    };
  }
}

/**
 * Lock the Mac screen
 */
export async function lockScreen() {
  try {
    await execAsync(`pmset displaysleepnow`);
    return { success: true, message: `🔒 Ekran kilitlendi / uyku moduna alındı.` };
  } catch (err) {
    return { success: false, error: `Ekran kilitlenemedi: ${err.message}` };
  }
}
