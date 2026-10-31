// Handry · © 2026 Berat Olekli (purplefox) · github.com/purplefox21/handry
// App shortcuts. Spotify: open a search or Liked Songs and press its play
// button through the accessibility tree (no Apple Events permission needed).
// Music, Notes, Reminders and Calendar: AppleScript, with user text passed as
// arguments (never spliced into the script). macOS asks the user once per
// app whether Handry may control it; Handry checks that state without asking
// and explains a refusal instead of failing with an error code.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { JevisError } from '../core/errors.js';
import * as desktop from './desktop.js';
import { APP } from '../core/brand.js';
import { T } from '../core/i18n.js';

const execFileAsync = promisify(execFile);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const RS = String.fromCharCode(30); // record separator between results

const APPS = {
  music: { id: 'com.apple.Music', name: ['Müzik', 'Music'] },
  notes: { id: 'com.apple.Notes', name: ['Notlar', 'Notes'] },
  reminders: { id: 'com.apple.reminders', name: ['Anımsatıcılar', 'Reminders'] },
  calendar: { id: 'com.apple.iCal', name: ['Takvim', 'Calendar'] }
};

/**
 * Runs an AppleScript against one of APPS. The app is started in the
 * background first so the permission state can be read; a permission
 * question on screen is waited for (up to 90 s).
 */
async function script(appKey, lines, args = []) {
  const app = { ...APPS[appKey], name: T(...APPS[appKey].name) };
  await execFileAsync('open', ['-gjb', app.id], { timeout: 15000 }).catch(() => {});
  const { state } = await desktop.automationState(app.id).catch(() => ({ state: 'unknown' }));
  if (state === 'denied') {
    throw new JevisError('NO_PERMISSION', T(`${APP.genitive} ${app.name} uygulamasını kullanma izni kapalı. Sistem Ayarları › Gizlilik ve Güvenlik › Otomasyon bölümünde Handry'yi çalıştıran uygulamanın altında ${app.name}'ı aç.`, `${APP.name} isn't allowed to use ${app.name}. In System Settings › Privacy & Security › Automation, turn on ${app.name} under the app that runs ${APP.name}.`));
  }
  try {
    const { stdout } = await execFileAsync('osascript', ['-e', lines.join('\n'), ...args.map(String)], { timeout: 90000, maxBuffer: 20 * 1024 * 1024 });
    return stdout.replace(/\n$/, '');
  } catch (err) {
    if (/-1743|not allowed|izin/i.test(err.stderr || err.message)) throw new JevisError('NO_PERMISSION', T(`${app.name} için izin verilmedi. Sistem Ayarları › Gizlilik ve Güvenlik › Otomasyon'dan açabilirsin.`, `${app.name} wasn't allowed. You can turn it on in System Settings › Privacy & Security › Automation.`));
    if (err.killed) throw new JevisError('TIMEOUT', T(`${app.name} cevap vermedi. Ekranda macOS'un izin sorusu varsa "İzin Ver"e bas ve tekrar dene.`, `${app.name} didn't answer. If macOS is asking for permission on the screen, press "Allow" and try again.`));
    throw new JevisError('APP', `${app.name}: ${(err.stderr || err.message).replace(/^.*execution error: /s, '').trim()}`);
  }
}

// "2026-09-29T14:30" (local time) → the arguments the date-building AppleScript lines take.
function dateArgs(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2}))?/);
  if (!m) throw new JevisError('BAD_ARGS', T(`Tarih anlaşılmadı: "${iso}" (ör. 2026-09-29T14:30).`, `Couldn't read the date: "${iso}" (e.g. 2026-09-29T14:30).`));
  return [m[1], Number(m[2]), Number(m[3]), m[4] ? Number(m[4]) : 9, m[5] ? Number(m[5]) : 0];
}
// Builds `d` from argv items first..first+4 without month overflow (31 Jan → Feb).
const DATE_LINES = first => [
  'set d to current date',
  'set day of d to 1',
  `set year of d to (item ${first} of argv) as integer`,
  `set month of d to (item ${first + 1} of argv) as integer`,
  `set day of d to (item ${first + 2} of argv) as integer`,
  `set hours of d to (item ${first + 3} of argv) as integer`,
  `set minutes of d to (item ${first + 4} of argv) as integer`,
  'set seconds of d to 0'
];
const ISO = 'as «class isot» as string';
// English: "Sun, Nov 1, 9:00 AM" (no leading zero on the hour)
const hour = () => T('2-digit', 'numeric');
const when = iso => (iso ? new Date(iso).toLocaleString(T('tr-TR', 'en-US'), { weekday: 'short', day: 'numeric', month: 'short', hour: hour(), minute: '2-digit' }) : '');

