// Handry · © 2026 Berat Olekli (purplefox) · github.com/purplefox21/handry
// End-to-end test of the browser hands against a local App Store Connect-like
// page, with real Chrome and real Jev. Usage: node tests/browser-e2e.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as b from '../hands/browser.js';

const FIXTURE = new URL('./fixtures/appstore-like.html', import.meta.url).href;
const PNG = path.join(os.tmpdir(), 'jevis-sample.png');
fs.writeFileSync(PNG, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));

const dom = async fn => (await b.activePage()).evaluate(fn);
const logHas = x => dom(() => window.__log).then(l => l.includes(x));

const steps = [
  ['Test sayfasını aç', () => b.open(FIXTURE), r => r.title.includes('App Store Connect')],
  ['"fiyatlandırma bölümü" (React div)', () => b.click('fiyatlandırma bölümü'), () => logHas('nav:pricing')],
  ['"uygulama adı" alanına yaz', () => b.type('uygulama adı', 'Jevis Test App'), () => dom(() => document.getElementById('name').value === 'Jevis Test App')],
  ['"alt başlık" (label yok, yan metin)', () => b.type('alt başlık', 'Sesli asistan'), () => dom(() => document.getElementById('subtitle').value === 'Sesli asistan')],
  ['"ana kategori" → Productivity (select)', () => b.select('ana kategori', 'Productivity'), () => dom(() => document.getElementById('cat1').value === 'Productivity')],
  ['"ikincil kategori" → Utilities (özel liste)', () => b.select('ikincil kategori', 'Utilities'), () => dom(() => document.getElementById('cat2').textContent === 'Utilities')],
  ['"fiyat" → "ücretsiz" (Türkçe → Free)', () => b.select('fiyat', 'ücretsiz'), () => dom(() => document.getElementById('price').value === 'Free')],
  ['"giriş gerekli" kutusu (gizli input)', () => b.check('giriş gerekli', true), () => dom(() => document.getElementById('signin').checked)],
  ['"otomatik yayınlama" anahtarı', () => b.check('otomatik yayınlama', true), () => dom(() => document.getElementById('autorelease').getAttribute('aria-checked') === 'true')],
  ['"yaş sınırı düzenle" (iki Edit var)', () => b.click('yaş sınırını düzenle'), async () => (await logHas('edit:age')) && !(await logHas('edit:content'))],
  ['Şiddet sorusu → None', () => b.check('şiddet sorusu için None', true), () => dom(() => document.querySelector('[name=violence][value=none]').checked && !document.querySelector('[name=gambling][value=none]').checked)],
  ['Kumar sorusu → None', () => b.check('kumar sorusu için None', true), () => dom(() => document.querySelector('[name=gambling][value=none]').checked)],
  ['"Done" ile pencereyi kapat', () => b.click('Done'), () => dom(() => document.getElementById('modal').hidden)],
  ['Ekran görüntüsü yükle (gizli input)', () => b.upload('ekran görüntüleri', PNG), () => logHas('upload:1')],
  ['iframe içindeki "çerezleri kabul et"', () => b.click('çerezleri kabul et'), () => logHas('cookies-accepted')],
  ['"Save" (onay: izin ver)', () => b.click('kaydet'), () => dom(() => document.getElementById('status').textContent === 'Changes saved.'), 'allow'],
  ['verify: değişiklikler kaydedildi', () => b.verify('değişiklikler kaydedildi mesajı görünüyor'), r => r.yes],
  ['verify: "Name is required" hatası var mı (hayır)', () => b.verify('sayfada "Name is required" hatası görünüyor'), r => !r.yes],
  ['"incelemeye gönder" (onay: reddet)', () => b.click('incelemeye gönder'), null, 'deny', e => e.code === 'DENIED'],
  ['"uygulamayı sil" (onay: reddet)', () => b.click('uygulamayı sil'), null, 'deny', e => e.code === 'DENIED'],
  ['Gönder/sil gerçekten yapılmadı', async () => dom(() => window.__log), l => !l.includes('submit') && !l.includes('delete')],
  ['Olmayan şey: "dark mode aç"', () => b.click('dark mode aç'), null, 'deny', e => e.code === 'NOT_FOUND' || e.code === 'LOW_CONFIDENCE'],
  ['"dokümantasyon" linki (yeni sekme)', () => b.click('dokümantasyon'), r => r.newTab && r.title === 'Handry Test Documentation'],
  ['Sekmeye geri dön', () => b.switchTab('App Store Connect'), r => r.title.includes('App Store Connect')],
  ['Dokümantasyon sekmesini kapat', () => b.closeTab('Documentation'), r => r.title === 'Handry Test Documentation'],
  ['read + "#id" ile yaz', async () => {
    const r = await b.read({ text: false });
    const name = r.elements.find(e => e.name === 'Name');
    return b.type(`#${name.id}`, 'Jevis 2');
  }, () => dom(() => document.getElementById('name').value === 'Jevis 2')],
  ['Kaydır', () => b.scroll('down', 300), r => r.scrollY >= 0]
];

let passed = 0;
const times = [];
for (const [name, run, check, confirm = 'deny', expectError] of steps) {
  process.env.JEVIS_TEST_CONFIRM = confirm;
  const started = Date.now();
  let ok = false;
  let note = '';
  try {
    const res = await run();
    ok = expectError ? false : Boolean(await check(res));
    if (expectError) note = 'hata bekleniyordu ama işlem yapıldı';
  } catch (err) {
    ok = expectError ? expectError(err) : false;
    note = `${err.code || ''} ${err.message}`.trim();
  }
  const ms = Date.now() - started;
  times.push(ms);
  if (ok) passed++;
  console.log(`${ok ? '✅' : '❌'} ${String(ms).padStart(5)} ms  ${name}${!ok || expectError ? `  → ${note}` : ''}`);
}
const avg = Math.round(times.slice(1).reduce((a, t) => a + t, 0) / (times.length - 1));
console.log(`\n${passed}/${steps.length} geçti · adım başına ortalama ${avg} ms (sayfa açma hariç)`);
process.exit(passed === steps.length ? 0 : 1);
