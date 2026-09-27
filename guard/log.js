// Action log: one JSON line per tool call in ~/.jevis/logs/YYYY-MM-DD.jsonl.
import fs from 'node:fs';
import path from 'node:path';
import { homeDir } from '../core/config.js';

const SECRET_ARGS = new Set(['password', 'secret_value', 'value']);

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
