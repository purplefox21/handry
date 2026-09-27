// Speech to text with whisper.cpp, on this Mac (no audio leaves it).
import fs from 'node:fs';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config, expandHome } from '../core/config.js';
import { findBinary } from '../brain/common.js';

const execFileAsync = promisify(execFile);

// Names whisper would otherwise hear as Turkish words ("jev" → "REV").
const VOCABULARY = 'JEVIS, Jev, jev projesi, VS Code, Claude, Claude Code, Chrome, Safari, Spotify, Xcode, App Store Connect, TestFlight, TypeSafe, GitHub';

// What whisper tends to "hear" in silence or noise.
const HALLUCINATIONS = [/^(www\.|https?:)/i, /altyaz/i, /abone ol/i, /izlediğiniz için teşekkür/i, /^\[.*\]$/, /^\(.*\)$/, /^[.\s…-]*$/];

const FIXES = [[/\bvs\.?\s?code\b/gi, 'VS Code'], [/\bjevis\b/gi, 'JEVIS']];

export function sttStatus() {
  const bin = findBinary('whisper-cli');
  const model = expandHome(config().voice.model);
  const hasModel = fs.existsSync(model);
  let reason = '';
  if (!bin) reason = 'whisper-cli yok (brew install whisper-cpp)';
  else if (!hasModel) reason = `konuşma modeli yok: ${model}`;
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
    '-m', status.model, '-f', wavPath, '-l', config().voice.language,
    '-nt', '-np', '-t', String(Math.min(8, os.cpus().length)), '--prompt', VOCABULARY
  ], { timeout: 120000, maxBuffer: 10 * 1024 * 1024 });
  let text = stdout.replace(/\s+/g, ' ').trim();
  if (HALLUCINATIONS.some(re => re.test(text))) return '';
  for (const [re, fix] of FIXES) text = text.replace(re, fix);
  return text.replace(/\.$/, '');
}
