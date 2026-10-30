// Brain: Claude Code in print mode on the user's subscription. Handry tools
// come in through MCP; only those tools are allowed.
import { spawn } from 'node:child_process';
import { homeDir, config } from '../core/config.js';
import { BRAIN_PROMPT, findBinary, mcpConfigFile, shortName, resultText } from './common.js';
import { MCP_NAME } from '../core/brand.js';

export const id = 'claude-code';
export const label = 'Claude Code (abonelik)';

export async function available() {
  return findBinary('claude') ? { ok: true } : { ok: false, reason: 'claude komutu bulunamadı' };
}

/**
 * Lean mode: a short Handry system prompt instead of Claude Code's long coding
 * one, and none of its built-in coding tools (shell, file edits…). The Handry
 * tools come in through MCP either way. Measured on a form task: same result,
 * about 2–6× cheaper and faster, and no shell access for the brain.
 */
export function run({ text, sessionId, onEvent, signal, model, effort }) {
  const bin = findBinary('claude');
  const settings = config().brain.providers['claude-code'] || {};
  const args = [
    '-p', text,
    '--output-format', 'stream-json', '--verbose',
    '--mcp-config', mcpConfigFile(), '--strict-mcp-config',
    '--allowedTools', `mcp__${MCP_NAME}`
  ];
  if (settings.lean === false) args.push('--append-system-prompt', BRAIN_PROMPT);
  else args.push('--tools', '', '--system-prompt', BRAIN_PROMPT);
  const chosenModel = model || settings.model;
  const chosenEffort = effort || settings.effort;
  if (chosenModel) args.push('--model', chosenModel);
  if (chosenEffort) args.push('--effort', chosenEffort);
  if (sessionId) args.push('--resume', sessionId);

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: homeDir('brain'), stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    const names = new Map();
    let buffer = '';
    let finalText = '';
    let session = sessionId || null;
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
        if (ev.type === 'system' && ev.subtype === 'init') {
          session = ev.session_id;
          onEvent({ type: 'status', text: 'Claude başladı' });
        } else if (ev.type === 'assistant') {
          for (const block of ev.message?.content || []) {
            if (block.type === 'text' && block.text.trim()) onEvent({ type: 'text', text: block.text });
            if (block.type === 'tool_use') {
              names.set(block.id, shortName(block.name));
              if (block.name.startsWith(`mcp__${MCP_NAME}__`)) onEvent({ type: 'tool', name: shortName(block.name), args: block.input });
            }
          }
        } else if (ev.type === 'user') {
          for (const block of ev.message?.content || []) {
            if (block.type !== 'tool_result') continue;
            const name = names.get(block.tool_use_id);
            if (!name || name === 'ToolSearch') continue;
            const { text: out, image } = resultText(block.content);
            onEvent({ type: 'tool_result', name, text: out, isError: Boolean(block.is_error), image });
          }
        } else if (ev.type === 'result') {
          finalText = ev.result || '';
          session = ev.session_id || session;
        }
      }
    });
    child.stderr.on('data', chunk => { errText += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      if (signal?.aborted) return resolve({ text: 'Durduruldu.', sessionId: session, stopped: true });
      if (code !== 0 && !finalText) return reject(new Error(`Claude Code hata verdi (${code}): ${errText.slice(-400)}`));
      resolve({ text: finalText, sessionId: session });
    });
  });
}
