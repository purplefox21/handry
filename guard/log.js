// Action log: one JSON line per tool call in ~/.jevis/logs/YYYY-MM-DD.jsonl,
// written by the code (not told by an AI): when, who (the app itself — bar,
// window, voice, a timer, the terminal — or which Claude Code session), which
// tool on what, the result, and whether the user was asked.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { homeDir } from '../core/config.js';

const WHERE = { 'claude-vscode': 'VS Code', cli: 'Terminal', 'claude-desktop': 'Claude uygulaması' };
let claudeCaller;

/** A JEVIS MCP server runs under a Claude session: Claude Code's own session file names it. */
function callerFromClaude() {
  if (claudeCaller !== undefined) return claudeCaller;
  try {
    const s = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'sessions', `${process.ppid}.json`), 'utf-8'));
    claudeCaller = `${WHERE[s.entrypoint] || 'Claude'} · ${path.basename(s.cwd || '')}${s.name ? ` (${s.name})` : ''}`;
  } catch {
    claudeCaller = null;
  }
  return claudeCaller;
}

function who() {
  if (process.env.JEVIS_CALLER) return process.env.JEVIS_CALLER;
  if (String(process.env.JEVIS_RUN_ID || '').startsWith('mcp-')) return callerFromClaude() || 'Claude oturumu';
  return 'elle';
}

const SECRET_ARGS = new Set(['password', 'secret_value']);

function redact(args, result) {
  const out = {};
  for (const [k, v] of Object.entries(args || {})) out[k] = SECRET_ARGS.has(k) ? '***' : v;
  // Text typed into a password field is masked even if the brain typed it itself.
  if (out.text !== undefined && /password/.test(result?.elementRole || '')) out.text = '***';
  return out;
}

export function logAction({ tool, args, ok, summary, ms, elementRole, screenshot }) {
  const entry = {
    ts: new Date().toISOString(),
    run: process.env.JEVIS_RUN_ID || 'manual',
    who: who(),
    tool,
    args: redact(args, { elementRole }),
    ok,
    ms,
    summary: String(summary || '').slice(0, 500),
    ...(screenshot ? { screenshot } : {})
  };
  const file = path.join(homeDir('logs'), `${entry.ts.slice(0, 10)}.jsonl`);
  fs.appendFileSync(file, `${JSON.stringify(entry)}\n`);
}

/** Every logged action of one run, oldest first. */
export function actionsOfRun(runId) {
  const dir = homeDir('logs');
  const out = [];
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort()) {
    for (const line of fs.readFileSync(path.join(dir, f), 'utf-8').split('\n')) {
      if (!line.includes(runId)) continue;
      const e = JSON.parse(line);
      if (e.run === runId) out.push(e);
    }
  }
  return out;
}

export function recentActions(limit = 20) {
  const dir = homeDir('logs');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort().reverse();
  const out = [];
  for (const f of files) {
    const lines = fs.readFileSync(path.join(dir, f), 'utf-8').trim().split('\n').reverse();
    for (const line of lines) {
      if (!line) continue;
      out.push(JSON.parse(line));
      if (out.length >= limit) return out;
    }
  }
  return out;
}
