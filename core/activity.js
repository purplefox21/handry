// What the assistant is doing, for the pet on the screen (the hand or the fox): the app reads
// ~/.jevis/activity.json a few times a second. thinking (Claude is planning),
// tool (with the app it works in, so the pet can run under its window), done,
// error, attention (it needs the user). Written by the runner, by every JEVIS
// tool call (also from other Claude sessions through MCP) and by alerts.
import fs from 'node:fs';
import path from 'node:path';
import { HOME } from './config.js';

export function setActivity(kind, extra = {}) {
  try {
    fs.mkdirSync(HOME, { recursive: true });
    fs.writeFileSync(path.join(HOME, 'activity.json'), JSON.stringify({ at: Date.now(), kind, ...extra }));
  } catch {}
}

// Apps by bundle id (window owner names are in the Mac's language: "Müzik", "Takvim"…).
const APPS = {
  spotify_play: 'com.spotify.client', music_play: 'com.apple.Music', notes_add: 'com.apple.Notes', notes_find: 'com.apple.Notes',
  reminders_add: 'com.apple.reminders', reminders_list: 'com.apple.reminders', calendar_events: 'com.apple.iCal', calendar_add: 'com.apple.iCal'
};

/** The app a tool works in: a bundle id or an app name, '' when it is not about one window. */
export function appOfTool(name, args = {}) {
  if (name.startsWith('browser_')) return 'com.google.Chrome';
  if (name.startsWith('desktop_')) return args.app || args.name || '';
  return APPS[name] || '';
}
