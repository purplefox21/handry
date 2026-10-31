// Handry · © 2026 Berat Olekli (purplefox) · github.com/purplefox21/handry
// Brain: OpenAI Codex CLI (ChatGPT subscription) in exec mode, with Handry as
// an MCP server. Experimental: written from Codex's non-interactive docs and
// not tested on this Mac (Codex isn't installed here).
import { spawn } from 'node:child_process';
import path from 'node:path';
import { ROOT, homeDir } from '../core/config.js';
import { brainPrompt, findBinary, shortName } from './common.js';
import { T } from '../core/i18n.js';

export const id = 'codex';
export const label = () => T('Codex (deneysel)', 'Codex (experimental)');

export async function available() {
  return findBinary('codex') ? { ok: true } : { ok: false, reason: T('codex kurulu değil (npm i -g @openai/codex)', 'codex is not installed (npm i -g @openai/codex)') };
}

const toml = s => JSON.stringify(s); // a JSON string is a valid TOML basic string

export function run({ text, sessionId, onEvent, signal }) {
  const overrides = [
    '-c', `mcp_servers.jevis.command=${toml(process.execPath)}`,
    '-c', `mcp_servers.jevis.args=[${toml(path.join(ROOT, 'mcp', 'server.js'))}]`
  ];
  const prompt = sessionId ? text : `${brainPrompt()}\n\n${T('Kullanıcının isteği', "The user's request")}: ${text}`;
  const args = sessionId
    ? ['exec', 'resume', sessionId, '--json', '--skip-git-repo-check', ...overrides, prompt]
    : ['exec', '--json', '--skip-git-repo-check', '--sandbox', 'read-only', ...overrides, prompt];

  return new Promise((resolve, reject) => {
    const child = spawn(findBinary('codex'), args, { cwd: homeDir('brain'), stdio: ['ignore', 'pipe', 'pipe'] });
    let buffer = '';
    let finalText = '';
    let thread = sessionId || null;
    let errText = '';
    signal?.addEventListener('abort', () => child.kill('SIGTERM'), { once: true });

    child.stdout.on('data', chunk => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        let ev;
        try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === 'thread.started') thread = ev.thread_id;
        const item = ev.item || {};
        if (ev.type === 'item.started' && item.type === 'mcp_tool_call') {
          onEvent({ type: 'tool', name: shortName(item.tool || item.name || T('araç', 'tool')), args: item.arguments || {} });
        }
        if (ev.type === 'item.completed') {
          if (item.type === 'agent_message' && item.text) {
            onEvent({ type: 'text', text: item.text });
            finalText = item.text;
          } else if (item.type === 'mcp_tool_call') {
            const out = typeof item.result === 'string' ? item.result : JSON.stringify(item.result ?? item.error ?? '');
            onEvent({ type: 'tool_result', name: shortName(item.tool || item.name || T('araç', 'tool')), text: out.slice(0, 2000), isError: item.status === 'failed' });
          }
        }
        if (ev.type === 'error' || ev.type === 'turn.failed') onEvent({ type: 'status', text: `Codex: ${ev.message || ev.error?.message || T('hata', 'error')}` });
      }
    });
    child.stderr.on('data', chunk => { errText += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      if (signal?.aborted) return resolve({ text: T('Durduruldu.', 'Stopped.'), sessionId: thread, stopped: true });
      if (code !== 0 && !finalText) return reject(new Error(T(`Codex hata verdi (${code}): ${errText.slice(-400)}`, `Codex failed (${code}): ${errText.slice(-400)}`)));
      resolve({ text: finalText, sessionId: thread });
    });
  });
}
