// Handry · © 2026 Berat Olekli (purplefox) · github.com/purplefox21/handry
// The app people download: Handry.app with everything it needs inside it (its own Node, the server's files,
// the Swift helpers, for Apple silicon and Intel), in a disk image to drag to Applications. Nothing else has to
// be installed: no Xcode tools, no Homebrew, no terminal. Used by `node cli.js app package`.
//
// Signed with a "Developer ID Application" certificate and notarized by Apple when both are set up
// (xcrun notarytool store-credentials handry-notary); only then does macOS open it without a warning on other
// Macs. Without them it is signed with what this Mac has, which is fine for trying it out.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { ROOT } from '../../core/config.js';
import { APP } from '../../core/brand.js';
import { buildApp, APP_PATH, APP_SOURCES, APP_FRAMEWORKS, HELPERS, BUNDLE_ID, usageStrings } from './build.js';

/** The Node the app brings. Handry is developed on this major version. */
const NODE_VERSION = 'v26.13.0';
/** What that Node needs. */
const MIN_MACOS = '13.5';
const ARCHS = [['arm64', 'arm64'], ['x86_64', 'x64']]; // swift's name, Node's name
const NOTARY_PROFILE = 'handry-notary';

const WORK = path.join(ROOT, 'dist', 'package');
const CACHE = path.join(ROOT, 'dist', 'node-cache');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8')).version;
export const DMG = path.join(ROOT, 'dist', `${APP.name}-${VERSION}.dmg`);

/** What the server needs at run time. The Swift sources, tests and notes stay out. */
const SERVER_FILES = ['core', 'hands', 'guard', 'brain', 'mcp', 'voice', 'recipes', 'appstore', 'docs', 'app/server.js', 'app/public', 'app/macos/build.js', 'app/macos/autostart.js', 'cli.js', 'package.json', 'handry.config.json', 'LICENSE.md', 'NOTICE', 'README.md', 'node_modules'];
const LEFT_OUT = /(^|\/)(\.DS_Store|ax-helper|dialog|\.bin|.*\.map|.*\.d\.ts|.*\.d\.mts|.*\.d\.cts)$/;

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'pipe', ...opts });
const say = (m) => console.log(m);

function downloadNode(nodeArch) {
  const name = `node-${NODE_VERSION}-darwin-${nodeArch}`;
  const bin = path.join(CACHE, name, 'bin', 'node');
  if (fs.existsSync(bin)) return bin;
  fs.mkdirSync(CACHE, { recursive: true });
  const tar = path.join(CACHE, `${name}.tar.gz`);
  say(`  Node ${NODE_VERSION} (${nodeArch}) indiriliyor…`);
  run('curl', ['-fsSL', '-o', tar, `https://nodejs.org/dist/${NODE_VERSION}/${name}.tar.gz`], { timeout: 600000 });
  const sums = run('curl', ['-fsSL', `https://nodejs.org/dist/${NODE_VERSION}/SHASUMS256.txt`], { timeout: 60000 }).toString();
  const expected = sums.split('\n').find(l => l.endsWith(`  ${name}.tar.gz`))?.split(/\s+/)[0];
  const actual = crypto.createHash('sha256').update(fs.readFileSync(tar)).digest('hex');
  if (!expected || expected !== actual) throw new Error(`${name}: checksum does not match nodejs.org's list`);
  run('tar', ['-xzf', tar, '-C', CACHE, `${name}/bin/node`]);
  fs.rmSync(tar, { force: true });
  return bin;
}

/** Compiles a Swift program for both kinds of Mac into one file. */
function universal(out, sources, extra = []) {
  const parts = ARCHS.map(([arch]) => {
    const part = path.join(WORK, 'obj', `${path.basename(out)}-${arch}`);
    fs.mkdirSync(path.dirname(part), { recursive: true });
    run('swiftc', ['-O', '-target', `${arch}-apple-macos13.0`, '-o', part, ...sources, ...extra], { maxBuffer: 64 * 1024 * 1024 });
    return part;
  });
  run('lipo', ['-create', ...parts, '-output', out]);
}

const isMachO = file => {
  const fd = fs.openSync(file, 'r');
  const head = Buffer.alloc(4);
  fs.readSync(fd, head, 0, 4, 0);
  fs.closeSync(fd);
  return ['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe', 'bebafeca'].includes(head.toString('hex'));
};

