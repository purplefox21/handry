// Locking, sleeping, restarting or shutting down the Mac through the Apple
// menu, the way the user would click it (Accessibility is enough, no other
// permission). "Sistemi Kapat…" and "Yeniden Başlat…" bring up macOS's own
// question, which goes ahead by itself after a minute and can be cancelled;
// every app is asked to quit first, so unsaved work can still stop it.
// JEVIS_TEST_POWER=record writes the action down instead (tests).
import fs from 'node:fs';
import path from 'node:path';
import { HOME } from '../core/config.js';
import * as desktop from './desktop.js';

export const POWER_ACTIONS = ['lock', 'sleep', 'restart', 'shutdown'];

const ITEMS = {
  lock: ['Ekranı Kilitle', 'Lock Screen'],
  sleep: ['Uyut', 'Sleep'],
  restart: ['Yeniden Başlat…', 'Restart…'],
  shutdown: ['Sistemi Kapat…', 'Shut Down…']
};

const DONE = {
  lock: '🔒 Ekran kilitlendi.',
  sleep: '😴 Mac uyku moduna geçiyor.',
  restart: '🔄 Mac yeniden başlatılıyor (macOS bir dakika içinde kendisi devam eder; istersen Vazgeç de).',
  shutdown: '⏻ Mac kapatılıyor (macOS bir dakika içinde kendisi devam eder; istersen Vazgeç de).'
};

export const POWER_NAMES = { lock: 'ekranı kilitle', sleep: "Mac'i uyut", restart: "Mac'i yeniden başlat", shutdown: "Mac'i kapat" };

export async function power(action) {
  if (!ITEMS[action]) throw new Error(`Bilinmeyen güç işlemi: ${action}`);
  if (process.env.JEVIS_TEST_POWER === 'record') {
    fs.mkdirSync(HOME, { recursive: true });
    fs.appendFileSync(path.join(HOME, 'power-test.log'), `${JSON.stringify({ action, at: Date.now() })}\n`);
    return { success: true, message: `${DONE[action]} (test: kaydedildi)` };
  }
  await desktop.pressAppleMenu(ITEMS[action]);
  return { success: true, message: DONE[action] };
}
