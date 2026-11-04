// Handry · © 2026 Berat Olekli (purplefox) · github.com/purplefox21/handry
// The downloadable app, checked the way someone else gets it: the disk image is mounted read-only and the server
// runs from there with the app's own Node, under a throwaway Handry folder and another port. Nothing that belongs
// to this Mac may be inside. `node tests/package-e2e.mjs --build` makes the image first. No window opens, no
// permission is asked for, the installed app and ~/.jevis aren't touched.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { ROOT } from '../core/config.js';
import { APP } from '../core/brand.js';

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ` (${extra})` : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

if (process.argv.includes('--build')) {
  const { packageApp } = await import('../app/macos/package.js');
  packageApp();
}
const { DMG } = await import('../app/macos/package.js');
if (!fs.existsSync(DMG)) { console.log(`❌ ${DMG} yok: node cli.js app package`); process.exit(1); }

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'handry-pkg-'));
const mount = path.join(work, 'mount');
fs.mkdirSync(mount);
execFileSync('hdiutil', ['attach', DMG, '-nobrowse', '-readonly', '-noverify', '-mountpoint', mount], { stdio: 'pipe' });

let server = null;
try {
  const app = path.join(mount, `${APP.name}.app`);
  const contents = path.join(app, 'Contents');
  const root = path.join(contents, 'Resources', 'handry');
  const node = path.join(contents, 'Helpers', 'node');
  const exe = path.join(contents, 'MacOS', APP.name);

  check('the image holds the app and a link to Applications', fs.existsSync(app) && fs.readlinkSync(path.join(mount, 'Applications')) === '/Applications');
  const verify = spawnSync('codesign', ['--verify', '--deep', '--strict', app], { encoding: 'utf-8' });
  check('its signature is whole', verify.status === 0, verify.stderr.trim().slice(0, 120));
  const entitlements = execFileSync('codesign', ['-d', '--entitlements', '-', '--xml', exe], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
  check('it may use the microphone and Apple Events under the hardened runtime', /audio-input/.test(entitlements) && /apple-events/.test(entitlements));
  const flags = spawnSync('codesign', ['-dv', exe], { encoding: 'utf-8' }).stderr;
  check('the hardened runtime is on', /flags=.*runtime/.test(flags) || /adhoc/.test(flags));

  for (const [name, file] of [['the app', exe], ['Node', node], ['jevis-ax', path.join(root, 'bin', 'jevis-ax')], ['handry-dialog', path.join(root, 'bin', 'handry-dialog')]]) {
    const archs = execFileSync('lipo', ['-archs', file], { encoding: 'utf-8' });
    check(`${name} runs on Apple silicon and Intel`, /arm64/.test(archs) && /x86_64/.test(archs), archs.trim());
  }
  const plist = fs.readFileSync(path.join(contents, 'Info.plist'), 'utf-8');
  check('no path of this Mac in Info.plist', !plist.includes(os.homedir()) && !/JEVISRoot|JEVISNode/.test(plist));
  check('the permission questions are in both languages', fs.existsSync(path.join(contents, 'Resources', 'tr.lproj', 'InfoPlist.strings')) && fs.existsSync(path.join(contents, 'Resources', 'en.lproj', 'InfoPlist.strings')));

  // Nothing of this Mac or of the project's notes
  const files = [];
  (function walk(dir) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (e.isFile()) files.push(p); } })(root);
  const names = files.map(f => path.relative(root, f));
  const unwanted = names.filter(n => /^\.env|(^|\/)\.env$|^PLAN\.md$|^CLAUDE\.md$|^tests\/|^\.mcp\.json$|^\.agents\/|\.bundle$/.test(n));
  check('no .env, notes or tests inside', unwanted.length === 0, unwanted.slice(0, 3).join(', '));
  let key = '';
  try { key = fs.readFileSync(path.join(ROOT, '.env'), 'utf-8').match(/(?:JEV_KEY|TYPESAFE_API_KEY)=([^\r\n]+)/)?.[1]?.trim() || ''; } catch {}
  const texts = files.filter(f => /\.(js|mjs|json|html|css|md|txt)$/.test(f) && !f.includes('/node_modules/'));
  const leak = needle => needle ? texts.filter(f => fs.readFileSync(f, 'latin1').includes(needle)).map(f => path.relative(root, f)) : [];
  check('the Jev key is not inside', leak(key).length === 0);
  const homes = leak(os.homedir());
  check("this Mac's home folder is not written in its files", homes.length === 0, homes.slice(0, 3).join(', '));
  const config = JSON.parse(fs.readFileSync(path.join(root, 'handry.config.json'), 'utf-8'));
  check('the defaults hold no key or phone number', !config.captcha?.key && !config.notify?.imessageTo);

  // It runs by itself, read-only
  const version = execFileSync(node, ['-v'], { encoding: 'utf-8' }).trim();
  check('its own Node starts', /^v\d+/.test(version), version);
  const packaged = execFileSync(node, ['--input-type=module', '-e', `import(${JSON.stringify(path.join(root, 'core', 'config.js'))}).then(m => console.log(m.PACKAGED))`], { encoding: 'utf-8' }).trim();
  check('the code knows it runs from the app', packaged === 'true');
  const fresh = JSON.parse(execFileSync(exe, ['--check-permissions'], { encoding: 'utf-8', timeout: 5000 }));
  check('the app itself starts', typeof fresh.ax === 'boolean');
  if (spawnSync('arch', ['-x86_64', '/usr/bin/true']).status === 0) {
    const intel = spawnSync('arch', ['-x86_64', node, '-p', 'process.arch'], { encoding: 'utf-8', timeout: 20000 });
    check('Node also runs as Intel (Rosetta)', intel.stdout.trim() === 'x64', intel.stdout.trim());
  }

  const home = path.join(work, 'jevis');
  const port = 4391;
  const logs = [];
  server = spawn(node, [path.join(root, 'app', 'server.js')], {
    cwd: root,
    env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: os.homedir(), PORT: String(port), JEVIS_HOME: home, JEVIS_JEV: 'off', JEVIS_LANG: 'tr' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stdout.on('data', d => logs.push(String(d)));
  server.stderr.on('data', d => logs.push(String(d)));
  let ping = null;
  for (let i = 0; i < 40 && !ping; i++) {
    await sleep(250);
    try { ping = await (await fetch(`http://127.0.0.1:${port}/api/ping`)).json(); } catch {}
  }
  check('the server starts from the read-only image', ping?.jevis === true, ping ? '' : logs.join('').slice(-300));
  const page = await fetch(`http://127.0.0.1:${port}/`).then(r => r.text()).catch(() => '');
  check('the window page opens', /<html/i.test(page));
  check('the starting recipes moved out of the app', fs.existsSync(path.join(home, 'recipes', 'sabah-rutini.json')));

  const mcp = spawn(node, [path.join(root, 'mcp', 'server.js')], { cwd: root, env: { PATH: '/usr/bin:/bin', HOME: os.homedir(), JEVIS_HOME: home, JEVIS_JEV: 'off' }, stdio: ['pipe', 'pipe', 'ignore'] });
  let out = '';
  mcp.stdout.on('data', d => { out += d; });
  mcp.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } })}\n`);
  for (let i = 0; i < 40 && !out.includes('"id":1'); i++) await sleep(100);
  mcp.kill();
  check('the MCP server answers from the app', out.includes('"id":1') && /handry/i.test(out));
  const guideConfig = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'GUIDE.md'), 'utf-8').match(/```json\n([\s\S]*?)```/)[1]).mcpServers.handry;
  const guidePaths = [guideConfig.command, ...guideConfig.args].map(p => p.replace('/Applications/Handry.app', app));
  check('the paths in the guide exist in the app', guidePaths.every(p => fs.existsSync(p)), guidePaths.join(' '));

  // A server started by the app goes when the app goes, even when the app was force quit.
  const ownedPort = 4392;
  const owner = spawn('/bin/sh', ['-c', `"${node}" "${path.join(root, 'app', 'server.js')}" & wait`], {
    cwd: root,
    env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: os.homedir(), PORT: String(ownedPort), JEVIS_HOME: path.join(work, 'jevis-owned'), JEVIS_JEV: 'off', JEVIS_LANG: 'tr', JEVIS_OWNED: '1' },
    stdio: 'ignore'
  });
  let ownedUp = false;
  for (let i = 0; i < 40 && !ownedUp; i++) {
    await sleep(250);
    try { ownedUp = (await fetch(`http://127.0.0.1:${ownedPort}/api/ping`)).ok; } catch {}
  }
  owner.kill('SIGKILL');
  let ownedGone = false;
  for (let i = 0; i < 24 && !ownedGone; i++) {
    await sleep(250);
    try { await fetch(`http://127.0.0.1:${ownedPort}/api/ping`); } catch { ownedGone = true; }
  }
  check('the server goes when the app is force quit', ownedUp && ownedGone);

  const dialog = spawnSync(path.join(root, 'bin', 'handry-dialog'), [], { encoding: 'utf-8', timeout: 5000 });
  check('the question card program runs', dialog.status === 2 && /usage/.test(dialog.stderr));
  const ax = spawnSync(path.join(root, 'bin', 'jevis-ax'), ['permissions'], { encoding: 'utf-8', timeout: 8000 });
  check('the desktop helper runs', ax.error === undefined && ax.signal === null, (ax.stdout || ax.stderr).trim().slice(0, 80));
} finally {
  if (server) server.kill();
  await sleep(300);
  try { execFileSync('hdiutil', ['detach', mount, '-force'], { stdio: 'pipe' }); } catch {}
  fs.rmSync(work, { recursive: true, force: true });
}
console.log(`\n${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
