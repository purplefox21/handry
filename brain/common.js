// Shared pieces of the brain adapters. Every adapter reports progress with the
// same events so the chat UI doesn't care which LLM is thinking:
//   { type: 'text', text }                    words from the brain
//   { type: 'tool', name, args }              a JEVIS tool is called
//   { type: 'tool_result', name, text, isError, image? }
//   { type: 'status', text }                  informational
// run() resolves to { text, sessionId }.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, homeDir } from '../core/config.js';
import { INSTRUCTIONS } from '../core/tools.js';

export const BRAIN_PROMPT = `You are JEVIS, the user's assistant that uses their Mac and Chrome for them through the JEVIS tools. The user writes in Turkish; answer in Turkish, short and plain.
Do the task step by step with the tools. When done, say in one to three sentences what you did and anything the user must do next.
${INSTRUCTIONS}`;

/** Finds a CLI even when the server was started without the user's shell PATH. */
export function findBinary(name) {
  const dirs = [...(process.env.PATH || '').split(':'), path.join(os.homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', path.join(os.homedir(), '.npm-global', 'bin')];
  for (const dir of dirs) {
    const file = path.join(dir, name);
    try {
      fs.accessSync(file, fs.constants.X_OK);
      return file;
    } catch {}
  }
  return null;
}

/** MCP config that points CLI brains at this checkout's JEVIS server. */
export function mcpConfigFile() {
  const env = {};
  for (const key of ['JEVIS_TEST_CONFIRM', 'JEVIS_RUN_ID', 'JEVIS_UI_PORT']) if (process.env[key]) env[key] = process.env[key];
  const file = path.join(homeDir(), 'mcp.json');
  fs.writeFileSync(file, JSON.stringify({
    mcpServers: { jevis: { type: 'stdio', command: process.execPath, args: [path.join(ROOT, 'mcp', 'server.js')], env } }
  }, null, 2));
  return file;
}

export const shortName = name => String(name).replace(/^mcp__jevis__/, '');

/** Flattens MCP tool result content into text (+ the first image, if any). */
export function resultText(content) {
  const parts = Array.isArray(content) ? content : [{ type: 'text', text: String(content ?? '') }];
  const image = parts.find(c => c.type === 'image');
  return {
    text: parts.filter(c => c.type === 'text').map(c => c.text).join('\n'),
    image: image ? { data: image.data ?? image.source?.data, mimeType: image.mimeType ?? image.source?.media_type } : null
  };
}
