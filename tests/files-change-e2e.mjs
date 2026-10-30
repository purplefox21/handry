// Changing files through the tools: new folder, move / rename, copy, to the
// Trash, undo; the places that are refused; the questions asked first (and
// "no" meaning nothing happens); no screen touches while a confirmation
// dialog is open; and the action log saying who did what. Works in a
// throwaway folder (~/Library/Caches/jevis-files-change-*) and a throwaway
// Handry home; the dialogs are answered by the test (JEVIS_TEST_CONFIRM), so
// nothing shows on screen. Things sent to the Trash are taken back out.
// Usage: node tests/files-change-e2e.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.homedir(), 'Library', 'Caches', 'jevis-files-change-'));
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'jevis-files-home-'));
const asked = path.join(home, 'asked.log');
Object.assign(process.env, { JEVIS_HOME: home, JEVIS_FILES_TEST_ROOT: root, JEVIS_TEST_CONFIRM: 'allow', JEVIS_TEST_CONFIRM_LOG: asked, JEVIS_RUN_ID: 'mcp-test', JEVIS_CALLER: 'Test · dosyalar' });
const { callTool } = await import('../core/tools.js');
const { dialogOpen } = await import('../guard/confirm.js');

const at = (...p) => path.join(root, ...p);
const exists = p => fs.existsSync(p);
const write = (p, text = 'merhaba') => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
const call = async (name, args) => { const r = await callTool(name, args); return { error: Boolean(r.isError), text: r.content.map(c => c.text).join('\n') }; };
const questions = () => { try { return fs.readFileSync(asked, 'utf-8').trim().split('\n').filter(Boolean).length; } catch { return 0; } };

let passed = 0;
let total = 0;
async function check(name, fn) {
  total++;
  const started = Date.now();
  let ok = false;
  let note = '';
  try { const r = await fn(); ok = r && typeof r === 'object' && 'ok' in r ? Boolean(r.ok) : Boolean(r); note = r?.note || ''; } catch (err) { note = err.stack || err.message; }
  if (ok) passed++;
  console.log(`${ok ? '✅' : '❌'} ${String(Date.now() - started).padStart(6)} ms  ${name}${note ? `\n          → ${String(note).split('\n').slice(0, 4).join('\n            ')}` : ''}`);
}

