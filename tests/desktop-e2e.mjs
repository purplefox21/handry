// Desktop hands end to end through the tool layer: Calculator, TextEdit
// (menu, typing, "save changes?" dialog), safety checks, screenshot, and a
// read-only look at an Electron app. Opens and closes Calculator and TextEdit.
// Usage: node tests/desktop-e2e.mjs
import { callTool } from '../core/tools.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const call = async (name, args) => {
  const r = await callTool(name, args);
  return { ...r, text: r.content.filter(c => c.type === 'text').map(c => c.text).join('\n') };
};

let passed = 0;
let total = 0;
async function step(name, run, check) {
  total++;
  const started = Date.now();
  let ok = false;
  let note = '';
  try {
    const r = await run();
    ok = Boolean(await check(r));
    note = r?.text?.split('\n').slice(0, 2).join(' / ').slice(0, 150) || '';
  } catch (err) {
    note = err.message;
  }
  if (ok) passed++;
  console.log(`${ok ? '✅' : '❌'} ${String(Date.now() - started).padStart(5)} ms  ${name}${note ? `\n        ${note}` : ''}`);
}

process.env.JEVIS_TEST_CONFIRM = 'deny';

// Calculator: 12 + 30
await step('Hesap Makinesi\'ni Türkçe adıyla aç', () => call('desktop_open_app', { name: 'hesap makinesi' }), r => !r.isError && r.text.includes('Hesap Makinesi'));
await step('Temizle ("Tümünü Sil", onaysız geçmeli)', () => call('desktop_click', { target: 'Tümünü Sil', app: 'Hesap Makinesi' }), r => !r.isError);
for (const b of ['1', '2', 'Artı', '3', '0', 'Eşittir']) {
  await step(`bas: ${b}`, () => call('desktop_click', { target: b, app: 'Hesap Makinesi' }), r => !r.isError);
}
await step('Sonuç 42', () => call('desktop_read', { app: 'Hesap Makinesi' }), r => /\b42\b/.test(r.text.split('Metinler:')[1] || ''));
await step('cmd+q onaysız çalışmadı', () => call('desktop_key', { keys: 'cmd+q', app: 'Hesap Makinesi' }), r => r.isError && r.text.includes('izin vermedi'));
await step('Ekran görüntüsü (pencere)', () => callTool('desktop_screenshot', { app: 'Hesap Makinesi' }), r => r.content.some(c => c.type === 'image' && c.data.length > 2000));
await step('Hesap Makinesi\'ni kapat', () => call('desktop_quit_app', { name: 'Hesap Makinesi' }), r => r.text.includes('Kapatıldı'));

// TextEdit: new document through the window, menu action, typing, discard dialog
await step('TextEdit aç', () => call('desktop_open_app', { name: 'TextEdit' }), r => !r.isError && r.text.includes('TextEdit'));
await sleep(500);
// A fresh launch may show the open panel or restore windows; ⌘N always gives a new document.
await step('Yeni belge (⌘N)', async () => {
  await call('desktop_key', { keys: 'cmd+n', app: 'TextEdit' });
  await sleep(800);
  return call('desktop_read', { app: 'TextEdit' });
}, r => /Adsız|Untitled/.test(r.text.split('\n')[1] || ''));
await step('Belgeye yaz', () => call('desktop_type', { target: 'belge metin alanı', text: 'JEVIS masaüstü testi', app: 'TextEdit' }), r => !r.isError);
await step('Yazı metin alanında', () => call('desktop_read', { app: 'TextEdit' }), r => /\[TextArea\][^\n]*JEVIS masaüstü testi/.test(r.text));
await step('Menü öğesi: "Tümünü Seç" (menü açılmadan)', () => call('desktop_click', { target: 'Tümünü Seç', app: 'TextEdit' }), r => !r.isError && r.text.includes('Tümünü Seç'));
await sleep(500);
await step('Terminal koruması: odaktaki alana yazmak (TextEdit, sorulmamalı)', () => call('desktop_type', { text: ' +', app: 'TextEdit' }), r => !r.isError);
await step('Kapatmayı iste → "kaydedilsin mi?"', () => call('desktop_quit_app', { name: 'TextEdit' }), r => r.text.includes('kapanmadı'));
await sleep(500);
await step('Dialogun sorusu okunuyor', () => call('desktop_read', { app: 'TextEdit' }), r => /tutmak istiyor musunuz|Do you want to keep/.test(r.text));
await step('"Sil" onaysız çalışmadı', () => call('desktop_click', { target: 'Sil', app: 'TextEdit' }), r => r.isError && r.text.includes('izin vermedi'));
process.env.JEVIS_TEST_CONFIRM = 'allow';
await step('"Sil" onayla → belge silindi, TextEdit kapandı', async () => {
  const r = await call('desktop_click', { target: 'Sil', app: 'TextEdit' });
  await sleep(1500);
  const apps = await call('desktop_apps', {});
  return { ...r, closed: !apps.text.includes('TextEdit (') };
}, r => !r.isError && r.closed);
process.env.JEVIS_TEST_CONFIRM = 'deny';

// Electron app, read only
await step('VS Code (Electron) penceresini oku', () => call('desktop_read', { app: 'Code' }), r => !r.isError && r.text.includes('Öğeler ('));

console.log(`\n${passed}/${total} geçti`);
process.exit(passed === total ? 0 : 1);
