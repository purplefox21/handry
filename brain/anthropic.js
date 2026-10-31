// Handry · © 2026 Berat Olekli (purplefox) · github.com/purplefox21/handry
// Brain: Claude through the Anthropic API (needs ANTHROPIC_API_KEY). Tools run
// in-process through callTool. Refusal fallbacks are on: a declined request is
// retried server-side on a fallback model.
import Anthropic from '@anthropic-ai/sdk';
import { TOOLS, callTool } from '../core/tools.js';
import { config } from '../core/config.js';
import { brainPrompt, resultText } from './common.js';
import { T } from '../core/i18n.js';

export const id = 'anthropic';
export const label = () => T('Claude API (anahtar)', 'Claude API (key)');

const sessions = new Map();

export async function available() {
  return process.env.ANTHROPIC_API_KEY ? { ok: true } : { ok: false, reason: T('ANTHROPIC_API_KEY tanımlı değil', 'ANTHROPIC_API_KEY is not set') };
}

const toolDefs = () => TOOLS.map(t => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));

function toToolResult(block, result) {
  const content = result.content.map(c => (c.type === 'image'
    ? { type: 'image', source: { type: 'base64', media_type: c.mimeType, data: c.data } }
    : { type: 'text', text: c.text }));
  return { type: 'tool_result', tool_use_id: block.id, content, is_error: Boolean(result.isError) };
}

export async function run({ text, sessionId, onEvent, signal }) {
  const client = new Anthropic();
  const { maxSteps } = config().brain;
  const model = config().brain.providers.anthropic.model || 'claude-sonnet-5-5';
  const id = sessionId || `anthropic-${Date.now()}`;
  const messages = sessions.get(id) || [];
  messages.push({ role: 'user', content: text });
  let finalText = '';

  for (let step = 0; step < maxSteps; step++) {
    if (signal?.aborted) return { text: T('Durduruldu.', 'Stopped.'), sessionId: id, stopped: true };
    const response = await client.beta.messages.create({
      model,
      max_tokens: 16000,
      system: brainPrompt(),
      tools: toolDefs(),
      thinking: { type: 'adaptive' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      messages
    }, { signal });

    if (response.stop_reason === 'refusal') {
      onEvent({ type: 'status', text: T('Model bu isteği reddetti.', 'The model declined this request.') });
      break;
    }
    messages.push({ role: 'assistant', content: response.content });
    for (const block of response.content) {
      if (block.type === 'text' && block.text.trim()) {
        onEvent({ type: 'text', text: block.text });
        finalText = block.text;
      }
    }
    if (response.stop_reason === 'pause_turn') continue;
    const calls = response.content.filter(b => b.type === 'tool_use');
    if (response.stop_reason !== 'tool_use' || !calls.length) break;

    const results = [];
    for (const call of calls) {
      onEvent({ type: 'tool', name: call.name, args: call.input });
      const result = await callTool(call.name, call.input);
      const { text: out, image } = resultText(result.content);
      onEvent({ type: 'tool_result', name: call.name, text: out, isError: Boolean(result.isError), image });
      results.push(toToolResult(call, result));
    }
    messages.push({ role: 'user', content: results });
  }
  sessions.set(id, messages);
  return { text: finalText, sessionId: id };
}