try {
  await check('Klasör oluşturuluyor; geri alınca kalkıyor', async () => {
    const r = await call('files_make_folder', { path: at('Faturalar 2026') });
    const made = exists(at('Faturalar 2026'));
    const u = await call('files_undo', {});
    return { ok: !r.error && made && !u.error && !exists(at('Faturalar 2026')), note: `${r.text} · ${u.text}` };
  });

  await check('Taşıma ve yeniden adlandırma; geri al eski yerine koyuyor', async () => {
    write(at('a.txt'));
    fs.mkdirSync(at('Arşiv'));
    const m = await call('files_move', { from: at('a.txt'), to: at('Arşiv') });
    const moved = exists(at('Arşiv', 'a.txt')) && !exists(at('a.txt'));
    const r = await call('files_move', { from: at('Arşiv', 'a.txt'), to: at('Arşiv', 'b.txt') });
    const renamed = exists(at('Arşiv', 'b.txt'));
    await call('files_undo', {});
    const back1 = exists(at('Arşiv', 'a.txt'));
    await call('files_undo', {});
    return { ok: !m.error && moved && !r.error && renamed && back1 && exists(at('a.txt')), note: m.text.split('\n')[1] };
  });

  await check('Üstüne yazmıyor (taşıma da kopyalama da)', async () => {
    write(at('Arşiv', 'a.txt'), 'eski');
    const m = await call('files_move', { from: at('a.txt'), to: at('Arşiv') });
    const c = await call('files_copy', { from: at('a.txt'), to: at('Arşiv') });
    return { ok: m.error && c.error && /aynı adla/.test(m.text) && fs.readFileSync(at('Arşiv', 'a.txt'), 'utf-8') === 'eski', note: m.text };
  });

  await check('Kopyalama; geri alınca kopya Çöp Sepeti\'ne gidiyor, asıl yerinde', async () => {
    const c = await call('files_copy', { from: at('a.txt'), to: at('kopya.txt') });
    const copied = exists(at('kopya.txt'));
    const u = await call('files_undo', {});
    return { ok: !c.error && copied && !u.error && !exists(at('kopya.txt')) && exists(at('a.txt')), note: u.text };
  });

  await check('Tek dosya sormadan Çöp Sepeti\'ne; geri al geri getiriyor', async () => {
    const before = questions();
    const t = await call('files_trash', { paths: at('a.txt') });
    const gone = !exists(at('a.txt'));
    const u = await call('files_undo', {});
    return { ok: !t.error && gone && questions() === before && exists(at('a.txt')), note: `${t.text.split('\n')[0]} · ${u.text}` };
  });

  await check('Klasörü çöpe atmak önce soruyor; "hayır" deyince hiçbir şey olmuyor', async () => {
    write(at('Proje', '.git', 'HEAD'), 'ref');
    write(at('Proje', 'kod.js'), 'x');
    process.env.JEVIS_TEST_CONFIRM = 'deny';
    const before = questions();
    const t = await call('files_trash', { paths: at('Proje') });
    process.env.JEVIS_TEST_CONFIRM = 'allow';
    const question = fs.readFileSync(asked, 'utf-8').trim().split('\n').at(-1);
    return { ok: t.error && /izin vermedi/.test(t.text) && questions() === before + 1 && exists(at('Proje', 'kod.js')) && /git projesi/.test(question), note: JSON.parse(question).split('\n')[0] };
  });

  await check('"evet" deyince klasör Çöp Sepeti\'ne gidiyor; geri al geri getiriyor', async () => {
    const t = await call('files_trash', { paths: at('Proje') });
    const gone = !exists(at('Proje'));
    const u = await call('files_undo', {});
    return { ok: !t.error && gone && exists(at('Proje', 'kod.js')) && exists(at('Proje', '.git', 'HEAD')), note: u.text };
  });

  await check('Git projesini taşımak da soruyor', async () => {
    const before = questions();
    const m = await call('files_move', { from: at('Proje'), to: at('Arşiv') });
    await call('files_undo', {});
    return { ok: !m.error && questions() === before + 1 && exists(at('Proje', 'kod.js')) };
  });

  await check('Yasak yerler reddediliyor: ev dışı, Library, gizli klasör, ana klasörler, asistanın kendi projesi', async () => {
    const tries = [
      ['files_trash', { paths: '/etc/hosts' }],
      ['files_trash', { paths: '~/Library/Preferences' }],
      ['files_make_folder', { path: '~/.ssh/deneme' }],
      ['files_trash', { paths: '~/Desktop' }],
      ['files_move', { from: '~/Downloads', to: at('x') }],
      ['files_trash', { paths: new URL('..', import.meta.url).pathname }]
    ];
    const results = [];
    for (const [name, args] of tries) results.push(await call(name, args));
    return { ok: results.every(r => r.error), note: results.map(r => r.text.split('\n')[0]).join(' | ') };
  });

  await check('Onay penceresi açıkken masaüstüne dokunulamıyor', async () => {
    fs.writeFileSync(path.join(home, 'confirming.json'), JSON.stringify({ pid: process.pid, until: Date.now() + 60000 }));
    const open = dialogOpen();
    const click = await call('desktop_click', { target: 'Evet' });
    const key = await call('desktop_key', { keys: 'return' });
    fs.rmSync(path.join(home, 'confirming.json'));
    return { ok: open && click.error && key.error && /onay penceresi açık/.test(click.text) && !dialogOpen(), note: click.text };
  });

  await check('Kayıtta kim, ne, sonuç yazıyor (yapay zekâ değil kod yazıyor)', async () => {
    const file = path.join(home, 'logs', `${new Date().toISOString().slice(0, 10)}.jsonl`);
    const entries = fs.readFileSync(file, 'utf-8').trim().split('\n').map(l => JSON.parse(l));
    const trash = entries.find(e => e.tool === 'files_trash' && e.ok);
    const denied = entries.find(e => e.tool === 'files_trash' && !e.ok && /izin vermedi/.test(e.summary));
    return { ok: entries.every(e => e.who === 'Test · dosyalar') && trash && denied, note: `${entries.length} kayıt · ${trash.ts.slice(11, 19)} ${trash.who}: ${trash.tool} ${JSON.stringify(trash.args).slice(0, 60)}` };
  });
} finally {
  // Anything the test still has in the Trash comes back out, then the folder goes.
  try {
    for (const line of fs.readFileSync(path.join(home, 'files-journal.jsonl'), 'utf-8').trim().split('\n')) {
      const e = JSON.parse(line);
      for (const [, t] of e.op === 'trash' ? e.pairs : []) if (fs.existsSync(t)) fs.rmSync(t, { recursive: true, force: true });
    }
  } catch {}
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
}

console.log(`\n${passed}/${total} geçti`);
process.exit(passed === total ? 0 : 1);
