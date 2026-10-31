// Handry speaks Turkish or English. The setting is config "language": "tr",
// "en", or "auto" (the default: Turkish when the Mac's own first language is
// Turkish, English otherwise); JEVIS_LANG=tr|en overrides it for one run
// (tests). It is read again when ~/.jevis/config.json changes, so a switch in
// the window reaches the server and the MCP servers without a restart; the
// Swift app reads the same setting (Handry.swift), the pages get it from the
// server. Strings sit where they are used, in both languages:
//   T(`${name} açıldı.`, `${name} opened.`)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { HOME, PROJECT_CONFIG, resetConfig } from './config.js';

export const LANGUAGES = ['tr', 'en'];
const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return {}; } };
const userConfig = () => path.join(HOME, 'config.json');

let mac;
/** The Mac's own first language ("tr", "en", "de"…): the language of its menus and buttons, whatever Handry speaks. */
export function macLanguage() {
  if (mac === undefined) {
    try {
      // ( "tr-TR", "en-TR" )
      const first = execFileSync('defaults', ['read', '-g', 'AppleLanguages'], { encoding: 'utf-8', timeout: 2000 }).replace(/[()"]/g, ' ').trim().split(/[\s,]+/)[0];
      mac = first.split(/[-_]/)[0].toLowerCase() || null;
    } catch {
      mac = null;
    }
    mac ||= (process.env.LANG || '').slice(0, 2).toLowerCase() || 'en';
  }
  return mac;
}

let seen = { at: 0, mtime: null, setting: 'auto' };
/** What the user chose: "tr", "en" or "auto". */
export function languageSetting() {
  if (Date.now() - seen.at < 1000) return seen.setting;
  let mtime = 0;
  try { mtime = fs.statSync(userConfig()).mtimeMs; } catch {}
  if (mtime !== seen.mtime) {
    const value = readJson(userConfig()).language ?? readJson(PROJECT_CONFIG).language;
    seen = { mtime, setting: LANGUAGES.includes(value) ? value : 'auto' };
  }
  seen.at = Date.now();
  return seen.setting;
}

/** The language Handry speaks now: "tr" or "en". */
export function lang() {
  if (LANGUAGES.includes(process.env.JEVIS_LANG)) return process.env.JEVIS_LANG;
  const s = languageSetting();
  if (s !== 'auto') return s;
  return macLanguage() === 'tr' ? 'tr' : 'en';
}

/** The Turkish or the English one, by the language Handry speaks now. */
export const T = (tr, en) => (lang() === 'en' ? en : tr);

/** Saves the choice ("tr", "en" or "auto") in ~/.jevis/config.json, keeping everything else there. */
export function setLanguage(value) {
  if (value !== 'auto' && !LANGUAGES.includes(value)) throw Object.assign(new Error(`language: "tr", "en" or "auto", not "${value}"`), { code: 'BAD_ARGS' });
  const file = userConfig();
  const data = readJson(file);
  data.language = value;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  seen = { at: 0, mtime: null, setting: 'auto' };
  resetConfig();
  return lang();
}
