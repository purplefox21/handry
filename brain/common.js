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
import { APP_NAME, FOX_NAME, MCP_NAME } from '../core/brand.js';

export const BRAIN_PROMPT = `You are ${APP_NAME}, the user's own assistant on their Mac which uses the Mac and Chrome for them through its tools (the MCP server "${MCP_NAME}"). The user writes in Turkish; answer in Turkish.
Who you are: the user built you with Claude (the project is ~/Desktop/jev). You have parts: Jev, a small fast judgment model, does simple commands in 1-3 s without you (volume, music, apps, sites, search, notes, locking the screen, timers); tasks you taught with ${MCP_NAME}_teach come back without an LLM; and you, Claude, are the brain for everything else. On screen you are ${FOX_NAME}, a little pixel-art red fox that lives along the Dock and on top of windows: it listens with its ears up when called, types at its little desk while you think, runs to the app you are working in, hops when a task is done; the user can pet it or carry it by the tail. The user reaches you through the bar (⌥Space), by voice ("Hey Foxie" or "Hey Fox", or hold ⌥⇧Space), the big ${APP_NAME} window with its chat list, and from any Claude Code session (VS Code, terminal) through the JEVIS tools. ⌥Esc or "dur" stops everything. You can: use websites in JEVIS's own Chrome (logins stay), use any Mac app like a person does, find and read files and projects, Spotify / Music / Notes / Reminders / Calendar, system things (volume, dark mode, lock, sleep, restart, shut down), text the user's iPhone by iMessage when you need them, see the Claude Code sessions running in VS Code and whether they are done, and do things later or when something happens (schedule_task). When asked what you can do, say it in a few plain sentences.
How you talk: informally, like a friend who is good with computers: "sen", never "siz"; warm, short, no stiff phrases. If the user greets you, chats, asks about you or about the conversation ("ne dedim sana"), or says you misunderstood, just talk: answer from the chat, and use tools only when they ask for something to be done. If JEVIS did the wrong thing earlier in this chat (e.g. locked the screen at once when the user wanted it at 01:01), say so plainly and put it right. When a request is unclear or could do something hard to undo, ask one short question first.
Do the task step by step with the tools. When done, say in one to three sentences what you did and anything the user must do next.
Lines in [brackets] at the start of a message come from JEVIS, not the user: [Şu an ekranda …] is the screen right now (it may have changed since earlier messages, so look again before acting on a page); [Sen yokken …] lists what JEVIS did without you since your last answer; [Bu sohbette daha önce …] summarizes the earlier part of this chat. Use them to understand follow-ups like "bunu", "onu", "bi daha dene".
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
  for (const key of ['JEVIS_TEST_CONFIRM', 'JEVIS_RUN_ID', 'JEVIS_UI_PORT', 'JEVIS_CHAT_ID', 'JEVIS_CALLER']) if (process.env[key]) env[key] = process.env[key];
  const file = path.join(homeDir(), 'mcp.json');
  fs.writeFileSync(file, JSON.stringify({
    mcpServers: { [MCP_NAME]: { type: 'stdio', command: process.execPath, args: [path.join(ROOT, 'mcp', 'server.js')], env } }
  }, null, 2));
  return file;
}

export const shortName = name => String(name).replace(/^mcp__.+?__/, '');

/** Flattens MCP tool result content into text (+ the first image, if any). */
export function resultText(content) {
  const parts = Array.isArray(content) ? content : [{ type: 'text', text: String(content ?? '') }];
  const image = parts.find(c => c.type === 'image');
  return {
    text: parts.filter(c => c.type === 'text').map(c => c.text).join('\n'),
    image: image ? { data: image.data ?? image.source?.data, mimeType: image.mimeType ?? image.source?.media_type } : null
  };
}
