// Builds the Foxie app (JEVIS's menu bar app, the bar, the window and the fox
// on screen) into dist/Foxie.app with its icons and the fox's sprites, signs
// it, and installs it into ~/Applications. Used by `node cli.js app build|install`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, config } from '../../core/config.js';

export const APP = path.join(ROOT, 'dist', 'Foxie.app');
export const INSTALLED = path.join(os.homedir(), 'Applications', 'Foxie.app');
/** The app before it became Foxie (2026-10-01); removed when Foxie is installed. */
export const OLD_INSTALLED = path.join(os.homedir(), 'Applications', 'JEVIS.app');
export const BUNDLE_ID = 'studio.purpfox.foxie';

const plist = values => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${Object.entries(values).map(([k, v]) => `  <key>${k}</key>\n  ${typeof v === 'boolean' ? `<${v}/>` : `<string>${String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</string>`}`).join('\n')}
</dict>
</plist>
`;

const ICON_SIZES = [16, 32, 128, 256, 512];

const SPRITES = path.join(ROOT, 'app', 'foxie', 'sprites');

/**
 * Draws the icons from the fox sprite (app/macos/icon.swift): Foxie.icns in
 * every size macOS wants, the menu bar glyph (menubar.png, a template image),
 * and a 256 px PNG for the chat page's tab and header.
 */
export function buildIcon(resources) {
  const work = path.join(ROOT, 'dist', 'icon');
  fs.rmSync(work, { recursive: true, force: true });
  const iconset = path.join(work, 'Foxie.iconset');
  fs.mkdirSync(iconset, { recursive: true });
  const drawer = path.join(work, 'draw-icon');
  const master = path.join(work, 'Foxie-1024.png');
  execFileSync('swiftc', ['-O', '-o', drawer, path.join(ROOT, 'app', 'macos', 'icon.swift'), '-framework', 'AppKit'], { stdio: 'pipe' });
  execFileSync(drawer, [path.join(SPRITES, 'idle', '0001.png'), master, path.join(resources, 'menubar.png')], { stdio: 'pipe' });
  for (const size of ICON_SIZES) {
    for (const scale of [1, 2]) {
      const name = `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`;
      execFileSync('sips', ['-z', String(size * scale), String(size * scale), master, '--out', path.join(iconset, name)], { stdio: 'pipe' });
    }
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(resources, 'Foxie.icns')], { stdio: 'pipe' });
  fs.copyFileSync(path.join(iconset, 'icon_128x128@2x.png'), path.join(ROOT, 'app', 'public', 'icon.png'));
  return path.join(resources, 'Foxie.icns');
}

export function buildApp() {
  fs.rmSync(APP, { recursive: true, force: true });
  fs.mkdirSync(path.join(APP, 'Contents', 'MacOS'), { recursive: true });
  fs.mkdirSync(path.join(APP, 'Contents', 'Resources'), { recursive: true });
  buildIcon(path.join(APP, 'Contents', 'Resources'));
  fs.cpSync(SPRITES, path.join(APP, 'Contents', 'Resources', 'sprites'), { recursive: true });
  fs.writeFileSync(path.join(APP, 'Contents', 'Info.plist'), plist({
    CFBundleIdentifier: BUNDLE_ID,
    CFBundleName: 'Foxie',
    CFBundleDisplayName: 'Foxie',
    CFBundleExecutable: 'Foxie',
    CFBundlePackageType: 'APPL',
    CFBundleShortVersionString: '1.0',
    CFBundleVersion: '1',
    LSMinimumSystemVersion: '13.0',
    CFBundleIconFile: 'Foxie',
    NSMicrophoneUsageDescription: 'Foxie sesli komutlarını dinlemek için mikrofonu kullanır.',
    NSSpeechRecognitionUsageDescription: 'Foxie konuştukça söylediklerini yazmak ve "Hey Foxie"yi duymak için bu Mac\'te konuşma tanıma kullanır.',
    NSAppleEventsUsageDescription: 'Foxie, senin isteğinle uygulamaları (Spotify, Müzik, Notlar, Anımsatıcılar, Takvim, Mesajlar, sistem ayarları) kontrol etmek için Apple Events kullanır.',
    JEVISRoot: ROOT,
    JEVISNode: process.execPath,
    JEVISPort: String(config().server.port || 3000)
  }));
  execFileSync('swiftc', ['-O', '-o', path.join(APP, 'Contents', 'MacOS', 'Foxie'),
    ...['JEVIS.swift', 'Listener.swift', 'Fox.swift', 'Permissions.swift'].map(f => path.join(ROOT, 'app', 'macos', f)),
    '-framework', 'AppKit', '-framework', 'WebKit', '-framework', 'Carbon', '-framework', 'AVFoundation', '-framework', 'Speech', '-framework', 'CoreAudio'], { stdio: 'pipe' });
  execFileSync('codesign', ['--force', '--deep', '--sign', signingIdentity(), APP], { stdio: 'pipe' });
  return APP;
}

/**
 * A real signing identity (the Apple Development certificate Xcode installs)
 * keeps the app's identity the same from build to build, so macOS remembers
 * its permissions. Without one the app is signed ad hoc and every build has to
 * be allowed again. jevis.config.json › app.signIdentity picks one by name.
 */
export function signingIdentity() {
  const wanted = config().app?.signIdentity;
  if (wanted) return wanted;
  try {
    const out = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    const id = out.match(/"(Apple Development: [^"]+)"/)?.[1];
    if (id) return id;
  } catch {}
  return '-';
}

export function installApp() {
  if (!fs.existsSync(APP)) buildApp();
  // The app before it was Foxie goes to the Trash (it can be taken back from there).
  if (fs.existsSync(OLD_INSTALLED)) fs.renameSync(OLD_INSTALLED, path.join(os.homedir(), '.Trash', `JEVIS-${Date.now()}.app`));
  fs.mkdirSync(path.dirname(INSTALLED), { recursive: true });
  fs.rmSync(INSTALLED, { recursive: true, force: true });
  execFileSync('ditto', [APP, INSTALLED]);
  return INSTALLED;
}
