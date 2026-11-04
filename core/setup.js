// Handry · © 2026 Berat Olekli (purplefox) · github.com/purplefox21/handry
// First launch, for someone who has never opened a terminal: what is still missing (Chrome, Claude) and the
// button that sorts it out. Claude's own installer runs, and signing in happens in Claude's own window and the
// browser: Handry never sees the password. All of it is optional: simple commands work without Claude.
import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { config, homeDir, loadState, saveState } from './config.js';
import { findBinary } from '../brain/common.js';
import { T } from './i18n.js';

const INSTALLER = 'https://claude.ai/install.sh';
let installing = false;
let installError = '';
let loginOpened = false;

const claudeSignedIn = bin => new Promise(resolve => {
  execFile(bin, ['auth', 'status'], { timeout: 8000 }, (err, stdout) => {
    try { resolve(JSON.parse(stdout).loggedIn === true); } catch { resolve(false); }
  });
});

export async function setupState() {
  const bin = findBinary('claude');
  return {
    chrome: fs.existsSync(config().browser.chromePath),
    claude: { installed: Boolean(bin), loggedIn: bin ? await claudeSignedIn(bin) : false },
    installing,
    installError,
    loginOpened,
    dismissed: Boolean(loadState().setupDismissed)
  };
}

/** Runs Claude's own installer in the background; setupState shows how it goes. */
export function installClaude() {
  if (installing || findBinary('claude')) return { installing };
  installing = true;
  installError = '';
  const child = spawn('/bin/bash', ['-c', `set -o pipefail; curl -fsSL ${INSTALLER} | bash`], { stdio: ['ignore', 'ignore', 'pipe'] });
  let errors = '';
  child.stderr.on('data', d => { errors = (errors + d).slice(-400); });
  const stop = setTimeout(() => child.kill(), 10 * 60 * 1000);
  child.on('error', err => { errors = err.message; });
  child.on('close', code => {
    clearTimeout(stop);
    installing = false;
    if (code !== 0 || !findBinary('claude')) installError = errors.trim().split('\n').pop() || T('internet bağlantısına bak', 'check your internet connection');
  });
  return { installing };
}

/** Signing in wants a real terminal window: a small script that opens in Terminal, runs Claude's login, and says when it's done. */
export function loginClaude() {
  const bin = findBinary('claude');
  if (!bin) return { opened: false };
  const file = path.join(homeDir('setup'), 'claude-login.command');
  const quoted = `'${bin.replace(/'/g, `'\\''`)}'`;
  fs.writeFileSync(file, `#!/bin/zsh
clear
echo ${JSON.stringify(T('Tarayıcıda Claude girişi açılıyor. Girişi orada yap.', 'Claude sign-in is opening in your browser. Sign in there.'))}
echo
${quoted} auth login
echo
echo ${JSON.stringify(T('Bitti. Bu pencereyi kapatabilirsin.', "All done. You can close this window."))}
`, { mode: 0o755 });
  fs.chmodSync(file, 0o755);
  if (process.env.JEVIS_SETUP_DRY !== '1') spawn('/usr/bin/open', [file], { stdio: 'ignore', detached: true }).unref();
  loginOpened = true;
  return { opened: true, file };
}

export function dismissSetup() {
  saveState({ setupDismissed: true });
  return { dismissed: true };
}
