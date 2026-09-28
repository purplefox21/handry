// Learned tasks end to end: a brain run is learned with its details as
// variables, the same task with other details replays without the brain,
// other tasks and questions still go to the brain, invented texts are not
// learned, a failing learned task hands off and is forgotten after two misses.
// Uses a stand-in brain that calls the JEVIS tools the way Claude would, a
// throwaway JEVIS home, and the JEVIS Chrome with the test form.
// Usage: node tests/learn-e2e.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.JEVIS_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'jevis-learn-'));
process.env.JEVIS_TEST_CONFIRM = 'allow';
const { runCommand } = await import('../core/runner.js');
const { callTool } = await import('../core/tools.js');
const browser = await import('../hands/browser.js');
const { listLearned, learnFromRun } = await import('../core/learn.js');
const { LEARNED_DIR } = await import('../core/recipes.js');

const FIXTURE = new URL('./fixtures/appstore-like.html', import.meta.url).href;
const formState = async () => (await browser.activePage()).evaluate(() => ({
  name: document.getElementById('name').value,
  price: document.getElementById('price').value,
  status: document.getElementById('status').textContent
}));

// Does the task with the JEVIS tools, like Claude would, and counts its calls.
function standInBrain(doTask) {
  const brain = { id: 'test', label: 'Test beyni', calls: 0, run: async () => { brain.calls++; return doTask(); } };
  return brain;
}
const fillForm = (name, price) => async () => {
  await callTool('browser_open', { url: FIXTURE });
  await callTool('browser_read', { include_text: false });
  await callTool('browser_type', { target: 'Name', text: name });
  await callTool('browser_select', { target: 'Price', option: price });
  await callTool('browser_click', { target: 'Save' });
  return { text: `Adı "${name}" yaptım, fiyatı ${price} seçtim ve kaydettim.`, sessionId: 's' };
};
const run = (text, brain) => runCommand({ text, brainId: 'claude-code', onEvent: () => {}, brainOverride: brain });

let passed = 0;
let total = 0;
async function check(name, fn) {
  total++;
  const started = Date.now();
  let ok = false;
  let note = '';
  try { const r = await fn(); ok = Boolean(r?.ok ?? r); note = r?.note || ''; } catch (err) { note = err.message; }
  if (ok) passed++;
  console.log(`${ok ? '✅' : '❌'} ${String(Date.now() - started).padStart(6)} ms  ${name}${note ? `\n          → ${note}` : ''}`);
}

try {
  await check('Claude\'un yaptığı iş öğreniliyor (ad ve fiyat değişken)', async () => {
    const brain = standInBrain(fillForm('Kuzey Işığı', '$1.99'));
    const out = await run('Test formunda uygulama adını "Kuzey Işığı" yap, fiyatı $1.99 seç ve kaydet', brain);
    const learned = listLearned();
    return { ok: brain.calls === 1 && out.learned?.pattern?.includes('[x1]') && out.learned.pattern.includes('[x2]') && learned.length === 1, note: out.learned?.pattern || out.learned?.skipped };
  });

  await check('Aynı iş başka ayrıntılarla: Claude\'suz tekrar oynatılıyor', async () => {
    const brain = standInBrain(() => { throw new Error('beyne gitmemeliydi'); });
    const out = await run('Test formunda uygulama adını "Mavi Deniz" yap, fiyatı $4.99 seç ve kaydet', brain);
    const s = await formState();
    return { ok: brain.calls === 0 && out.learnedReplay && out.ok && s.name === 'Mavi Deniz' && s.price === '$4.99' && s.status === 'Changes saved.', note: `${(out.ms / 1000).toFixed(1)} sn · ${JSON.stringify(s)}` };
  });

  await check('Farklı bir iş öğrenilmiş yoldan yapılmıyor, Claude\'a gidiyor', async () => {
    const brain = standInBrain(async () => ({ text: 'Tamam.', sessionId: 's' }));
    const out = await run('Test formunda yaş derecelendirmesini düzenle ve şiddet için Yok seç', brain);
    return { ok: brain.calls === 1 && !out.learnedReplay, note: out.learned?.skipped };
  });

  await check('Soru/bilgi isteği öğrenilmiyor', async () => {
    const brain = standInBrain(async () => {
      await callTool('browser_open', { url: FIXTURE });
      await callTool('browser_read', {});
      return { text: 'Fiyat alanında şu an "Choose price" yazıyor.', sessionId: 's' };
    });
    const out = await run('Test formunda fiyat alanında ne yazıyor, söyler misin', brain);
    return { ok: !out.learned?.name && Boolean(out.learned?.skipped), note: out.learned?.skipped };
  });

  await check('Claude\'un kendi uydurduğu metin öğrenilmiyor', async () => {
    const brain = standInBrain(async () => {
      await callTool('browser_open', { url: FIXTURE });
      await callTool('browser_type', { target: 'Name', text: 'Yıldız Tozu' });
      return { text: 'Uygulamaya "Yıldız Tozu" adını verdim ve yazdım.', sessionId: 's' };
    });
    const out = await run('Test formunda uygulamaya güzel bir isim uydur ve ad alanına yaz', brain);
    return { ok: out.learned?.skipped === 'yazılan metni Claude kendisi yazmış', note: out.learned?.skipped || out.learned?.pattern };
  });

  await check('Aynı iş yeniden öğrenilince kopya oluşmuyor', async () => {
    process.env.JEVIS_RUN_ID = 'test-learn-again';
    const done = await fillForm('Gece Mavisi', '$0.99')();
    delete process.env.JEVIS_RUN_ID;
    const res = await learnFromRun({ command: 'Test formunda uygulama adını "Gece Mavisi" yap, fiyatı $0.99 seç ve kaydet', runId: 'test-learn-again', answer: done.text });
    return { ok: res.updated === true && listLearned().length === 1, note: res.recipe?.pattern || res.skipped };
  });

  await check('Öğrenilen yol takılınca Claude devralıyor; iki kez olmazsa unutuluyor', async () => {
    const [learned] = listLearned();
    const file = path.join(LEARNED_DIR, `${learned.name}.json`);
    learned.steps = learned.steps.map(s => (s.args?.target === 'Save' ? { ...s, args: { target: 'Olmayan Buton XYZ' } } : s));
    fs.writeFileSync(file, JSON.stringify(learned, null, 2));
    const brain = standInBrain(async () => ({ text: 'Kalanını ben yaptım.', sessionId: 's' }));
    const first = await run('Test formunda uygulama adını "Deneme" yap, fiyatı Free seç ve kaydet', brain);
    const afterFirst = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')).fails : null;
    const second = await run('Test formunda uygulama adını "Deneme 2" yap, fiyatı Free seç ve kaydet', brain);
    return { ok: first.learnedReplay && first.brain === 'test' && afterFirst === 1 && second.learnedReplay && brain.calls === 2 && !fs.existsSync(file), note: `hata sayısı ${afterFirst}, dosya ${fs.existsSync(file) ? 'duruyor' : 'silindi'}` };
  });
} finally {
  fs.rmSync(process.env.JEVIS_HOME, { recursive: true, force: true });
}

console.log(`\n${passed}/${total} geçti`);
process.exit(passed === total ? 0 : 1);