// ---------------------------------------------------------------------------
// Spotify (accessibility tree, no Apple Events)
// ---------------------------------------------------------------------------

const PLAYER = /Oyuncu denetimleri|Player controls/i;
const playing = async () => (await desktop.read({ app: 'Spotify' })).elements.some(e => e.role === 'Button' && /^(Duraklat|Pause)$/.test(e.name) && PLAYER.test(e.ctx || ''));
const lower = s => String(s ?? '').toLocaleLowerCase('tr').trim();

/**
 * The play button to press, once the page has loaded: Liked Songs' own, or
 * the first plain "Çal" outside the player bar, which is the top search
 * result's. null while the search box still shows another query.
 */
async function playButton(what, liked) {
  const r = await desktop.read({ app: 'Spotify' });
  if (liked) return r.elements.find(e => e.role === 'Button' && /^(Çal|Play): (Beğenilen Şarkılar|Liked Songs)$/.test(e.name)) || null;
  const box = r.elements.find(e => e.role === 'ComboBox' && /çalmak istiyorsun|want to play/i.test(e.name || ''));
  if (box && lower(box.value) !== lower(what)) return null;
  return r.elements.find(e => e.role === 'Button' && /^(Çal|Play)$/.test(e.name) && !PLAYER.test(e.ctx || '')) || null;
}

/**
 * Plays something on Spotify: the top search result for `what`, or the
 * Liked Songs. Waits for the page, presses its play button (Jev picks it if
 * the page looks different than expected) and checks that music plays.
 */
export async function spotifyPlay(what, { liked = false } = {}) {
  if (!liked && !String(what || '').trim()) throw new JevisError('BAD_ARGS', T('Ne çalınacağı söylenmedi.', "You didn't say what to play."));
  // Spotify brings itself to the front on its links; the user goes back to where they were afterwards.
  const before = await desktop.frontmost().catch(() => null);
  await execFileAsync('open', [liked ? 'spotify:collection:tracks' : `spotify:search:${encodeURIComponent(what)}`], { timeout: 15000 });
  let button = null;
  for (let i = 0; i < 12 && !button; i++) {
    await sleep(i === 0 ? 900 : 500);
    button = await playButton(what, liked).catch(() => null);
  }
  const clicked = button
    ? await desktop.click(`#${button.id}`, { app: 'Spotify' })
    : await desktop.click(liked ? 'the big play button of the Liked Songs playlist (Beğenilen Şarkılar)' : `the play button (Çal) of the top search result for "${what}", not the player controls`, { app: 'Spotify' });
  let on = false;
  for (let i = 0; i < 8 && !on; i++) { await sleep(400); on = await playing().catch(() => false); }
  if (before?.pid && before.bundleId !== 'com.spotify.client') await desktop.activate(before.pid).catch(() => {});
  return { played: liked ? T('Beğenilen Şarkılar', 'Liked Songs') : what, element: clicked.element, playing: on };
}

/** Pauses Spotify through its own player button. */
export async function spotifyPause() {
  if (!(await playing())) return { paused: false, note: T('Spotify zaten çalmıyor.', "Spotify isn't playing.") };
  const pause = (await desktop.read({ app: 'Spotify' })).elements.find(e => e.role === 'Button' && /^(Duraklat|Pause)$/.test(e.name) && PLAYER.test(e.ctx || ''));
  await desktop.click(pause ? `#${pause.id}` : 'Duraklat (oyuncu denetimleri)', { app: 'Spotify' });
  return { paused: true };
}

// ---------------------------------------------------------------------------
// Music, Notes, Reminders, Calendar (AppleScript)
// ---------------------------------------------------------------------------

