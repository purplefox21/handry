// Fast path: Jev decides whether a command is one simple action JEVIS can do
// without asking an LLM (seconds and cost saved), or needs a brain.
import * as jev from './jev.js';
import { callTool } from './tools.js';
import { dispatchCommand } from '../jev-dispatcher.js';

const ROUTE = {
  type: 'choice',
  instructions: 'How should JEVIS handle the user `command`? Choose the single best option.',
  criteria: {
    system_quick: 'One quick Mac system action: change the volume, mute, play/pause/next/previous music, toggle dark mode, lock the screen, take a screenshot, open or quit an app, or one web search',
    page_click: 'Click one thing (a link, tab or button) on the web page already open in the JEVIS browser: only a click, nothing to type or read',
    needs_brain: 'Anything else: several steps, typing or writing text, filling forms, reading or summarizing, answering questions, decisions, or anything unclear'
  }
};

const MIN_CONFIDENCE = 0.75;

/**
 * Tries the fast path. Returns { handled: true, text } when done, or
 * { handled: false, note } so the caller hands the command to a brain.
 */
export async function tryFast(command, onEvent) {
  const { answers, ms } = await jev.ask({ command }, { route: ROUTE });
  const route = answers.route?.choice || 'needs_brain';
  const confidence = answers.route?.confidence ?? 0;
  onEvent({ type: 'route', route, confidence: Math.round(confidence * 100), ms });
  if (route === 'needs_brain' || confidence < MIN_CONFIDENCE) return { handled: false };

  if (route === 'system_quick') {
    const res = await dispatchCommand(command);
    const ok = res.executionResults.filter(r => r.success);
    if (!ok.length) return { handled: false, note: res.executionResults.map(r => r.error || r.message).join(' ') };
    for (const r of res.executionResults) onEvent({ type: 'tool_result', name: `mac:${res.jevDecisions.action}`, text: r.message || r.error, isError: !r.success });
    return { handled: true, text: ok.map(r => r.message).join('\n') };
  }

  onEvent({ type: 'tool', name: 'browser_click', args: { target: command } });
  const result = await callTool('browser_click', { target: command });
  const text = result.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
  onEvent({ type: 'tool_result', name: 'browser_click', text, isError: Boolean(result.isError) });
  if (result.isError) return { handled: false, note: `Hızlı yol olmadı: ${text}` };
  const clicked = text.match(/Öğe: "([^"]+)"/)?.[1] || command;
  const opened = text.includes('Sayfa değişti') || text.includes('Yeni sekme') ? text.match(/Şu an: (.+?) \(/)?.[1] : null;
  return { handled: true, text: `"${clicked}" tıklandı.${opened ? ` Açılan sayfa: ${opened}` : ''}` };
}
