// Handry · © 2026 Berat Olekli (purplefox) · github.com/purplefox21/handry
// The permissions window must never block the app: asking macOS whether an app may be automated doesn't
// return for over a minute when that app doesn't answer (Spotify while it starts, a hung app). Hesap Makinesi
// (Calculator) stands in for it: opened hidden, stopped for a moment, then closed. Skipped when it is already
// open, so the user's own window is never stopped. No permission is asked for or changed, nothing shows on screen.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { buildApp, APP_PATH, HELPERS } from '../app/macos/build.js';
import { ROOT } from '../core/config.js';
import { APP } from '../core/brand.js';

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ` (${extra})` : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const CALC = 'com.apple.calculator';
const pidOf = () => { try { return Number(execFileSync('pgrep', ['-x', 'Calculator'], { encoding: 'utf-8' }).trim().split('\n')[0]) || 0; } catch { return 0; } };

buildApp();
const exe = path.join(APP_PATH, 'Contents', 'MacOS', APP.name);
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'handry-perm-'));

/** Runs the window's checks against Calculator for 6 s; a process that doesn't end in 25 s is itself the failure. */
function probe(label) {
  const out = path.join(work, `${label}.json`);
  return new Promise(resolve => {
    const p = spawn(exe, ['--test-permissions', CALC, '--out', out], { stdio: 'ignore' });
    const stop = setTimeout(() => { p.kill('SIGKILL'); resolve(null); }, 25000);
    p.on('exit', () => {
      clearTimeout(stop);
      try { resolve(JSON.parse(fs.readFileSync(out, 'utf-8'))); } catch { resolve(null); }
    });
  });
}

const fresh = JSON.parse(execFileSync(exe, ['--check-permissions'], { encoding: 'utf-8', timeout: 5000 }));
check('a new process says what it sees', typeof fresh.ax === 'boolean' && typeof fresh.screen === 'boolean', JSON.stringify(fresh));

for (const [name] of HELPERS) check(`the build made ${name}`, fs.existsSync(path.join(ROOT, 'bin', name)));

if (pidOf()) {
  console.log('⏭️  Hesap Makinesi already open: the blocking checks are skipped');
} else {
  execFileSync('open', ['-g', '-j', '-a', 'Calculator']);
  let pid = 0;
  for (let i = 0; i < 20 && !pid; i++) { await sleep(300); pid = pidOf(); }
  await sleep(1000);
  try {
    const normal = await probe('normal');
    check('an app that answers: the main thread keeps running', normal && normal.worstGapMs < 500, JSON.stringify(normal));
    check('an app that answers: the row has an answer', normal && ['missing', 'granted', 'denied'].includes(normal.state));

    process.kill(pid, 'SIGSTOP');
    const hung = await probe('hung');
    process.kill(pid, 'SIGCONT');
    check('an app that does not answer: the main thread keeps running', hung && hung.worstGapMs < 500, JSON.stringify(hung));
    check('an app that does not answer: the row says it is waiting', hung?.state === 'waiting');
  } finally {
    try { process.kill(pid, 'SIGCONT'); } catch {}
    try { execFileSync('osascript', ['-e', 'tell application "Calculator" to quit'], { stdio: 'ignore', timeout: 5000 }); } catch {}
    await sleep(500);
    if (pidOf()) try { execFileSync('pkill', ['-x', 'Calculator']); } catch {}
  }
}

const source = fs.readFileSync(path.join(ROOT, 'app', 'macos', 'Permissions.swift'), 'utf-8');
const restartRow = /AXIsProcessTrusted\(\) \? \.granted : FreshCheck/.test(source) && /CGPreflightScreenCaptureAccess\(\) \? \.granted : FreshCheck/.test(source);
check('Accessibility and Screen Recording also ask a new process', restartRow);

fs.rmSync(work, { recursive: true, force: true });
console.log(`\n${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
