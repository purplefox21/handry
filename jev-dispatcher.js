// Handry · © 2026 Berat Olekli (purplefox) · github.com/purplefox21/handry
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as controller from './hands/mac.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function getApiKey() {
  let key = process.env.TYPESAFE_API_KEY || process.env.JEV_KEY;
  if (!key) {
    try {
      const envContent = fs.readFileSync(path.join(__dirname, '.env'), 'utf-8');
      const match = envContent.match(/(?:JEV_KEY|TYPESAFE_API_KEY)=([^\r\n]+)/);
      if (match) key = match[1].trim();
    } catch (e) {}
  }
  return key;
}

/**
 * Quoted text in a command. The opening quote must start a word, so Turkish
 * apostrophes inside words ("YouTube'a", "Ali'ye") are not taken as quotes.
 */
function extractQuoted(cmd) {
  const strict = cmd.match(/(?:^|\s)["'“‘]([^"“”]+?)["'”’](?=[\s.,!?;:]|$)/);
  if (strict) return strict[1].trim();
  // Closing quote followed by a case suffix: "'Market'e ekle"
  const withSuffix = cmd.match(/(?:^|\s)["'“‘]([^"“”]+?)["'”’](?=[a-zçğıöşü]{1,4}(?:[\s.,!?;:]|$))/i);
  return withSuffix ? withSuffix[1].trim() : null;
}

/**
 * Smart query extractor from natural language commands
 */
function extractSearchQuery(cmd) {
  // 1. Quoted text takes top priority: '...' or "..."
  const quoted = extractQuoted(cmd);
  if (quoted) return quoted;

  let q = cmd;
  // Strip browser and tab instructions
  q = q.replace(/(?:yeni\s+bir\s+sekme\s+aç\s*(?:ve)?|safaride|safari'?de|chrome'da)/gi, '').trim();
  // Strip platform navigate verbs ("YouTube a gir ve", "Google'a gir ve")
  q = q.replace(/(?:youtube\s*(?:'?a)?\s+gir(?:\s+ve)?|google\s*(?:'?da)?\s+gir(?:\s+ve)?)/gi, '').trim();
  // Strip trailing action verbs ("yaz arat", "yazıp ara", "yaz", "arat", "ara")
  q = q.replace(/\s*(?:yaz\s*arat|yazıp\s*ara|yazarak\s*ara|yaz|arat|ara|aç)\s*(?:google'?da|youtube'?da)?\s*$/gi, '').trim();

  return q || cmd;
}

/**
 * Extract note title and body
 */
function extractNoteContent(cmd) {
  // e.g. "Notlara 'Market' diye not aç içine süt al yaz"
  const title = extractQuoted(cmd) || 'Yeni Not';

  let body = cmd;
  const icineMatch = cmd.match(/(?:içine|içeriği|metin)\s+(?:de\s+)?["'“‘]?(.+?)["'”’]?(?:\s+yaz|\s+ekle|\s+kaydet|$)/i);
  if (icineMatch) {
    body = icineMatch[1].trim();
  } else {
    // strip note command words
    body = cmd.replace(/(?:notlara|notlar|not\s+oluştur|not\s+aç|yeni\s+not|diye\s+not|yaz|ekle)/gi, '').trim();
  }

  return { title, body: body || title };
}

/**
 * Dispatch natural language command to Jev and execute corresponding macOS action.
 * With `dryRun` the decision is made but nothing runs on the Mac.
 */
export async function dispatchCommand(userCommand, customApiKey = null, { dryRun = false } = {}) {
  const run = (name, ...args) => dryRun
    ? { success: true, message: `(deneme) ${name}(${args.map(a => JSON.stringify(a)).join(', ')})` }
    : controller[name](...args);

  const apiKey = customApiKey || getApiKey();
  if (!apiKey) {
    throw new Error('TypeSafe API Key bulunamadı! Lütfen .env dosyasına JEV_KEY ekleyin.');
  }

  const startTime = Date.now();

  // Ask Jev to classify
  const response = await fetch('https://api.typesafe.ai/v1/systemone', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      state: {
        command: userCommand
      },
      model: 'jev-latest',
      questions: {
        action: {
          type: 'choice',
          instructions: 'What primary system action should macOS take for the user `command`?',
          criteria: {
            open_url_or_search: 'Search the web or YouTube/Google, or open a new browser tab/URL',
            create_note: 'Create a new note or save text in Apple Notes',
            play_spotify_song: 'Search and play a specific song or artist on Spotify',
            open_app: 'Launch or open a desktop app (e.g. Spotify, VS Code, Safari, Calculator)',
            quit_app: 'Close or quit a running desktop app',
            set_volume: 'Change system audio volume level or mute/unmute',
            media_control: 'Simple play, pause, next track music controls',
            take_screenshot: 'Capture screenshot of display',
            toggle_dark_mode: 'Switch dark / light mode appearance',
            lock_screen: 'Lock computer or sleep display',
            unknown: 'Chat or unsupported system action'
          }
        },
        search_platform: {
          type: 'choice',
          instructions: 'If a web search is requested, which platform is preferred?',
          criteria: {
            youtube: 'YouTube video search',
            google: 'Google web search',
            none: 'Not a search query'
          }
        },
        browser: {
          type: 'choice',
          instructions: 'If a browser is specified in `command`, which one?',
          criteria: {
            safari: 'Apple Safari browser',
            chrome: 'Google Chrome',
            default: 'Default system browser'
          }
        },
        target_app: {
          type: 'choice',
          instructions: 'If an app is mentioned, which application is targeted?',
          criteria: {
            spotify: 'Spotify music player',
            vscode: 'Visual Studio Code / VS Code',
            safari: 'Safari web browser',
            chrome: 'Google Chrome',
            terminal: 'Terminal / console',
            calculator: 'Calculator / hesap makinesi',
            notes: 'Apple Notes / notlar',
            settings: 'System Settings / ayarlar',
            finder: 'Finder / dosya yöneticisi',
            none: 'No specific app mentioned'
          }
        },
        volume_target: {
          type: 'choice',
          instructions: 'If audio volume is mentioned in `command`, what level is requested?',
          criteria: {
            mute: 'Mute completely / sessize al (0%)',
            low: 'Low volume / kısık ses (20%)',
            medium: 'Medium volume / orta ses (50%)',
            high: 'High volume / yüksek ses (80%)',
            max: 'Maximum volume / son ses (100%)',
            none: 'Volume not mentioned'
          }
        },
        media_action: {
          type: 'choice',
          instructions: 'If `command` asks to control music playback, which control is it?',
          criteria: {
            play_pause: 'Play, pause, resume or stop the music / müziği başlat, durdur',
            next: 'Skip to the next track / sonraki şarkı',
            previous: 'Go back to the previous track / önceki şarkı',
            none: 'Not a playback control'
          }
        }
      }
    })
  });

  const durationMs = Date.now() - startTime;

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Jev API Hatası (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const answers = data.answers || {};

  const action = answers.action?.choice || 'unknown';
  const targetApp = answers.target_app?.choice || 'none';
  const searchPlatform = answers.search_platform?.choice || 'google';
  const browser = answers.browser?.choice || 'default';
  const volumeTarget = answers.volume_target?.choice || 'none';
  const mediaAction = answers.media_action?.choice || 'none';

  const executionResults = [];

  // 1. Web Search & Browser Navigation (e.g. "yeni bir sekme aç safaride YouTube a gir ve jev macOS control yaz arat")
  if (action === 'open_url_or_search') {
    const query = extractSearchQuery(userCommand);
    // If command mentions youtube explicitly, use youtube
    const isYoutube = /youtube/i.test(userCommand) || searchPlatform === 'youtube';
    const chosenBrowser = /safari/i.test(userCommand) ? 'safari' : browser;
    const res = await run('openWebSearch', query, isYoutube ? 'youtube' : 'google', chosenBrowser);
    executionResults.push(res);
  }

  // 2. Apple Notes Creation (e.g. "Notlara 'Toplantı' diye not aç içine 'Yarın saat 3' yaz")
  else if (action === 'create_note' || targetApp === 'notes' && /yaz|ekle|oluştur/i.test(userCommand)) {
    const { title, body } = extractNoteContent(userCommand);
    const res = await run('createNote', title, body);
    executionResults.push(res);
  }

  // 3. Spotify Song / Artist Search & Play (e.g. "Spotify'da Daft Punk aç")
  else if (action === 'play_spotify_song') {
    const query = userCommand.replace(/(?:spotify'?da|spotify'?dan|şarkısını|parçasını|aç|çal|başlat)/gi, '').trim();
    const res = await run('playSpotifySearch', query);
    executionResults.push(res);
  }

  // 4. Open App
  else if (action === 'open_app' && targetApp !== 'none') {
    const res = await run('openApp', targetApp);
    executionResults.push(res);
  }

  // 5. Quit App
  else if (action === 'quit_app' && targetApp !== 'none') {
    const res = await run('quitApp', targetApp);
    executionResults.push(res);
  }

  // 6. Screenshot
  else if (action === 'take_screenshot') {
    const res = await run('takeScreenshot');
    executionResults.push(res);
  }

  // 7. Dark Mode
  else if (action === 'toggle_dark_mode') {
    const res = await run('toggleDarkMode');
    executionResults.push(res);
  }

  // 8. Lock Screen
  else if (action === 'lock_screen') {
    const res = await run('lockScreen');
    executionResults.push(res);
  }

  // 9. Music playback ("sonraki şarkıya geç", "müziği durdur")
  else if (action === 'media_control' && mediaAction !== 'none') {
    const res = await run('mediaControl', mediaAction);
    executionResults.push(res);
  }

  // 10. Volume Control
  if (volumeTarget !== 'none' || action === 'set_volume') {
    const volMap = { mute: 0, low: 20, medium: 50, high: 80, max: 100, none: 50 };
    const numMatch = userCommand.match(/%\s*(\d+)|\b(\d+)\s*(?:yüzde|seviyesi)?\b/);
    const vol = numMatch ? parseInt(numMatch[1] || numMatch[2], 10) : (volMap[volumeTarget] ?? 50);
    const res = await run('setVolume', vol);
    executionResults.push(res);
  }

  if (executionResults.length === 0) {
    executionResults.push({
      success: false,
      message: `Anlaşılamadı veya desteklenmeyen komut: "${userCommand}". (Jev Kararı: ${action})`
    });
  }

  return {
    command: userCommand,
    latencyMs: durationMs,
    jevDecisions: {
      action,
      targetApp,
      searchPlatform,
      browser,
      mediaAction,
      confidence: answers.action?.confidence
    },
    rawAnswers: answers,
    executionResults
  };
}
