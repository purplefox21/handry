// Brain: any OpenAI-compatible chat API with function calling — OpenAI,
// Ollama (http://127.0.0.1:11434/v1), LM Studio, OpenRouter… Configure base
// URL, key variable and model in handry.config.json › brain.providers.
import { TOOLS, callTool } from '../core/tools.js';
import { config } from '../core/config.js';
import { BRAIN_PROMPT, resultText } from './common.js';

const sessions = new Map();

function settings(providerId) {
  const p = config().brain.providers[providerId] || {};
  return { ...p, apiKey: p.apiKeyEnv ? process.env[p.apiKeyEnv] : '' };
}

export function makeBrain(providerId, label) {
  return {
    id: providerId,
    label,
    async available() {
      const s = settings(providerId);
      if (!s.model) return { ok: false, reason: `handry.config.json › brain.providers.${providerId}.model boş` };
      if (s.apiKeyEnv && !s.apiKey) return { ok: false, reason: `${s.apiKeyEnv} tanımlı değil` };
      try {
        const res = await fetch(`${s.baseURL}/models`, { headers: s.apiKey ? { Authorization: `Bearer ${s.apiKey}` } : {}, signal: AbortSignal.timeout(1500) });
        return res.ok ? { ok: true } : { ok: false, reason: `${s.baseURL} cevap vermedi (${res.status})` };
      } catch {
        return { ok: false, reason: `${s.baseURL} adresine ulaşılamadı` };
      }
    },
    async run({ text, sessionId, onEvent, signal }) {
      const s = settings(providerId);
      const id = sessionId || `${providerId}-${Date.now()}`;
      const history = sessions.get(id) || [{ role: 'system', content: BRAIN_PROMPT }];
      history.push({ role: 'user', content: text });
      const tools = TOOLS.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
      let finalText = '';

      for (let step = 0; step < config().brain.maxSteps; step++) {
        if (signal?.aborted) return { text: 'Durduruldu.', sessionId: id, stopped: true };
        const res = await fetch(`${s.baseURL}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(s.apiKey ? { Authorization: `Bearer ${s.apiKey}` } : {}) },
          body: JSON.stringify({ model: s.model, messages: history, tools, tool_choice: 'auto' }),
          signal
        });
        if (!res.ok) throw new Error(`${label} hata verdi (${res.status}): ${(await res.text()).slice(0, 300)}`);
        const message = (await res.json()).choices?.[0]?.message || {};
        history.push({ role: 'assistant', content: message.content ?? '', ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}) });
        if (message.content?.trim()) {
          onEvent({ type: 'text', text: message.content });
          finalText = message.content;
        }
        if (!message.tool_calls?.length) break;

        for (const call of message.tool_calls) {
          let args = {};
          try { args = JSON.parse(call.function.arguments || '{}'); } catch {}
          onEvent({ type: 'tool', name: call.function.name, args });
          const result = await callTool(call.function.name, args);
          const { text: out, image } = resultText(result.content);
          onEvent({ type: 'tool_result', name: call.function.name, text: out, isError: Boolean(result.isError), image });
          history.push({ role: 'tool', tool_call_id: call.id, content: image ? `${out}\n[Ekran görüntüsü alındı; bu bağlantıda görüntü gönderilmiyor.]` : out });
        }
      }
      sessions.set(id, history);
      return { text: finalText, sessionId: id };
    }
  };
}