function* filesIn(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* filesIn(p);
    else if (e.isFile()) yield p;
  }
}

/** Developer ID first (other Macs accept it once notarized), then what is on this Mac; '-' when there is nothing. */
function pickIdentity() {
  let list = '';
  try { list = run('security', ['find-identity', '-v', '-p', 'codesigning']).toString(); } catch {}
  return list.match(/"(Developer ID Application: [^"]+)"/)?.[1] || list.match(/"(Apple Development: [^"]+)"/)?.[1] || '-';
}

const plist = values => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>${values.map(k => `<key>${k}</key><true/>`).join('')}</dict></plist>
`;

function sign(target, identity, entitlementValues, identifier) {
  const args = ['--force', '--sign', identity];
  if (identity !== '-') args.push('--options', 'runtime', identity.startsWith('Developer ID') ? '--timestamp' : '--timestamp=none');
  if (identifier) args.push('--identifier', identifier);
  if (entitlementValues?.length) {
    const file = path.join(WORK, `entitlements-${crypto.randomBytes(4).toString('hex')}.plist`);
    fs.writeFileSync(file, plist(entitlementValues));
    args.push('--entitlements', file);
  }
  run('codesign', [...args, target]);
}

const APP_RIGHTS = ['com.apple.security.automation.apple-events', 'com.apple.security.device.audio-input'];
const NODE_RIGHTS = ['com.apple.security.cs.allow-jit', 'com.apple.security.cs.allow-unsigned-executable-memory'];

function buildBundle(identity) {
  fs.rmSync(WORK, { recursive: true, force: true });
  fs.mkdirSync(WORK, { recursive: true });
  // The icons, the pets and the Info.plist come from the normal build, in English; Turkish beside it.
  const langBefore = process.env.JEVIS_LANG;
  process.env.JEVIS_LANG = 'en';
  buildApp();
  const english = usageStrings();
  process.env.JEVIS_LANG = 'tr';
  const turkish = usageStrings();
  if (langBefore === undefined) delete process.env.JEVIS_LANG; else process.env.JEVIS_LANG = langBefore;

  const app = path.join(WORK, `${APP.name}.app`);
  run('ditto', [APP_PATH, app]);
  const contents = path.join(app, 'Contents');
  const resources = path.join(contents, 'Resources');
  const infoPlist = path.join(contents, 'Info.plist');
  for (const key of ['JEVISRoot', 'JEVISNode']) run('plutil', ['-remove', key, infoPlist]); // paths of this Mac
  for (const [key, value] of [['CFBundleShortVersionString', VERSION], ['CFBundleVersion', VERSION], ['LSMinimumSystemVersion', MIN_MACOS], ['CFBundleDevelopmentRegion', 'en']]) {
    run('plutil', ['-replace', key, '-string', value, infoPlist]);
  }
  for (const [lang, strings] of [['en', english], ['tr', turkish]]) {
    const dir = path.join(resources, `${lang}.lproj`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'InfoPlist.strings'), Object.entries(strings).map(([k, v]) => `"${k}" = "${v.replace(/"/g, '\\"')}";`).join('\n') + '\n');
  }

  say('  Uygulama iki işlemci için derleniyor…');
  universal(path.join(contents, 'MacOS', APP.name), APP_SOURCES, APP_FRAMEWORKS);

  say('  Sunucu dosyaları kopyalanıyor…');
  const server = path.join(resources, 'handry');
  for (const item of SERVER_FILES) {
    const from = path.join(ROOT, item);
    if (!fs.existsSync(from)) continue;
    const to = path.join(server, item);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.cpSync(from, to, { recursive: true, filter: f => !LEFT_OUT.test(f) });
  }

  say('  Yardımcılar derleniyor…');
  const bin = path.join(server, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  for (const [name, source] of HELPERS) universal(path.join(bin, name), [path.join(ROOT, source)]);

  const helpers = path.join(contents, 'Helpers');
  fs.mkdirSync(helpers, { recursive: true });
  const node = path.join(helpers, 'node');
  run('lipo', ['-create', ...ARCHS.map(([, a]) => downloadNode(a)), '-output', node]);

  say(`  İmzalanıyor (${identity === '-' ? 'geçici imza' : identity})…`);
  sign(node, identity, NODE_RIGHTS, `${BUNDLE_ID}.node`);
  sign(path.join(bin, 'jevis-ax'), identity, APP_RIGHTS, `${BUNDLE_ID}.ax`);
  sign(path.join(bin, 'handry-dialog'), identity, [], `${BUNDLE_ID}.dialog`);
  // Anything else that is a program (a package could bring one) has to be signed too, or Apple refuses the whole app.
  const done = new Set([node, path.join(bin, 'jevis-ax'), path.join(bin, 'handry-dialog'), path.join(contents, 'MacOS', APP.name)]);
  for (const file of filesIn(contents)) if (!done.has(file) && isMachO(file)) sign(file, identity);
  sign(app, identity, APP_RIGHTS);
  return app;
}

