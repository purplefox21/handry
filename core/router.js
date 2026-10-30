// Fast path: Jev decides in one request what kind of command this is and the
// details it needs (volume level, music action…), and whether it is a task
// Handry learned before (core/learn.js). Simple commands then run straight
// through the Handry tools and learned tasks replay, without asking an LLM.
// Anything longer or unclear goes to the brain, and so does anything that is
// not a plain "do this now": chatting, a complaint or a correction, an answer
// to what Handry asked, or something for later (timers are set by rules here,
// or by the brain with schedule_task).
import * as jev from './jev.js';
import { parseSchedule, listJobs, cancelJobs, describe } from './timers.js';
import { callTool } from './tools.js';
import { installedApps, apps as runningApps } from '../hands/desktop.js';
import { listLearned, learnedQuestion, matchLearned } from './learn.js';
import { pickSpan } from './spans.js';

const ROUTE = {
  type: 'choice',
  instructions: 'The user gave Handry (a Mac assistant) the spoken or typed `command`. Which kind of command is it? Judge `command` by its own words only (not `previous`). Choose the single best option; pick needs_brain whenever it asks for more than one thing or does not say what to do.',
  criteria: {
    volume: 'Change the sound volume: set a level or percentage, or make it louder or quieter. In Turkish "sesi aç" means louder, not opening an app (e.g. "sesi yüzde 30 yap", "sesi kıs", "sesi biraz aç", "sesi sonuna kadar aç")',
    mute: 'Mute the sound or unmute it (e.g. "sessize al", "sesi geri aç")',
    music: 'Control the music player without naming what to play: play, pause, resume, next song or previous song (e.g. "sonraki şarkı", "müziği durdur")',
    spotify_play: 'Play something named on Spotify: a song, an artist, an album, a playlist, or the liked songs (e.g. "Spotify\'da Tarkan çal", "beğendiğim şarkıları çal", "Space Echo listesini çal")',
    now_playing: 'Ask which song is playing right now',
    app_open: 'Open, launch or switch to one Mac application (e.g. "Spotify\'ı aç", "VS Code\'a geç", "hesap makinesini aç")',
    app_quit: 'Quit or close one Mac application',
    web_open: 'Open one website in the browser (e.g. "YouTube\'u aç", "github.com\'a git")',
    web_search: 'Search the web or YouTube for something (e.g. "Google\'da hava durumu ara")',
    page_click: 'Click one visible thing (a link, tab or button) on the web page that is already open in the Handry browser; only a click',
    dark_mode: 'Switch between dark and light mode',
    lock_screen: 'Lock the screen now (not shutting down or sleeping the Mac)',
    screenshot: 'Take a screenshot of the whole screen',
    note_add: 'Write down one short note in Notes (e.g. "not al: yarın kargo gelecek", "notlarıma süt almayı ekle")',
    calendar_show: 'Ask what is on the calendar today, tomorrow or this week (only asking, not adding)',
    reminders_show: 'Ask which reminders or to-dos are open (only asking, not adding)',
    needs_brain: 'Anything else: more than one step, writing or typing a text, sending a message, filling forms, reading or summarizing, files and folders, adding reminders or events, questions, or anything unclear'
  }
};

