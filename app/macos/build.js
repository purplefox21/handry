// Builds the app (JEVIS's menu bar app: the bar, the window and the pet on
// screen) into dist/<name>.app with its icons and both pets' sprites (the hand,
// drawn by app/hand/make.mjs, and the fox), signs it, and installs it into
// ~/Applications. The name comes from core/brand.js; the
// bundle id stays the same across renames, so macOS keeps its permissions.
// Used by `node cli.js app build|install`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, config } from '../../core/config.js';
import { APP, FOX, WAKE_LABEL, WAKE_SOURCE } from '../../core/brand.js';

export const APP_PATH = path.join(ROOT, 'dist', `${APP.name}.app`);
export const INSTALLED = path.join(os.homedir(), 'Applications', `${APP.name}.app`);
/** The app under its earlier names; moved to the Trash when this one is installed. */
export const OLD_INSTALLED = ['JEVIS.app', 'Foxie.app', 'Inaro.app'].filter(n => n !== `${APP.name}.app`).map(n => path.join(os.homedir(), 'Applications', n));
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

const HAND = path.join(ROOT, 'app', 'hand');
const PETS = { hand: path.join(HAND, 'sprites'), fox: path.join(ROOT, 'app', 'foxie', 'sprites') };

/** The hand's sprites and icon art are drawn, not kept in git: drawn again when make.mjs is newer than them. */
export function drawHand() {
  const made = path.join(HAND, 'sprites', 'manifest.json');
  const stale = !fs.existsSync(made) || !fs.existsSync(path.join(HAND, 'icon', 'art.png')) || fs.statSync(path.join(HAND, 'make.mjs')).mtimeMs > fs.statSync(made).mtimeMs;
  if (stale) execFileSync(process.execPath, [path.join(HAND, 'make.mjs')], { stdio: 'pipe' });
}

/**
 * Draws the icons from the hand's icon art (app/macos/icon.swift): App.icns in
 * every size macOS wants, the menu bar glyph (menubar.png, a template image,
 * drawn by make.mjs), and a 256 px PNG for the chat page's tab and header.
 */
export function buildIcon(resources) {
  drawHand();
  const work = path.join(ROOT, 'dist', 'icon');
  fs.rmSync(work, { recursive: true, force: true });
  const iconset = path.join(work, 'App.iconset');
  fs.mkdirSync(iconset, { recursive: true });
  const drawer = path.join(work, 'draw-icon');
  const master = path.join(work, 'App-1024.png');
  execFileSync('swiftc', ['-O', '-o', drawer, path.join(ROOT, 'app', 'macos', 'icon.swift'), '-framework', 'AppKit'], { stdio: 'pipe' });
  execFileSync(drawer, [path.join(HAND, 'icon', 'art.png'), master], { stdio: 'pipe' });
  fs.copyFileSync(path.join(HAND, 'icon', 'menubar.png'), path.join(resources, 'menubar.png'));
  for (const size of ICON_SIZES) {
    for (const scale of [1, 2]) {
      const name = `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`;
      execFileSync('sips', ['-z', String(size * scale), String(size * scale), master, '--out', path.join(iconset, name)], { stdio: 'pipe' });
    }
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(resources, 'App.icns')], { stdio: 'pipe' });
  fs.copyFileSync(path.join(iconset, 'icon_128x128@2x.png'), path.join(ROOT, 'app', 'public', 'icon.png'));
  return path.join(resources, 'App.icns');
}

/**
 * The node the app starts its server with. process.execPath is the versioned Homebrew folder
 * (…/Cellar/node/26.4.0/bin/node), which is deleted by the next `brew upgrade` and the server
 * then never starts. /opt/homebrew/bin/node (or /usr/local/bin/node) is a link that survives
 * upgrades; it is used when it leads to the node that is running this build.
 */
export function stableNodePath() {
  const real = p => { try { return fs.realpathSync(p); } catch { return null; } };
  const mine = real(process.execPath);
  return ['/opt/homebrew/bin/node', '/usr/local/bin/node'].find(p => mine && real(p) === mine) || process.execPath;
}

export function buildApp() {
  fs.rmSync(APP_PATH, { recursive: true, force: true });
  fs.mkdirSync(path.join(APP_PATH, 'Contents', 'MacOS'), { recursive: true });
  fs.mkdirSync(path.join(APP_PATH, 'Contents', 'Resources'), { recursive: true });
  buildIcon(path.join(APP_PATH, 'Contents', 'Resources'));
  for (const [id, dir] of Object.entries(PETS)) fs.cpSync(dir, path.join(APP_PATH, 'Contents', 'Resources', 'pets', id), { recursive: true });
  fs.writeFileSync(path.join(APP_PATH, 'Contents', 'Info.plist'), plist({
    CFBundleIdentifier: BUNDLE_ID,
    CFBundleName: APP.name,
    CFBundleDisplayName: APP.name,
    CFBundleExecutable: APP.name,
    CFBundlePackageType: 'APPL',
    CFBundleShortVersionString: '1.0',
    CFBundleVersion: '1',
    LSMinimumSystemVersion: '13.0',
    CFBundleIconFile: 'App',
    NSMicrophoneUsageDescription: `${APP.name} sesli komutlarını dinlemek için mikrofonu kullanır.`,
    NSSpeechRecognitionUsageDescription: `${APP.name} konuştukça söylediklerini yazmak ve "${WAKE_LABEL}" demeni duymak için bu Mac'te konuşma tanıma kullanır.`,
    NSAppleEventsUsageDescription: `${APP.name}, senin isteğinle uygulamaları (Spotify, Müzik, Notlar, Anımsatıcılar, Takvim, Mesajlar, sistem ayarları) kontrol etmek için Apple Events kullanır.`,
    // The name's Turkish endings, the fox's name and the wake word, for the Swift side.
    AppDative: APP.dative,
    AppAccusative: APP.accusative,
    AppAblative: APP.ablative,
    AppGenitive: APP.genitive,
    FoxName: FOX.name,
    WakeLabel: WAKE_LABEL,
    WakePattern: WAKE_SOURCE,
    JEVISRoot: ROOT,
    JEVISNode: stableNodePath(),
    JEVISPort: String(config().server.port || 4263)
  }));
  execFileSync('swiftc', ['-O', '-o', path.join(APP_PATH, 'Contents', 'MacOS', APP.name),
    ...['JEVIS.swift', 'Listener.swift', 'Fox.swift', 'Permissions.swift'].map(f => path.join(ROOT, 'app', 'macos', f)),
    '-framework', 'AppKit', '-framework', 'WebKit', '-framework', 'Carbon', '-framework', 'AVFoundation', '-framework', 'Speech', '-framework', 'CoreAudio'], { stdio: 'pipe' });
  execFileSync('codesign', ['--force', '--deep', '--sign', signingIdentity(), APP_PATH], { stdio: 'pipe' });
  return APP_PATH;
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
  if (!fs.existsSync(APP_PATH)) buildApp();
  // The app under an earlier name goes to the Trash (it can be taken back from there).
  for (const old of OLD_INSTALLED.filter(p => fs.existsSync(p))) fs.renameSync(old, path.join(os.homedir(), '.Trash', `${path.basename(old, '.app')}-${Date.now()}.app`));
  fs.mkdirSync(path.dirname(INSTALLED), { recursive: true });
  fs.rmSync(INSTALLED, { recursive: true, force: true });
  execFileSync('ditto', [APP_PATH, INSTALLED]);
  return INSTALLED;
}
