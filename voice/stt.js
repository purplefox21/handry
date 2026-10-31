// Handry · © 2026 Berat Olekli (purplefox) · github.com/purplefox21/handry
// Speech to text with whisper.cpp, on this Mac (no audio leaves it).
import fs from 'node:fs';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config, expandHome } from '../core/config.js';
import { findBinary } from '../brain/common.js';
import { WAKE_SOURCE } from '../core/brand.js';
import { T, lang } from '../core/i18n.js';

const execFileAsync = promisify(execFile);

// Names whisper would otherwise hear as Turkish (or English) words ("jev" → "REV").
const vocabulary = () => `Handry, Foxie, Hey Foxie, Hey Handry, ${T('jev projesi', 'the jev project')}, VS Code, Claude, Claude Code, Chrome, Safari, Spotify, Xcode, App Store Connect, TestFlight, TypeSafe, GitHub`;

// What whisper tends to "hear" in silence or noise.
const HALLUCINATIONS = [/^(www\.|https?:)/i, /altyaz/i, /abone ol/i, /izlediğiniz için teşekkür/i, /^\[.*\]$/, /^\(.*\)$/, /^[.\s…-]*$/,
  /^thanks? (you )?(so much )?for watching/i, /^(please )?(like and )?subscribe[.!]*$/i, /^subtitles by/i];

const FIXES = [[/\bvs\.?\s?code\b/gi, 'VS Code'], [/\bhandry\b/gi, 'Handry'], [/\bfoxie\b/gi, 'Foxie']];

// "Hey Foxie" (and how it gets misheard) at the start of a phrase; the same
// pattern runs in Listener.swift (core/brand.js keeps the words).
const WAKE = new RegExp(WAKE_SOURCE, 'iu');
export const stripWake = text => String(text).replace(WAKE, '').trim();

/** The language whisper listens for: voice.language, where "auto" (the default) follows Handry's language. */
export function sttLanguage() {
  const set = config().voice.language;
  return !set || set === 'auto' ? lang() : set;
}

export function sttStatus() {
  const bin = findBinary('whisper-cli');
  const model = expandHome(config().voice.model);
  const hasModel = fs.existsSync(model);
  let reason = '';
  if (!bin) reason = T('whisper-cli yok (brew install whisper-cpp)', 'whisper-cli is missing (brew install whisper-cpp)');
  else if (!hasModel) reason = T(`konuşma modeli yok: ${model}`, `no speech model: ${model}`);
  return { ok: Boolean(bin && hasModel), bin, model, reason };
}

/** Root-mean-square level of a 16-bit PCM WAV: near-silence isn't worth transcribing. */
export function loudness(wavPath) {
  const buf = fs.readFileSync(wavPath);
  const dataAt = buf.indexOf('data');
  const start = dataAt >= 0 ? dataAt + 8 : 44;
  let sum = 0;
  let n = 0;
  for (let i = start; i + 1 < buf.length; i += 2) {
    const v = buf.readInt16LE(i);
    sum += v * v;
    n++;
  }
  return n ? Math.sqrt(sum / n) : 0;
}

export async function transcribe(wavPath) {
  const status = sttStatus();
  if (!status.ok) throw new Error(status.reason);
  if (loudness(wavPath) < 150) return '';
  const { stdout } = await execFileAsync(status.bin, [
    '-m', status.model, '-f', wavPath, '-l', sttLanguage(),
    '-nt', '-np', '-t', String(Math.min(8, os.cpus().length)), '--prompt', vocabulary()
  ], { timeout: 120000, maxBuffer: 10 * 1024 * 1024 });
  let text = stdout.replace(/\s+/g, ' ').trim();
  if (HALLUCINATIONS.some(re => re.test(text))) return '';
  for (const [re, fix] of FIXES) text = text.replace(re, fix);
  return text.replace(/\.$/, '');
}
