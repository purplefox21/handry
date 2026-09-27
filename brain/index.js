// Brain registry: which LLMs can drive JEVIS, and whether each is usable now.
import * as claudeCode from './claude-code.js';
import * as anthropic from './anthropic.js';
import * as codex from './codex.js';
import { makeBrain } from './openai-compatible.js';

const BRAINS = [
  claudeCode,
  codex,
  anthropic,
  makeBrain('openai', 'OpenAI uyumlu API'),
  makeBrain('ollama', 'Ollama (yerel model)')
];

export function getBrain(id) {
  const brain = BRAINS.find(b => b.id === id);
  if (!brain) throw new Error(`Bilinmeyen beyin: ${id}`);
  return brain;
}

export async function listBrains() {
  return Promise.all(BRAINS.map(async b => {
    const state = await b.available().catch(err => ({ ok: false, reason: err.message }));
    return { id: b.id, label: b.label, available: state.ok, reason: state.reason || '' };
  }));
}
