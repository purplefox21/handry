import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const HOME = process.env.JEVIS_HOME || path.join(os.homedir(), '.jevis');

export function expandHome(p) {
  return typeof p === 'string' && p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
}

/** Creates (if needed) and returns a folder inside ~/.jevis */
export function homeDir(...parts) {
  const dir = path.join(HOME, ...parts);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return {};
  }
}

function merge(base, extra) {
  const out = { ...base };
  for (const [k, v] of Object.entries(extra || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && typeof base?.[k] === 'object'
      ? merge(base[k], v)
      : v;
  }
  return out;
}

let cached;

// The project defaults file; checkouts from before the rename have jevis.config.json.
export const PROJECT_CONFIG = ['handry.config.json', 'jevis.config.json'].map(f => path.join(ROOT, f)).find(f => fs.existsSync(f)) || path.join(ROOT, 'handry.config.json');

/** Project defaults (handry.config.json) overridden by ~/.jevis/config.json */
export function config() {
  if (!cached) {
    cached = merge(readJson(PROJECT_CONFIG), readJson(path.join(HOME, 'config.json')));
  }
  return cached;
}

/** Forgets the merged config, so the next config() reads the files again (after a setting was saved). */
export function resetConfig() {
  cached = undefined;
}

/** Small persistent key/value state shared by CLI runs (e.g. the current tab) */
export function loadState() {
  return readJson(path.join(HOME, 'state.json'));
}

export function saveState(patch) {
  const next = { ...loadState(), ...patch };
  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(path.join(HOME, 'state.json'), JSON.stringify(next, null, 2));
  return next;
}
