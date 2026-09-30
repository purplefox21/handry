// Phase 7 recipes end to end: record a run from the action log, replay it
// without a brain, variables, hand-off to a brain when a step fails, an
// ask_brain step, and "tarif: …" through the chat API. Test recipes are removed.
// Usage: node tests/recipe-e2e.mjs
import fs from 'node:fs';
process.env.JEVIS_NO_CHAT = '1'; // test commands stay out of the user's chats
import path from 'node:path';
import { spawn } from 'node:child_process';
import { callTool } from '../core/tools.js';
import { ROOT } from '../core/config.js';
import * as browser from '../hands/browser.js';
import { saveFromRun, runRecipe, loadRecipe, deleteRecipe } from '../core/recipes.js';
import { runRecipeWithHandoff } from '../core/runner.js';

const FIXTURE = new URL('./fixtures/appstore-like.html', import.meta.url).href;
const dom = async fn => (await browser.activePage()).evaluate(fn);
const formState = () => dom(() => ({
  name: document.getElementById('name').value,
  price: document.getElementById('price').value,
  signin: document.getElementById('signin').checked,
  status: document.getElementById('status').textContent
}));
const writeRecipe = (name, steps) => fs.writeFileSync(path.join(ROOT, 'recipes', `${name}.json`), JSON.stringify({ name, steps }, null, 2));

let passed = 0;
let total = 0;
async function check(name, fn) {
  total++;
  const started = Date.now();
  let ok = false;
  let note = '';
  try { const r = await fn(); ok = Boolean(r?.ok ?? r); note = r?.note || ''; } catch (err) { note = err.message; }
  if (ok) passed++;
  console.log(`${ok ? '✅' : '❌'} ${String(Date.now() - started).padStart(6)} ms  ${name}${note ? `  → ${note}` : ''}`);
}

process.env.JEVIS_TEST_CONFIRM = 'allow';
const runId = `test-recipe-${Date.now()}`;
fs.mkdirSync(path.join(ROOT, 'recipes'), { recursive: true });

try {
  await check('Bir iş yap (tarife kaydedilecek)', async () => {
    process.env.JEVIS_RUN_ID = runId;
    await callTool('browser_open', { url: FIXTURE });
    const read = await callTool('browser_read', { include_text: false });
    const nameId = read.content[0].text.match(/#(\d+) \[textbox\] Name/)[1];
    await callTool('browser_type', { target: `#${nameId}`, text: 'Tarif Testi' });
    await callTool('browser_select', { target: 'Price', option: '$1.99' });
    await callTool('browser_check', { target: 'Sign-in required', checked: true });
    await callTool('browser_click', { target: 'Save' });
    delete process.env.JEVIS_RUN_ID;
    const s = await formState();
    return s.status === 'Changes saved.';
  });

  await check('İşten tarif çıkar (#id hedefi isme dönüşmeli, okumalar atlanmalı)', () => {
    const r = saveFromRun('test-tarifi', runId, { description: 'test' });
    const tools = r.steps.map(s => s.tool).join(',');
    return { ok: r.steps.length === 5 && r.steps[1].args.target === 'Name' && !tools.includes('browser_read'), note: tools };
  });

  await check('Tarifi beyinsiz tekrar oynat (sıfırlanmış sayfada)', async () => {
    const events = [];
    const res = await runRecipe('test-tarifi', { onEvent: e => events.push(e) });
    const s = await formState();
    return { ok: res.ok && s.name === 'Tarif Testi' && s.price === '$1.99' && s.signin && s.status === 'Changes saved.', note: `${events.filter(e => e.type === 'tool').length} adım` };
  });

  await check('Değişken: {{isim}} verilmezse sorar, verilince kullanır', async () => {
    const r = loadRecipe('test-tarifi');
    r.steps[1].args.text = '{{isim}}';
    writeRecipe('test-tarifi', r.steps);
    let asked = false;
    try { await runRecipe('test-tarifi'); } catch (err) { asked = err.message.includes('isim'); }
    await runRecipe('test-tarifi', { vars: { isim: 'Değişkenli' } });
    return asked && (await formState()).name === 'Değişkenli';
  });

  await check('Adım takılınca beyne devrediyor (kalan adımlarla)', async () => {
    writeRecipe('test-bozuk', [
      { tool: 'browser_open', args: { url: FIXTURE } },
      { tool: 'browser_click', args: { target: 'Olmayan Buton XYZ' } },
      { tool: 'browser_select', args: { target: 'Price', option: 'Free' } }
    ]);
    let prompt = '';
    const fakeBrain = { label: 'Sahte beyin', run: async ({ text }) => { prompt = text; return { text: 'devam ettim', sessionId: 's1' }; } };
    const out = await runRecipeWithHandoff({ name: 'test-bozuk', vars: {}, brain: fakeBrain, onEvent: () => {} });
    return { ok: out.text === 'devam ettim' && prompt.includes('2. adım olmadı') && prompt.includes('Olmayan Buton XYZ') && prompt.includes('"option":"Free"'), note: prompt.split('\n')[0] };
  });

  await check('ask_brain adımı beyne sorup tarife devam ediyor', async () => {
    writeRecipe('test-dusunme', [
      { tool: 'browser_open', args: { url: FIXTURE } },
      { ask_brain: 'Sayfanın başlığını söyle' },
      { tool: 'browser_type', args: { target: 'Name', text: 'Beyinden Sonra' } }
    ]);
    const asked = [];
    const fakeBrain = { label: 'Sahte beyin', run: async ({ text }) => { asked.push(text); return { text: 'App Store Connect', sessionId: 's2' }; } };
    const out = await runRecipeWithHandoff({ name: 'test-dusunme', vars: {}, brain: fakeBrain, onEvent: () => {} });
    return asked[0] === 'Sayfanın başlığını söyle' && out.text.includes('bitti') && (await formState()).name === 'Beyinden Sonra';
  });

  await check('Sohbet API\'si: "tarif: test-tarifi isim=API"', async () => {
    const port = 3924;
    const server = spawn(process.execPath, [path.join(ROOT, 'app', 'server.js')], { env: { ...process.env, PORT: String(port), JEVIS_TEST_CONFIRM: 'allow' }, stdio: ['ignore', 'pipe', 'inherit'] });
    await new Promise(r => server.stdout.once('data', r));
    try {
      const token = (await (await fetch(`http://127.0.0.1:${port}/`)).text()).match(/jevis-token" content="([a-f0-9]+)"/)[1];
      const body = await (await fetch(`http://127.0.0.1:${port}/api/run`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Jevis-Token': token }, body: JSON.stringify({ text: 'tarif: test-tarifi isim=API' }) })).text();
      const done = body.trim().split('\n').map(l => JSON.parse(l)).find(e => e.type === 'done');
      return { ok: done?.recipe === 'test-tarifi' && (await formState()).name === 'API', note: `${(done.ms / 1000).toFixed(1)} sn` };
    } finally {
      server.kill();
    }
  });
} finally {
  for (const n of ['test-tarifi', 'test-bozuk', 'test-dusunme']) deleteRecipe(n);
}

console.log(`\n${passed}/${total} geçti`);
process.exit(passed === total ? 0 : 1);
