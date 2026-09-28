// Harder desktop cases through the tool layer: a Chromium app (Spotify) read
// through its accessibility switch, clicking by screenshot pixels
// (Calculator), waiting for text, and switching between two windows of one
// app (TextEdit). Opens and closes Calculator and TextEdit; Spotify is only
// read. Usage: node tests/apps-e2e.mjs
import { callTool } from '../core/tools.js';
import { loadState } from '../core/config.js';
import * as desktop from '../hands/desktop.js';

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
    note = r?.text?.split('\n').slice(0, 2).join(' / ').slice(0, 160) || '';
  } catch (err) {
    note = err.message;
  }
  if (ok) passed++;
  console.log(`${ok ? '✅' : '❌'} ${String(Date.now() - started).padStart(5)} ms  ${name}${note ? `\n        ${note}` : ''}`);
}

process.env.JEVIS_TEST_CONFIRM = 'deny';
const startedIn = (await desktop.frontmost()).app;

// Spotify (Chromium): controls only show up after the accessibility switch.
if (desktop.installedApps().includes('Spotify')) {
  await step('Spotify uygulamasını aç', () => call('desktop_open_app', { name: 'Spotify' }), r => !r.isError && r.text.includes('Spotify'));
  await sleep(1000);
  await step('Spotify düğmeleri okunuyor (Chromium)', () => call('desktop_read', { app: 'Spotify' }), r => {
    const named = (r.text.match(/^#d\d+ \[\w+\] (?!\(isimsiz\))/gm) || []).length;
    r.text = `${named} isimli öğe · ${r.text.split('\n').find(l => /Ara|Search/.test(l)) || ''}`;
    return !r.isError && named >= 20;
  });
  await step('Spotify arama kutusu Jev ile bulunuyor (yazmadan)', async () => {
    const r = await desktop.read({ app: 'Spotify' });
    const labels = r.elements.map(desktop.labelOf);
    const { pickElement, isConfident } = await import('../core/jev.js');
    const pick = await pickElement('Type text into: arama kutusu (ne çalmak istiyorsun)', labels, { app: r.app, window: r.window });
    return { text: `${labels[pick.index]} (%${Math.round(pick.confidence * 100)})`, ok: pick.index !== null && isConfident(pick) && /ComboBox|TextField/.test(labels[pick.index]) };
  }, r => r.ok);
}

// Calculator: click by screenshot pixels
await step('Hesap Makinesi aç', () => call('desktop_open_app', { name: 'Hesap Makinesi' }), r => !r.isError);
await sleep(800); // coming back from Spotify's full-screen space
const display = async () => ((await desktop.read({ app: 'Hesap Makinesi' })).texts.at(-1) || '').replace(/[^\d,.-]/g, '');
await step('Temizle (Esc)', async () => {
  await call('desktop_key', { keys: 'escape', app: 'Hesap Makinesi' });
  await call('desktop_key', { keys: 'escape', app: 'Hesap Makinesi' });
  return { text: `ekran: ${await display()}` };
}, r => r.text === 'ekran: 0');
const shot = await callTool('desktop_screenshot', { app: 'Hesap Makinesi' });
await step('Ekran görüntüsü piksel boyutunu söylüyor', async () => ({ text: shot.content.find(c => c.type === 'text').text }), r => /\d+×\d+ piksel/.test(r.text));

// Where the "7" key is in the picture: its screen spot, mapped with the saved shot.
const seven = (await desktop.read({ app: 'Hesap Makinesi' })).elements.find(e => e.role === 'Button' && e.name === '7');
const { area, image } = loadState().shot;
const px = Math.round(((seven.x + seven.w / 2 - area.x) * image.w) / area.w);
const py = Math.round(((seven.y + seven.h / 2 - area.y) * image.h) / area.h);
await step(`Görüntüde (${px}, ${py}) → "7" tuşuna tıkla`, () => call('desktop_click_at', { x: px, y: py, description: '7 tuşu' }), r => !r.isError && r.text.includes('[Button] 7'));
await step('Ekranda 7 yazıyor', async () => ({ text: `ekran: ${await display()}` }), r => r.text === 'ekran: 7');
await step('Riskli açıklama sorulur, reddedilince tıklanmaz', () => call('desktop_click_at', { x: px, y: py, description: 'Satın Al düğmesi' }), r => r.isError && r.text.includes('izin vermedi'));
await step('Hâlâ 7 (reddedilen tıklama olmadı)', async () => ({ text: `ekran: ${await display()}` }), r => r.text === 'ekran: 7');
for (const b of ['Artı', '5', 'Eşittir']) await call('desktop_click', { target: b, app: 'Hesap Makinesi' });
await step('Sonuç 12 bekleniyor (desktop_wait)', () => call('desktop_wait', { text: '12', app: 'Hesap Makinesi', seconds: 3 }), r => !r.isError && r.text.includes('Göründü'));
await step('Görüntü dışı nokta reddedilir', () => call('desktop_click_at', { x: 99999, y: 5, description: 'dışarısı' }), r => r.isError && r.text.includes('dışında'));
await step('Olmayan yazı için bekleme zaman aşımı', () => call('desktop_wait', { text: 'hiç olmayacak yazı', app: 'Hesap Makinesi', seconds: 1 }), r => r.isError && r.text.includes('görünmedi'));
await step('"gone" beklemesi hemen döner', () => call('desktop_wait', { text: 'hiç olmayacak yazı', app: 'Hesap Makinesi', gone: true }), r => !r.isError && r.text.includes('Kayboldu'));
await step('Hesap Makinesi kapat', () => call('desktop_quit_app', { name: 'Hesap Makinesi' }), r => r.text.includes('Kapatıldı'));

// TextEdit: two windows, switch between them
await step('TextEdit aç', () => call('desktop_open_app', { name: 'TextEdit' }), r => !r.isError);
await sleep(500);
// A fresh launch may show the open panel; new documents until there are two.
const documents = async () => (await desktop.windows('TextEdit')).windows.filter(w => /Adsız|Untitled/.test(w.title));
for (let i = 0; i < 4 && (await documents()).length < 2; i++) {
  await call('desktop_key', { keys: 'cmd+n', app: 'TextEdit' });
  await sleep(700);
}
let titles = [];
await step('İki belge penceresi listeleniyor', async () => {
  const r = await call('desktop_windows', { app: 'TextEdit' });
  titles = await documents();
  return r;
}, () => titles.length >= 2);
const back = titles.find(w => !w.focused);
await step(`Arkadaki pencereye geç: "${back?.title}"`, () => call('desktop_focus_window', { app: 'TextEdit', window: back.title }), async r => !r.isError && (await desktop.frontmost()).window === back.title);
await step('Numarayla geri geç', async () => {
  const other = (await desktop.windows('TextEdit')).windows.find(w => !w.focused && /Adsız|Untitled/.test(w.title));
  const r = await call('desktop_focus_window', { app: 'TextEdit', window: String(other.index) });
  return { ...r, ok: (await desktop.frontmost()).window === other.title };
}, r => !r.isError && r.ok);
await step('TextEdit kapat (boş belgeler sormadan kapanır)', () => call('desktop_quit_app', { name: 'TextEdit' }), r => r.text.includes('Kapatıldı'));

// VS Code: one window per project
await step('VS Code pencereleri listeleniyor', () => call('desktop_windows', { app: 'Code' }), r => !r.isError && r.text.includes('pencereleri'));

await desktop.activate(startedIn).catch(() => {});
console.log(`\n${passed}/${total} geçti`);
process.exit(passed === total ? 0 : 1);
