// Spoken replies with macOS `say`, in a Turkish (voice.ttsVoice) or English
// (voice.ttsVoiceEn) voice by Handry's language. Only a short summary is read
// aloud; the full answer stays on screen.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config, HOME } from '../core/config.js';
import { T } from '../core/i18n.js';

let speaking = null;

// While Handry talks this file exists, so the "Hey Handry" listener in Handry.app
// doesn't wake up to Handry's own voice.
export const SPEAKING_FLAG = path.join(HOME, 'speaking');
const flag = on => {
  try {
    if (on) { fs.mkdirSync(HOME, { recursive: true }); fs.writeFileSync(SPEAKING_FLAG, String(Date.now())); } else fs.rmSync(SPEAKING_FLAG, { force: true });
  } catch {}
};

/** The voice for Handry's language now ("Yelda" / "Samantha" by default). */
export function ttsVoice() {
  const v = config().voice;
  return T(v.ttsVoice, v.ttsVoiceEn || 'Samantha');
}

export function ttsStatus() {
  return fs.existsSync('/usr/bin/say') ? { ok: true, voice: ttsVoice() } : { ok: false, reason: T('`say` bulunamadı', '`say` was not found') };
}

/** Markdown, links and code stripped; the first sentences up to maxSpokenChars. */
export function speakable(text) {
  const max = config().voice.maxSpokenChars;
  const plain = String(text)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_#>|~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length <= max) return plain;
  const sentences = plain.match(/[^.!?]+[.!?]+/g) || [plain];
  let out = '';
  for (const s of sentences) {
    if ((out + s).length > max) break;
    out += s;
  }
  return (out || plain.slice(0, max)).trim();
}

export function stopSpeaking() {
  speaking?.kill();
  speaking = null;
  flag(false);
}

/** Speaks (or with toFile writes an AIFF). Resolves when done. */
export function speak(text, { toFile } = {}) {
  stopSpeaking();
  const line = speakable(text);
  if (!line) return Promise.resolve();
  const child = spawn('/usr/bin/say', ['-v', ttsVoice(), ...(toFile ? ['-o', toFile] : []), line], { stdio: 'ignore' });
  speaking = child;
  if (!toFile) flag(true);
  return new Promise(resolve => child.on('close', () => {
    if (speaking === child) { speaking = null; flag(false); }
    resolve();
  }));
}