/** The arrow picture and the icons' places come from dmgbuild, which needs no Finder. Without it: a plain image, the same two icons. */
function makeImage(app) {
  fs.rmSync(DMG, { force: true });
  const venv = path.join(ROOT, 'dist', 'dmg-venv');
  const dmgbuild = path.join(venv, 'bin', 'dmgbuild');
  try {
    if (!fs.existsSync(dmgbuild)) {
      run('python3', ['-m', 'venv', venv], { timeout: 120000 });
      run(path.join(venv, 'bin', 'pip'), ['install', '--quiet', 'dmgbuild==1.6.5'], { timeout: 300000 });
    }
    const art = path.join(WORK, 'background');
    run('swift', [path.join(ROOT, 'app', 'macos', 'dmg-background.swift'), art], { timeout: 180000 });
    const settings = path.join(WORK, 'dmg-settings.py');
    fs.writeFileSync(settings, `
import os.path
app = defines['app']
files = [app]
symlinks = {'Applications': '/Applications'}
format = 'ULFO'
background = defines['art'] + '.png'
window_rect = ((200, 120), (660, 420))
default_view = 'icon-view'
show_status_bar = False
show_tab_view = False
show_toolbar = False
show_pathbar = False
show_sidebar = False
icon_size = 128
text_size = 13
icon_locations = {os.path.basename(app): (165, 190), 'Applications': (495, 190)}
`);
    run(dmgbuild, ['-s', settings, '-D', `app=${app}`, '-D', `art=${art}`, APP.name, DMG], { timeout: 600000 });
  } catch (err) {
    say(`  (Oklu pencere yapılamadı, düz görüntü: ${String(err.stderr || err.message).slice(0, 160)})`);
    const stage = path.join(WORK, 'image');
    fs.rmSync(stage, { recursive: true, force: true });
    fs.mkdirSync(stage, { recursive: true });
    run('ditto', [app, path.join(stage, `${APP.name}.app`)]);
    fs.symlinkSync('/Applications', path.join(stage, 'Applications'));
    run('hdiutil', ['create', '-volname', APP.name, '-srcfolder', stage, '-ov', '-format', 'ULFO', DMG], { timeout: 600000 });
  }
}

const notaryReady = () => spawnSync('xcrun', ['notarytool', 'history', '--keychain-profile', NOTARY_PROFILE], { stdio: 'ignore', timeout: 30000 }).status === 0;

export function packageApp() {
  const identity = pickIdentity();
  say(`${APP.name} ${VERSION} paketleniyor`);
  const app = buildBundle(identity);
  say('  Disk görüntüsü yapılıyor…');
  makeImage(app);
  if (identity !== '-') sign(DMG, identity);
  let notarized = false;
  if (identity.startsWith('Developer ID') && notaryReady()) {
    say('  Apple onayı bekleniyor (birkaç dakika)…');
    run('xcrun', ['notarytool', 'submit', DMG, '--keychain-profile', NOTARY_PROFILE, '--wait'], { timeout: 1800000 });
    run('xcrun', ['stapler', 'staple', DMG], { timeout: 120000 });
    notarized = true;
  }
  return { dmg: DMG, identity, notarized, megabytes: Math.round(fs.statSync(DMG).size / 1048576), sha256: crypto.createHash('sha256').update(fs.readFileSync(DMG)).digest('hex') };
}
