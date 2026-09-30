// Emergency stop: a flag file every tool checks before acting. It expires on
// its own so a forgotten stop doesn't block tomorrow's work.
import fs from 'node:fs';
import path from 'node:path';
import { HOME } from '../core/config.js';

const STOP_FILE = path.join(HOME, 'STOP');
const EXPIRES_MS = 10 * 60 * 1000;

export function requestStop(reason = 'kullanıcı') {
  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(STOP_FILE, JSON.stringify({ at: Date.now(), reason }));
}

export function clearStop() {
  fs.rmSync(STOP_FILE, { force: true });
}

export function isStopped() {
  try {
    const { at } = JSON.parse(fs.readFileSync(STOP_FILE, 'utf-8'));
    if (Date.now() - at < EXPIRES_MS) return true;
    clearStop();
  } catch {}
  return false;
}

/** Was the emergency stop pressed at or after `since` (ms)? For countdowns that must not see an older stop. */
export function stopRequestedSince(since) {
  try {
    const { at } = JSON.parse(fs.readFileSync(STOP_FILE, 'utf-8'));
    return at >= since;
  } catch {
    return false;
  }
}