export const SCRIPTS = {
  musicPlay: [
    'on run argv',
    'set q to item 1 of argv',
    'set playlistWord to item 2 of argv',
    'set notFoundWord to item 3 of argv',
    'tell application "Music"',
    '  set pl to (every playlist whose name is q)',
    '  if pl is not {} then',
    '    play item 1 of pl',
    '    return playlistWord & (name of item 1 of pl)',
    '  end if',
    '  set found to (every track of library playlist 1 whose name contains q or artist contains q or album contains q)',
    '  if found is {} then error notFoundWord & q',
    '  play item 1 of found',
    '  return (name of item 1 of found) & " — " & (artist of item 1 of found)',
    'end tell',
    'end run'
  ],
  noteAdd: [
    'on run argv',
    'tell application "Notes" to make new note with properties {body:(item 1 of argv)}',
    'end run'
  ],
  notesFind: [
    'on run argv',
    'set q to item 1 of argv',
    'set out to ""',
    'tell application "Notes"',
    '  repeat with n in (notes whose name contains q or plaintext contains q)',
    `    set out to out & (name of n) & tab & ((modification date of n) ${ISO}) & tab & (plaintext of n) & (ASCII character 30)`,
    '  end repeat',
    'end tell',
    'return out',
    'end run'
  ],
  reminderAdd: [
    'on run argv',
    'set theName to item 1 of argv',
    'set listName to item 2 of argv',
    ...DATE_LINES(4),
    'tell application "Reminders"',
    '  if listName is "" then',
    '    set theList to default list',
    '  else',
    '    set theList to list listName',
    '  end if',
    '  if (item 3 of argv) is "1" then',
    '    make new reminder at end of theList with properties {name:theName, due date:d}',
    '  else',
    '    make new reminder at end of theList with properties {name:theName}',
    '  end if',
    '  return name of theList',
    'end tell',
    'end run'
  ],
  remindersList: [
    'set out to ""',
    'tell application "Reminders"',
    '  repeat with l in lists',
    '    repeat with r in (reminders of l whose completed is false)',
    '      set dueText to ""',
    '      try',
    `        set dueText to ((due date of r) ${ISO})`,
    '      end try',
    '      set out to out & (name of r) & tab & dueText & tab & (name of l) & (ASCII character 30)',
    '    end repeat',
    '  end repeat',
    'end tell',
    'return out'
  ],
  calendarEvents: [
    'on run argv',
    'set startD to current date',
    'set time of startD to 0',
    'set startD to startD + ((item 1 of argv) as integer) * days',
    'set endD to startD + ((item 2 of argv) as integer) * days',
    'set out to ""',
    'tell application "Calendar"',
    '  repeat with c in calendars',
    '    repeat with e in (every event of c whose start date ≥ startD and start date < endD)',
    `      set out to out & (summary of e) & tab & ((start date of e) ${ISO}) & tab & ((end date of e) ${ISO}) & tab & (name of c) & (ASCII character 30)`,
    '    end repeat',
    '  end repeat',
    'end tell',
    'return out',
    'end run'
  ],
  calendarAdd: [
    'on run argv',
    'set theTitle to item 1 of argv',
    'set calName to item 2 of argv',
    'set mins to (item 3 of argv) as integer',
    ...DATE_LINES(4),
    'tell application "Calendar"',
    '  if calName is "" then',
    '    set c to first calendar whose writable is true',
    '  else',
    '    set c to calendar calName',
    '  end if',
    '  make new event at end of events of c with properties {summary:theTitle, start date:d, end date:d + mins * minutes}',
    '  return name of c',
    'end tell',
    'end run'
  ]
};

const rows = out => out.split(RS).map(r => r.replace(/^\n/, '')).filter(r => r.trim()).map(r => r.split('\t'));
const escapeHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function musicPlay(query) {
  // the script's own words (a playlist found, nothing found) come in as arguments 2 and 3
  const said = [T('Çalma listesi: ', 'Playlist: '), T('Müzik kitaplığında bulunamadı: ', 'Not in the Music library: ')];
  const started = await script('music', SCRIPTS.musicPlay, [query, ...said]);
  return { message: T(`Müzik çalıyor: ${started}`, `Playing in Music: ${started}`) };
}

/** A note in Notes; its first line is the title. */
export async function noteAdd(text, title) {
  const body = [title, text].filter(Boolean).map(line => `<div>${escapeHtml(line).replace(/\n/g, '<br>')}</div>`).join('');
  await script('notes', SCRIPTS.noteAdd, [body]);
  const shown = title || String(text).split('\n')[0].slice(0, 60);
  return { message: T(`Notlar'a eklendi: ${shown}`, `Added to Notes: ${shown}`) };
}

