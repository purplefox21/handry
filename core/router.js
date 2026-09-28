// Fast path: Jev decides in one request what kind of command this is and the
// details it needs (volume level, music action…). Simple commands then run
// straight through the JEVIS tools, without asking an LLM. Anything longer or
// unclear goes to the brain.
import * as jev from './jev.js';
import { callTool } from './tools.js';
import { installedApps, apps as runningApps } from '../hands/desktop.js';

const ROUTE = {
  type: 'choice',
  instructions: 'The user gave JEVIS (a Mac assistant) the spoken or typed `command`. Which kind of command is it? Choose the single best option; pick needs_brain whenever it asks for more than one thing.',
  criteria: {
    volume: 'Change the sound volume: set a level or percentage, or make it louder or quieter. In Turkish "sesi aç" means louder, not opening an app (e.g. "sesi yüzde 30 yap", "sesi kıs", "sesi biraz aç", "sesi sonuna kadar aç")',
    mute: 'Mute the sound or unmute it (e.g. "sessize al", "sesi geri aç")',
    music: 'Control the music player: play, pause, resume, next song or previous song (e.g. "sonraki şarkı", "müziği durdur")',
    now_playing: 'Ask which song is playing right now',
    app_open: 'Open, launch or switch to one Mac application (e.g. "Spotify\'ı aç", "VS Code\'a geç", "hesap makinesini aç")',
    app_quit: 'Quit or close one Mac application',
    web_open: 'Open one website in the browser (e.g. "YouTube\'u aç", "github.com\'a git")',
    web_search: 'Search the web or YouTube for something (e.g. "Google\'da hava durumu ara")',
    page_click: 'Click one visible thing (a link, tab or button) on the web page that is already open in the JEVIS browser; only a click',
    dark_mode: 'Switch between dark and light mode',
    lock_screen: 'Lock the screen or put the display to sleep',
    screenshot: 'Take a screenshot of the whole screen',
    needs_brain: 'Anything else: more than one step, writing or typing a text, sending a message, filling forms, reading or summarizing, files and folders, questions, or anything unclear'
  }
};

// Asked in the same request; only the answer for the chosen route is used.
const DETAILS = {
  volume_how: {
    type: 'choice',
    instructions: 'If `command` changes the volume, how?',
    criteria: {
      number: 'It gives a number or a percentage',
      up: 'Louder, turn it up, a bit higher ("sesi aç", "biraz aç", "yükselt")',
      down: 'Quieter, turn it down, a bit lower ("sesi kıs", "azalt")',
      max: 'As loud as possible, full volume ("sonuna kadar", "en yüksek")',
      low: 'Very quiet, low volume',
      half: 'Medium, half volume'
    }
  },
  unmute: { type: 'noul', instructions: 'Does `command` ask to turn the sound back on (unmute) rather than to mute it?' },
  music_action: {
    type: 'choice',
    instructions: 'If `command` controls music, which control is it?',
    criteria: {
      play_pause: 'Play, pause, resume or stop',
      next_track: 'Next song, skip',
      previous_track: 'Previous song, go back'
    }
  },
  on_youtube: { type: 'noul', instructions: 'Does `command` ask to search on YouTube (videos) rather than a general web search?' }
};

const MIN_CONFIDENCE = 0.6;

// Well-known sites said by name ("YouTube'u aç") → address.
const SITES = {
  youtube: 'youtube.com', google: 'google.com', gmail: 'mail.google.com', github: 'github.com', twitter: 'x.com',
  instagram: 'instagram.com', facebook: 'facebook.com', linkedin: 'linkedin.com', reddit: 'reddit.com', netflix: 'netflix.com',
  whatsapp: 'web.whatsapp.com', chatgpt: 'chatgpt.com', claude: 'claude.ai', wikipedia: 'wikipedia.org', vikipedi: 'tr.wikipedia.org',
  'hacker news': 'news.ycombinator.com', 'app store connect': 'appstoreconnect.apple.com', amazon: 'amazon.com.tr',
  trendyol: 'trendyol.com', hepsiburada: 'hepsiburada.com', sahibinden: 'sahibinden.com', 'ekşi': 'eksisozluk.com', eksi: 'eksisozluk.com',
  'google drive': 'drive.google.com', 'google maps': 'maps.google.com', harita: 'maps.google.com', twitch: 'twitch.tv', figma: 'figma.com'
};

function siteIn(command) {
  const domain = command.match(/\b[a-z0-9-]+(\.[a-z0-9-]+)+\b/i)?.[0];
  if (domain) return domain;
  const lower = command.toLocaleLowerCase('tr');
  const key = Object.keys(SITES).sort((a, b) => b.length - a.length).find(k => lower.includes(k));
  return key ? SITES[key] : null;
}

