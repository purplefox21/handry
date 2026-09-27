// Runs one user command: the Jev fast path first, otherwise the chosen brain.
// Shared by the chat server and the CLI (`do`, `listen --do`).
import { config } from './config.js';
import { tryFast } from './router.js';
import { getBrain } from '../brain/index.js';
import { clearStop } from '../guard/stop.js';

export async function runCommand({ text, brainId = config().brain.default, sessionId, fast = true, onEvent, signal }) {
  const started = Date.now();
  clearStop(); // a new command from the user means "go on"
  if (fast) {
    const quick = await tryFast(text, onEvent);
    if (quick.handled) return { type: 'done', text: quick.text, fast: true, ms: Date.now() - started };
    if (quick.note) onEvent({ type: 'status', text: quick.note });
  }
  const brain = getBrain(brainId);
  onEvent({ type: 'status', text: `${brain.label} düşünüyor…` });
  const out = await brain.run({ text, sessionId, onEvent, signal });
  return { type: 'done', text: out.text, sessionId: out.sessionId, brain: brain.id, stopped: Boolean(out.stopped), ms: Date.now() - started };
}