// Asked in the same request: only a plain "do it now" goes down the fast path.
const INTENT = {
  type: 'choice',
  instructions: 'What is the user doing with `command`? `previous` is what Handry said to the user just before (empty if nothing recent).',
  criteria: {
    do_now: 'Telling Handry to do something on the Mac right now, or asking it to show something now (e.g. "sesi kıs", "Spotify\'ı aç", "ekranı kilitle", "şu an hangi şarkı çalıyor", "yarın takvimde ne var"); writing a note or a reminder text now counts even if the text mentions another day (e.g. "not al: yarın kargo gelecek")',
    do_later: 'Telling Handry to do something at a later time or when something happens (e.g. "saat 3\'te ekranı kilitle", "10 dakika sonra hatırlat", "işler bitince bilgisayarı kapat")',
    reply: 'Answering, correcting or clarifying what Handry said or asked in `previous` (e.g. "hayır öyle değil", "ikisi de", "kapatma, sadece kilitle"), or pointing back to something earlier without naming it (e.g. "bunu bir daha yap", "aynısını yap", "onu da", "tekrar dene")',
    chat: 'Greeting, chatting, a complaint (e.g. "anlamadın", "cümleyi okumadın"), a question about Handry itself or about the conversation (e.g. "ne dedim sana", "neler yapabilirsin", "böyle bir becerin var mı"), or saying what not to do'
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
  on_youtube: { type: 'noul', instructions: 'Does `command` ask to search on YouTube (videos) rather than a general web search?' },
  liked: { type: 'noul', instructions: 'Does `command` ask to play the user\'s liked or saved songs (Beğenilen Şarkılar), rather than something named?' },
  calendar_when: {
    type: 'choice',
    instructions: 'If `command` asks about the calendar, for when?',
    criteria: { today: 'Today', tomorrow: 'Tomorrow', week: 'This week or the next days' }
  }
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

// The page guard notices logins, 2FA and CAPTCHAs ("⚠️ …"): tell the user.
const needsUserNote = text => (String(text).includes('⚠️') ? ' Sayfa giriş ya da doğrulama (CAPTCHA) istiyor; tarayıcıda senin halletmen gerekiyor.' : '');

export async function classify(command, learned = listLearned(), { previous = '' } = {}) {
  const question = learnedQuestion(learned);
  const { answers, ms } = await jev.ask({ command, previous }, { route: ROUTE, intent: INTENT, ...DETAILS, ...(question ? { learned: question } : {}) });
  return { route: answers.route?.choice || 'needs_brain', confidence: answers.route?.confidence ?? 0, intent: answers.intent?.choice || 'do_now', answers, ms };
}

/** Does this decision go down the fast path? */
export const goesFast = c => c.intent === 'do_now' && c.route !== 'needs_brain' && c.confidence >= MIN_CONFIDENCE;

const localTime = t => { const d = new Date(t); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };

// Timers and power commands that the rules in timers.js understood.
async function scheduleFast(parsed, command, onEvent) {
  if (parsed.type === 'list') return { handled: true, text: await step(onEvent, 'scheduled_tasks', {}) };
  if (parsed.type === 'cancel') return { handled: true, text: await step(onEvent, 'cancel_scheduled', { all: true }) };
  if (parsed.type === 'negated') {
    // "bilgisayarı kapatma": cancels a waiting shutdown; otherwise it is just talk.
    const gone = cancelJobs(j => parsed.actions.includes(j.action));
    return { handled: true, text: `Tamam, yapmıyorum. İptal edildi: ${gone.map(describe).join('; ')}` };
  }
  const args = { action: parsed.action, said: command };
  if (parsed.at) args.at = localTime(parsed.at);
  if (parsed.claude) args.until = { claude_done: true };
  return { handled: true, text: await step(onEvent, 'schedule_task', args) };
}

/**
 * Tries the fast path. Returns { handled: true, text } when done,
 * { handled: false, learned: { recipe, vars } } for a learned task, or
 * { handled: false, note } so the caller hands the command to a brain.
 */
export async function tryFast(command, onEvent, { previous = '' } = {}) {
  const parsed = parseSchedule(command);
  if (parsed?.type === 'brain') {
    onEvent({ type: 'route', route: 'needs_brain', confidence: 100, ms: 0 });
    return { handled: false };
  }
  if (parsed && parsed.type !== 'now') {
    // "bilgisayarı kapatma" with nothing waiting is talk, not a command.
    if (parsed.type === 'negated' && !listJobs().some(j => parsed.actions.includes(j.action))) {
      onEvent({ type: 'route', route: 'needs_brain', why: 'negated', confidence: 100, ms: 0 });
      return { handled: false };
    }
    onEvent({ type: 'route', route: 'timer', confidence: 100, ms: 0 });
    try {
      return await scheduleFast(parsed, command, onEvent);
    } catch (err) {
      return { handled: false, note: `Hızlı yol olmadı: ${firstLine(err.message)}` };
    }
  }
  const learned = listLearned();
  const decision = await classify(command, learned, { previous });
  const { confidence, answers, ms, intent } = decision;
  // "bilgisayarı kapat" & co. were read by the rules; Jev still has to agree that it is meant now.
  const route = parsed?.type === 'now' ? `power_${parsed.action}` : decision.route;
  if (intent !== 'do_now') {
    onEvent({ type: 'route', route: 'needs_brain', why: intent, confidence: Math.round((answers.intent?.confidence ?? 0) * 100), ms });
    return { handled: false };
  }
  if (parsed?.type === 'now') {
    onEvent({ type: 'route', route, confidence: 100, ms });
    try {
      const action = parsed.action === 'lock' ? 'lock_screen' : parsed.action;
      return { handled: true, text: firstLine(await step(onEvent, 'mac_action', { action })) };
    } catch (err) {
      return { handled: false, note: `Hızlı yol olmadı: ${firstLine(err.message)}` };
    }
  }
  // A learned task is more specific than any simple route ("Spotify'da X listesini çal" is not just "play").
  const match = answers.learned ? await matchLearned(command, answers.learned, learned).catch(() => null) : null;
  if (match) {
    onEvent({ type: 'route', route: 'learned', confidence: Math.round((answers.learned.confidence ?? 0) * 100), ms });
    return { handled: false, learned: match };
  }
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
        return { handled: true, text: `Açıldı: ${text.match(/Şu an: (.+?) \(/)?.[1] || site}.${needsUserNote(text)}` };
      }
      case 'web_search': {
        const query = searchQuery(command);
        if (!query) return { handled: false };
        const youtube = (answers.on_youtube?.noul ?? 0) >= 0.5;
        const url = youtube
          ? `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
          : `https://www.google.com/search?q=${encodeURIComponent(query)}`;
        const text = await step(onEvent, 'browser_open', { url });
        return { handled: true, text: `${youtube ? 'YouTube' : 'Google'}'da arandı: ${query}.${needsUserNote(text)}` };
      }
      case 'spotify_play': {
        const liked = (answers.liked?.noul ?? 0) >= 0.5;
        const what = liked ? null : await pickSpan(command, 'What should be played: the name of the song, artist, album or playlist?');
        if (!liked && !what) return { handled: false };
        return { handled: true, text: firstLine(await step(onEvent, 'spotify_play', liked ? { liked: true } : { what })) };
      }
      case 'note_add': {
        // "not al: …" gives the text after the colon; otherwise Jev picks it out.
        const body = command.match(/\bnot[^:]{0,30}:\s+(.+)$/i)?.[1]?.trim()
          || await pickSpan(command, 'What is the text of the note to write down, without words like "not al" or "notlarıma ekle"?', { maxWords: 16 });
        if (!body) return { handled: false };
        return { handled: true, text: firstLine(await step(onEvent, 'notes_add', { text: body })) };
      }
      case 'calendar_show': {
        const range = { today: { from: 0, days: 1 }, tomorrow: { from: 1, days: 1 }, week: { from: 0, days: 7 } }[answers.calendar_when?.choice] || { from: 0, days: 1 };
        return { handled: true, text: await step(onEvent, 'calendar_events', range) };
      }
      case 'reminders_show':
        return { handled: true, text: await step(onEvent, 'reminders_list', {}) };
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
