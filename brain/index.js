// Brain registry: which LLMs can drive Handry, and whether each is usable now.
import * as claudeCode from './claude-code.js';
import * as anthropic from './anthropic.js';
import * as codex from './codex.js';
import { makeBrain } from './openai-compatible.js';
import { T } from '../core/i18n.js';

// A module's label is a function (the language can change while the server runs); brain.label reads it.
const named = mod => ({ id: mod.id, get label() { return mod.label(); }, available: mod.available, run: mod.run });

const BRAINS = [
  named(claudeCode),
  named(codex),
  named(anthropic),
  makeBrain('openai', () => T('OpenAI uyumlu API', 'OpenAI-compatible API')),
  makeBrain('ollama', () => T('Ollama (yerel model)', 'Ollama (local model)'))
];

export function getBrain(id) {
  const brain = BRAINS.find(b => b.id === id);
  if (!brain) throw new Error(T(`Bilinmeyen beyin: ${id}`, `Unknown brain: ${id}`));
  return brain;
}

export async function listBrains() {
  return Promise.all(BRAINS.map(async b => {
    const state = await b.available().catch(err => ({ ok: false, reason: err.message }));
    return { id: b.id, label: b.label, available: state.ok, reason: state.reason || '' };
  }));
}