// "Google'da 'mac mini fiyatları' ara" → "mac mini fiyatları"
function searchQuery(command) {
  const quoted = command.match(/["“'‘]([^"”'’]{2,})["”'’]/)?.[1];
  if (quoted) return quoted.trim();
  return command
    .replace(/\b(google|youtube|internet|web)\s*'?(da|de|ta|te|dan|den)?\b/gi, ' ')
    .replace(/(araştır|aratır mısın|arat|ara|bul|search)(?=\s|$)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function pickApp(command, { running = false } = {}) {
  const names = running
    ? (await runningApps()).map(a => a.name)
    : [...new Set([...(await runningApps()).map(a => a.name), ...installedApps()])];
  const pick = await jev.pickOption('Mac application the user means', command, names);
  if (pick.index === null || !jev.isConfident(pick)) return null;
  return names[pick.index];
}

/** Runs one tool as a visible step; returns its text, or throws on error. */
async function step(onEvent, name, args) {
  onEvent({ type: 'tool', name, args });
  const result = await callTool(name, args);
  const text = result.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
  onEvent({ type: 'tool_result', name, text, isError: Boolean(result.isError) });
  if (result.isError) throw new Error(text);
  return text;
}

const firstLine = text => String(text).split('\n')[0];

/**
 * Tries the fast path. Returns { handled: true, text } when done, or
 * { handled: false, note } so the caller hands the command to a brain.
 */
export async function classify(command) {
  const { answers, ms } = await jev.ask({ command }, { route: ROUTE, ...DETAILS });
  return { route: answers.route?.choice || 'needs_brain', confidence: answers.route?.confidence ?? 0, answers, ms };
}

export async function tryFast(command, onEvent) {
  const { route, confidence, answers, ms } = await classify(command);
  onEvent({ type: 'route', route, confidence: Math.round(confidence * 100), ms });
  if (route === 'needs_brain' || confidence < MIN_CONFIDENCE) return { handled: false };

  try {
    switch (route) {
      case 'volume': {
        const how = answers.volume_how?.choice;
        const number = command.match(/(\d{1,3})/)?.[1];
        if (how === 'up' || how === 'down') return { handled: true, text: firstLine(await step(onEvent, 'mac_action', { action: `volume_${how}`, value: number || '10' })) };
        const level = number ?? { max: '100', low: '15', half: '50' }[how];
        if (level === undefined) return { handled: false };
        return { handled: true, text: firstLine(await step(onEvent, 'mac_action', { action: 'volume', value: String(level) })) };
      }
      case 'mute':
        return { handled: true, text: firstLine(await step(onEvent, 'mac_action', { action: (answers.unmute?.noul ?? 0) >= 0.5 ? 'unmute' : 'mute' })) };
      case 'music':
        return { handled: true, text: firstLine(await step(onEvent, 'mac_action', { action: answers.music_action?.choice || 'play_pause' })) };
      case 'now_playing':
        return { handled: true, text: firstLine(await step(onEvent, 'mac_action', { action: 'now_playing' })) };
      case 'dark_mode':
        return { handled: true, text: firstLine(await step(onEvent, 'mac_action', { action: 'dark_mode' })) };
      case 'lock_screen':
        return { handled: true, text: firstLine(await step(onEvent, 'mac_action', { action: 'lock_screen' })) };
      case 'screenshot':
        return { handled: true, text: firstLine(await step(onEvent, 'mac_action', { action: 'screenshot' })) };
      case 'app_open':
      case 'app_quit': {
        const name = await pickApp(command, { running: route === 'app_quit' });
        if (!name) return { handled: false, note: 'Hangi uygulama olduğundan emin olamadım.' };
        await step(onEvent, route === 'app_open' ? 'desktop_open_app' : 'desktop_quit_app', { name });
        return { handled: true, text: route === 'app_open' ? `${name} açıldı.` : `${name} kapatıldı.` };
      }
      case 'web_open': {
        const site = siteIn(command);
        if (!site) return { handled: false };
        const text = await step(onEvent, 'browser_open', { url: site });
        return { handled: true, text: `Açıldı: ${text.match(/Şu an: (.+?) \(/)?.[1] || site}` };
      }
      case 'web_search': {
        const query = searchQuery(command);
        if (!query) return { handled: false };
        const youtube = (answers.on_youtube?.noul ?? 0) >= 0.5;
        const url = youtube
          ? `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
          : `https://www.google.com/search?q=${encodeURIComponent(query)}`;
        await step(onEvent, 'browser_open', { url });
        return { handled: true, text: `${youtube ? 'YouTube' : 'Google'}'da arandı: ${query}` };
      }
      case 'page_click': {
        const text = await step(onEvent, 'browser_click', { target: command });
        const clicked = text.match(/Öğe: "([^"]+)"/)?.[1] || command;
        const opened = text.includes('Sayfa değişti') || text.includes('Yeni sekme') ? text.match(/Şu an: (.+?) \(/)?.[1] : null;
        return { handled: true, text: `"${clicked}" tıklandı.${opened ? ` Açılan sayfa: ${opened}` : ''}` };
      }
      default:
        return { handled: false };
    }
  } catch (err) {
    return { handled: false, note: `Hızlı yol olmadı: ${firstLine(err.message)}` };
  }
}
