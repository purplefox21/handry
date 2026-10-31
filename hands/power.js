// Handry · © 2026 Berat Olekli (purplefox) · github.com/purplefox21/handry
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
import { T } from '../core/i18n.js';

export const POWER_ACTIONS = ['lock', 'sleep', 'restart', 'shutdown'];

const ITEMS = {
  lock: ['Ekranı Kilitle', 'Lock Screen'],
  sleep: ['Uyut', 'Sleep'],
  restart: ['Yeniden Başlat…', 'Restart…'],
  shutdown: ['Sistemi Kapat…', 'Shut Down…']
};

// [Turkish, English]
const DONE = {
  lock: ['🔒 Ekran kilitlendi.', '🔒 Screen locked.'],
  sleep: ['😴 Mac uyku moduna geçiyor.', '😴 The Mac is going to sleep.'],
  restart: ['🔄 Mac yeniden başlatılıyor (macOS bir dakika içinde kendisi devam eder; istersen Vazgeç de).', '🔄 Restarting the Mac (macOS goes ahead by itself within a minute; you can still press Cancel).'],
  shutdown: ['⏻ Mac kapatılıyor (macOS bir dakika içinde kendisi devam eder; istersen Vazgeç de).', '⏻ Shutting down the Mac (macOS goes ahead by itself within a minute; you can still press Cancel).']
};

// Getters: POWER_NAMES.lock is read in the language spoken at that moment.
export const POWER_NAMES = {
  get lock() { return T('ekranı kilitle', 'lock the screen'); },
  get sleep() { return T("Mac'i uyut", 'put the Mac to sleep'); },
  get restart() { return T("Mac'i yeniden başlat", 'restart the Mac'); },
  get shutdown() { return T("Mac'i kapat", 'shut down the Mac'); }
};

export async function power(action) {
  if (!ITEMS[action]) throw new Error(T(`Bilinmeyen güç işlemi: ${action}`, `Unknown power action: ${action}`));
  if (process.env.JEVIS_TEST_POWER === 'record') {
    fs.mkdirSync(HOME, { recursive: true });
    fs.appendFileSync(path.join(HOME, 'power-test.log'), `${JSON.stringify({ action, at: Date.now() })}\n`);
    return { success: true, message: `${T(...DONE[action])} ${T('(test: kaydedildi)', '(test: recorded)')}` };
  }
  await desktop.pressAppleMenu(ITEMS[action]);
  return { success: true, message: T(...DONE[action]) };
}
