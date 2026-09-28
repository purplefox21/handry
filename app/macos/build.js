// Builds the JEVIS app into dist/JEVIS.app (with its icon, ad-hoc signed),
// and installs it into ~/Applications. Used by `node cli.js app build|install`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, config } from '../../core/config.js';

export const APP = path.join(ROOT, 'dist', 'JEVIS.app');
export const INSTALLED = path.join(os.homedir(), 'Applications', 'JEVIS.app');
export const BUNDLE_ID = 'com.jevis.menubar';

const plist = values => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${Object.entries(values).map(([k, v]) => `  <key>${k}</key>\n  ${typeof v === 'boolean' ? `<${v}/>` : `<string>${String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</string>`}`).join('\n')}
</dict>
</plist>
`;

const ICON_SIZES = [16, 32, 128, 256, 512];

/**
 * Draws the icon (app/macos/icon.swift) and turns it into JEVIS.icns in
 * every size macOS wants; also leaves a 256 px PNG for the chat page's tab.
 */
export function buildIcon(resources) {
  const work = path.join(ROOT, 'dist', 'icon');
  fs.rmSync(work, { recursive: true, force: true });
  const iconset = path.join(work, 'JEVIS.iconset');
  fs.mkdirSync(iconset, { recursive: true });
  const drawer = path.join(work, 'draw-icon');
  const master = path.join(work, 'JEVIS-1024.png');
  execFileSync('swiftc', ['-O', '-o', drawer, path.join(ROOT, 'app', 'macos', 'icon.swift'), '-framework', 'AppKit'], { stdio: 'pipe' });
  execFileSync(drawer, [master], { stdio: 'pipe' });
  for (const size of ICON_SIZES) {
    for (const scale of [1, 2]) {
      const name = `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`;
      execFileSync('sips', ['-z', String(size * scale), String(size * scale), master, '--out', path.join(iconset, name)], { stdio: 'pipe' });
    }
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(resources, 'JEVIS.icns')], { stdio: 'pipe' });
  fs.copyFileSync(path.join(iconset, 'icon_128x128@2x.png'), path.join(ROOT, 'app', 'public', 'icon.png'));
  return path.join(resources, 'JEVIS.icns');
}

export function buildApp() {
  fs.rmSync(APP, { recursive: true, force: true });
  fs.mkdirSync(path.join(APP, 'Contents', 'MacOS'), { recursive: true });
  fs.mkdirSync(path.join(APP, 'Contents', 'Resources'), { recursive: true });
  buildIcon(path.join(APP, 'Contents', 'Resources'));
  fs.writeFileSync(path.join(APP, 'Contents', 'Info.plist'), plist({
    CFBundleIdentifier: BUNDLE_ID,
    CFBundleName: 'JEVIS',
    CFBundleDisplayName: 'JEVIS',
    CFBundleExecutable: 'JEVIS',
    CFBundlePackageType: 'APPL',
    CFBundleShortVersionString: '1.0',
    CFBundleVersion: '1',
    LSMinimumSystemVersion: '13.0',
    CFBundleIconFile: 'JEVIS',
    NSMicrophoneUsageDescription: 'JEVIS sesli komutlarını dinlemek için mikrofonu kullanır.',
    NSAppleEventsUsageDescription: 'JEVIS, senin isteğinle uygulamaları kontrol etmek için Apple Events kullanır.',
    JEVISRoot: ROOT,
    JEVISNode: process.execPath,
    JEVISPort: String(config().server.port || 3000)
  }));
  execFileSync('swiftc', ['-O', '-o', path.join(APP, 'Contents', 'MacOS', 'JEVIS'), path.join(ROOT, 'app', 'macos', 'JEVIS.swift'),
    '-framework', 'AppKit', '-framework', 'WebKit', '-framework', 'Carbon'], { stdio: 'pipe' });
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
  fs.mkdirSync(path.dirname(INSTALLED), { recursive: true });
  fs.rmSync(INSTALLED, { recursive: true, force: true });
  execFileSync('ditto', [APP, INSTALLED]);
  return INSTALLED;
}
