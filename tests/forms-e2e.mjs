// Harder web forms, from a real GoDaddy DNS session: a styled box over an
// invisible native <select>, custom lists next to a tree menu with the same
// names, #ids that must survive a failed action, a long page, and
// wait_for_user that notices when the user is done (or isn't).
// Usage: node tests/forms-e2e.mjs
import { callTool } from '../core/tools.js';
import * as browser from '../hands/browser.js';

const FIXTURE = new URL('./fixtures/dns-like.html', import.meta.url).href;
const LOGIN = new URL('./fixtures/login.html', import.meta.url).href;
const call = async (name, args) => {
  const r = await callTool(name, args);
  return { ...r, text: r.content.filter(c => c.type === 'text').map(c => c.text).join('\n') };
};
const page = async () => browser.activePage();
const log = async () => (await page()).evaluate(() => window.__log);

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

process.env.JEVIS_TEST_CONFIRM = 'allow';
await call('browser_open', { url: FIXTURE });

await check('Görünmez <select>li kutu [select] olarak, seçili değeriyle görünüyor', async () => {
  const r = await call('browser_read', { include_text: false });
  const line = r.text.split('\n').find(l => /Tür/.test(l) && /\[select\]/.test(l)) || '';
  return { ok: line && /value: A/.test(line) && !/AAAA/.test(r.text.replace(/value: [^}]*/g, '')), note: line || r.text.split('\n').filter(l => /A /.test(l)).slice(0, 2).join(' / ') };
});

await check('Kutunun içindeki gerçek <select> seçiliyor ("Tür" → CNAME)', async () => {
  const r = await call('browser_select', { target: 'Tür', option: 'CNAME' });
  const value = await (await page()).evaluate(() => document.getElementById('type').value);
  const l = await log();
  return { ok: !r.isError && value === 'CNAME' && !l.some(x => x.startsWith('tree:')), note: `${r.text.split('\n')[0]} · değer ${value}` };
});

await check('Özel liste: seçenek açılan listeden, yan menüden değil ("TTL" → 1 Gün)', async () => {
  const r = await call('browser_select', { target: 'TTL', option: '1 Gün' });
  const l = await log();
  return { ok: !r.isError && l.includes('ttl:1 Gün') && !l.includes('tree:1 Gün'), note: `${r.text.split('\n')[0]} · ${l.join(', ')}` };
});

await check('Sonradan oluşan menü: bağlantısız menüden seçiliyor ("Öncelik" → Yüksek)', async () => {
  const r = await call('browser_select', { target: 'Öncelik', option: 'Yüksek' });
  const l = await log();
  return { ok: !r.isError && l.includes('prio:Yüksek') && !l.includes('tree:Yüksek'), note: `${r.text.split('\n')[0]} · ${l.join(', ')}` };
});

await check('Başarısız bir seçimden sonra önceki #id\'ler aynı öğeyi gösteriyor', async () => {
  const r = await call('browser_read', { include_text: false });
  const saveId = r.text.match(/#(\S+) \[button\] Kaydet/)?.[1];
  await call('browser_select', { target: 'TTL', option: 'Olmayan seçenek 12345' });
  await (await page()).keyboard.press('Escape').catch(() => {});
  const c = await call('browser_click', { target: `#${saveId}` });
  const status = await (await page()).evaluate(() => document.getElementById('status').textContent);
  return { ok: saveId && !c.isError && status.startsWith('Kaydedildi'), note: `#${saveId} → ${status}` };
});

await check('Ekran dışı öğeler özetleniyor; all=true ile hepsi listeleniyor', async () => {
  await (await page()).evaluate(() => scrollTo(0, 0));
  const short = await call('browser_read', { include_text: false });
  const full = await call('browser_read', { include_text: false, all: true });
  const bottom = /Sayfanın en altındaki düğme/;
  return { ok: /ekran dışında \d+ öğe daha/.test(short.text) && !bottom.test(short.text) && bottom.test(full.text), note: short.text.split('\n').find(l => /ekran dışında/.test(l)) };
});

await check('Ekran dışındaki öğe listelenmese de adıyla tıklanabiliyor', async () => {
  const c = await call('browser_click', { target: 'Sayfanın en altındaki düğme' });
  return { ok: !c.isError && (await log()).includes('bottom'), note: c.text.split('\n')[0] };
});

await check('wait_for_user until_text: kullanıcı işi bitirince kendiliğinden devam', async () => {
  await call('browser_open', { url: `${FIXTURE}?login=1` });
  process.env.JEVIS_TEST_CONFIRM = 'watch'; // no dialog button; only the page can end the wait
  const r = await call('wait_for_user', { message: 'Giriş yap', until_text: 'Hoş geldin', timeout_sec: 10 });
  process.env.JEVIS_TEST_CONFIRM = 'allow';
  return { ok: !r.isError && /tamamladı/.test(r.text), note: r.text };
});

await check('wait_for_user: "Tamam"a basıldı ama sayfa hâlâ giriş istiyor → söylüyor', async () => {
  await call('browser_open', { url: LOGIN });
  const r = await call('wait_for_user', { message: 'Giriş yap' });
  return { ok: /hâlâ/.test(r.text), note: r.text };
});

console.log(`\n${passed}/${total} geçti`);
process.exit(passed === total ? 0 : 1);
