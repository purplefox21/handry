// Handry · © 2026 Berat Olekli (purplefox) · github.com/purplefox21/handry
// Notes about websites, left by Claude for next time ("the TTL menu on
// GoDaddy only opens after the record row is clicked"). They live in
// ~/.jevis/sites/<domain>.json and come back whenever Handry reads a page of
// that site, so the second visit doesn't repeat the first one's trial and error.
import fs from 'node:fs';
import path from 'node:path';
import { homeDir } from './config.js';
import { T } from './i18n.js';

const MAX_NOTES = 20;
const MAX_CHARS = 400;

/** "dcc.godaddy.com" → "godaddy.com" (notes cover the whole site). */
export function siteOf(urlOrHost) {
  let host = String(urlOrHost || '').trim();
  try { host = new URL(/^[a-z]+:\/\//i.test(host) ? host : `https://${host}`).hostname; } catch { return ''; }
  if (/^\d+(\.\d+){3}$/.test(host) || !host.includes('.')) return host; // 127.0.0.1, localhost
  const parts = host.replace(/^www\./, '').split('.');
  const twoPart = parts.length > 2 && ['co', 'com', 'org', 'net', 'gov', 'ac'].includes(parts.at(-2));
  return parts.slice(twoPart ? -3 : -2).join('.');
}

const fileOf = site => path.join(homeDir('sites'), `${site.replace(/[^\w.-]/g, '_')}.json`);

export function notesFor(urlOrHost) {
  const site = siteOf(urlOrHost);
  if (!site) return [];
  try { return JSON.parse(fs.readFileSync(fileOf(site), 'utf-8')); } catch { return []; }
}

export function addNote(urlOrHost, note) {
  const site = siteOf(urlOrHost);
  if (!site) throw new Error(T('Hangi site için olduğu anlaşılmadı.', 'Could not tell which site this is for.'));
  const text = String(note).replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS);
  if (!text) throw new Error(T('Not boş.', 'The note is empty.'));
  const notes = notesFor(site).filter(n => n.note !== text);
  notes.push({ at: new Date().toISOString().slice(0, 10), note: text });
  fs.writeFileSync(fileOf(site), JSON.stringify(notes.slice(-MAX_NOTES), null, 2));
  return { site, count: Math.min(notes.length, MAX_NOTES) };
}

export function removeNote(urlOrHost, number) {
  const site = siteOf(urlOrHost);
  const notes = notesFor(site);
  const [gone] = notes.splice(Number(number) - 1, 1);
  fs.writeFileSync(fileOf(site), JSON.stringify(notes, null, 2));
  return { site, removed: gone?.note || null };
}

/** The notes as a block for a page read, or '' when there are none. */
export function notesBlock(urlOrHost) {
  const notes = notesFor(urlOrHost);
  if (!notes.length) return '';
  return [T(`📝 ${siteOf(urlOrHost)} için önceki oturumlardan notlar:`, `📝 Notes on ${siteOf(urlOrHost)} from earlier sessions:`), ...notes.slice(-8).map((n, i) => `${i + 1}. ${n.note} (${n.at})`)].join('\n');
}
