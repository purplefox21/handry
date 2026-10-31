// Claude Code sessions running on this Mac (VS Code, terminal, the Claude
// app). Claude Code keeps ~/.claude/sessions/<pid>.json up to date with each
// session's status: "busy" while it works, "waiting" when it needs the user
// (a permission or a question; waitingFor says which), "idle" when its turn
// is over. A session also counts as working while a command it started (a
// Bash tool call, also one in the background) is still running.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { HOME } from '../core/config.js';

const dir = () => process.env.JEVIS_CLAUDE_SESSIONS_DIR || path.join(os.homedir(), '.claude', 'sessions');
const WHERE = { 'claude-vscode': 'VS Code', cli: 'terminal', 'claude-desktop': 'Claude uygulaması' };

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; }
}

// Claude runs every Bash tool call in a shell that sources ~/.claude/shell-snapshots/…;
// returns pid → how many of those shells run under it.
function commandCounter() {
  let out = '';
  try { out = execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 }); } catch { return () => 0; }
  const children = new Map();
  const shells = new Set();
  for (const line of out.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
    if (!m) continue;
    if (!children.has(m[2])) children.set(m[2], []);
    children.get(m[2]).push(m[1]);
    if (m[3].includes('.claude/shell-snapshots/')) shells.add(m[1]);
  }
  return root => {
    let count = 0;
    const stack = [...(children.get(String(root)) || [])];
    while (stack.length) {
      const pid = stack.pop();
      if (shells.has(pid)) count++;
      else stack.push(...(children.get(pid) || []));
    }
    return count;
  };
}

/**
 * [{ pid, sessionId, name, project, cwd, where, state: 'working'|'waiting'|'idle',
 *    waitingFor, commands, since, jevis }] — newest change first. `jevis` marks
 * Handry's own brain runs.
 */
export function claudeSessions() {
  let files = [];
  try { files = fs.readdirSync(dir()).filter(f => /^\d+\.json$/.test(f)); } catch { return []; }
  const commands = commandCounter();
  const brainDir = path.join(HOME, 'brain');
  return files.map(f => {
    let s;
    try { s = JSON.parse(fs.readFileSync(path.join(dir(), f), 'utf-8')); } catch { return null; }
    if (!s?.pid || !alive(s.pid)) return null;
    const running = commands(s.pid);
    const state = s.status === 'waiting' ? 'waiting' : s.status === 'busy' || running > 0 ? 'working' : 'idle';
    const project = path.basename(s.cwd || '');
    return {
      pid: s.pid,
      sessionId: s.sessionId || '',
      name: s.name || project,
      project,
      cwd: (s.cwd || '').normalize('NFC'),
      where: WHERE[s.entrypoint] || s.entrypoint || '',
      state,
      waitingFor: s.waitingFor || '',
      commands: running,
      since: s.statusUpdatedAt || s.updatedAt || s.startedAt || 0,
      jevis: Boolean(s.cwd && s.cwd.startsWith(brainDir))
    };
  }).filter(Boolean).sort((a, b) => b.since - a.since);
}

const hhmm = t => new Date(t).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

export function stateText(s) {
  if (s.state === 'waiting') return `senden cevap bekliyor${s.waitingFor ? ` (${s.waitingFor})` : ''}`;
  if (s.state === 'working') return `çalışıyor${s.commands ? ` · ${s.commands} komut sürüyor` : ''}`;
  return `bitti, boşta${s.since ? ` (${hhmm(s.since)}'dan beri)` : ''}`;
}

export const sessionLabel = s => `"${s.name}" (${s.project}${s.where ? `, ${s.where}` : ''})`;

export function formatSessions(list) {
  const shown = list.filter(s => !s.jevis);
  if (!shown.length) return 'Açık bir Claude Code oturumu yok.';
  return shown.map(s => `- ${sessionLabel(s)}: ${stateText(s)}`).join('\n');
}
