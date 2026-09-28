// Builds the JEVIS menu bar app into dist/JEVIS.app (ad-hoc signed), and
// installs it into ~/Applications. Used by `node cli.js app build|install`.
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

export function buildApp() {
  fs.rmSync(APP, { recursive: true, force: true });
  fs.mkdirSync(path.join(APP, 'Contents', 'MacOS'), { recursive: true });
  fs.mkdirSync(path.join(APP, 'Contents', 'Resources'), { recursive: true });
  fs.writeFileSync(path.join(APP, 'Contents', 'Info.plist'), plist({
    CFBundleIdentifier: BUNDLE_ID,
    CFBundleName: 'JEVIS',
    CFBundleDisplayName: 'JEVIS',
    CFBundleExecutable: 'JEVIS',
    CFBundlePackageType: 'APPL',
    CFBundleShortVersionString: '1.0',
    CFBundleVersion: '1',
    LSMinimumSystemVersion: '13.0',
    LSUIElement: true,
    NSMicrophoneUsageDescription: 'JEVIS sesli komutlarını dinlemek için mikrofonu kullanır.',
    NSAppleEventsUsageDescription: 'JEVIS, senin isteğinle uygulamaları kontrol etmek için Apple Events kullanır.',
    JEVISRoot: ROOT,
    JEVISNode: process.execPath,
    JEVISPort: String(config().server.port || 3000)
  }));
  execFileSync('swiftc', ['-O', '-o', path.join(APP, 'Contents', 'MacOS', 'JEVIS'), path.join(ROOT, 'app', 'macos', 'JEVIS.swift'),
    '-framework', 'AppKit', '-framework', 'WebKit', '-framework', 'Carbon'], { stdio: 'pipe' });
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', APP], { stdio: 'pipe' });
  return APP;
}

export function installApp() {
  if (!fs.existsSync(APP)) buildApp();
  fs.mkdirSync(path.dirname(INSTALLED), { recursive: true });
  fs.rmSync(INSTALLED, { recursive: true, force: true });
  execFileSync('ditto', [APP, INSTALLED]);
  return INSTALLED;
}
