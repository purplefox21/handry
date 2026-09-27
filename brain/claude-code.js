// Brain: Claude Code in print mode on the user's subscription. JEVIS tools
// come in through MCP; only those tools are allowed.
import { spawn } from 'node:child_process';
import { homeDir, config } from '../core/config.js';
import { BRAIN_PROMPT, findBinary, mcpConfigFile, shortName, resultText } from './common.js';

export const id = 'claude-code';
export const label = 'Claude Code (abonelik)';

export async function available() {
  return findBinary('claude') ? { ok: true } : { ok: false, reason: 'claude komutu bulunamadı' };
}

export function run({ text, sessionId, onEvent, signal }) {
  const bin = findBinary('claude');
  const args = [
    '-p', text,
    '--output-format', 'stream-json', '--verbose',
    '--mcp-config', mcpConfigFile(), '--strict-mcp-config',
    '--allowedTools', 'mcp__jevis',
    '--append-system-prompt', BRAIN_PROMPT
  ];
  const model = config().brain.providers['claude-code']?.model;
  if (model) args.push('--model', model);
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
          onEvent({ type: 'status', text: 'Claude Code başladı' });
        } else if (ev.type === 'assistant') {
          for (const block of ev.message?.content || []) {
            if (block.type === 'text' && block.text.trim()) onEvent({ type: 'text', text: block.text });
            if (block.type === 'tool_use') {
              names.set(block.id, shortName(block.name));
              if (block.name.startsWith('mcp__jevis__')) onEvent({ type: 'tool', name: shortName(block.name), args: block.input });
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