export async function notesFind(query) {
  const found = rows(await script('notes', SCRIPTS.notesFind, [query])).slice(0, 10)
    .map(([name, modified, ...rest]) => ({ name, modified, text: rest.join('\t').slice(0, 1500) }));
  return { query, notes: found };
}

/** due: "2026-09-29T14:30" in local time, or nothing. */
export async function reminderAdd(text, { due, list = '' } = {}) {
  const date = due ? dateArgs(due) : ['2000', 1, 1, 9, 0];
  const listName = await script('reminders', SCRIPTS.reminderAdd, [text, list, due ? '1' : '0', ...date]);
  const at = due ? ` — ${when(due)}` : '';
  return { message: T(`Anımsatıcı eklendi (${listName}): ${text}${at}`, `Reminder added (${listName}): ${text}${at}`) };
}

export async function remindersList() {
  return { reminders: rows(await script('reminders', SCRIPTS.remindersList)).map(([name, due, list]) => ({ name, due: due || null, list })) };
}

/** Events from `from` days after today (0 = today) for `days` days. */
export async function calendarEvents({ from = 0, days = 1 } = {}) {
  const events = rows(await script('calendar', SCRIPTS.calendarEvents, [from, days]))
    .map(([title, start, end, calendar]) => ({ title, start, end, calendar }))
    .sort((a, b) => String(a.start).localeCompare(String(b.start)));
  return { from, days, events };
}

export async function calendarAdd(title, start, { minutes = 60, calendar = '' } = {}) {
  const name = await script('calendar', SCRIPTS.calendarAdd, [title, calendar, minutes, ...dateArgs(start)]);
  return { message: T(`Takvime eklendi (${name}): ${title} — ${when(start)}, ${minutes} dk`, `Added to Calendar (${name}): ${title} — ${when(start)}, ${minutes} min`) };
}

// ---------------------------------------------------------------------------
// Text for the brain / the user
// ---------------------------------------------------------------------------

const DAY_NAMES = { 0: 'Bugün', 1: 'Yarın' };
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "today", "tomorrow", "in 3 days", "for the next 7 days", "for 7 days starting tomorrow" */
function spanEn({ from, days }) {
  const start = from === 0 ? 'today' : from === 1 ? 'tomorrow' : `in ${from} days`;
  if (days === 1) return start;
  return from === 0 ? `for the next ${days} days` : `for ${days} days starting ${start}`;
}

export function formatEvents(r) {
  const span = r.days === 1 ? (DAY_NAMES[r.from] || `${r.from} gün sonra`) : `${r.days} gün`;
  const locale = T('tr-TR', 'en-US');
  if (!r.events.length) return T(`${span} takviminde bir şey yok.`, `Nothing on your calendar ${spanEn(r)}.`);
  return [T(`${span} takviminde ${r.events.length} etkinlik:`, `${plural(r.events.length, 'event')} ${spanEn(r)}:`), ...r.events.map(e => {
    const allDay = /T00:00:00$/.test(e.start) && /T00:00:00$/.test(e.end);
    const t = new Date(e.start);
    const time = allDay ? T('tüm gün', 'all day') : t.toLocaleTimeString(locale, { hour: hour(), minute: '2-digit' });
    return `- ${r.days > 1 ? `${t.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })} ` : ''}${time}: ${e.title} (${e.calendar})`;
  })].join('\n');
}

export function formatReminders(r) {
  if (!r.reminders.length) return T('Açık anımsatıcı yok.', 'No open reminders.');
  return [T(`${r.reminders.length} açık anımsatıcı:`, `${plural(r.reminders.length, 'open reminder')}:`), ...r.reminders.slice(0, 40).map(x => `- ${x.name}${x.due ? ` — ${when(x.due)}` : ''} (${x.list})`)].join('\n');
}

export function formatNotes(r) {
  if (!r.notes.length) return T(`"${r.query}" geçen not yok.`, `No notes mention "${r.query}".`);
  return r.notes.map(n => `📝 ${n.name} (${n.modified ? when(n.modified) : ''})\n${n.text}`).join('\n\n');
}
