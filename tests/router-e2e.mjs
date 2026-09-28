// Fast path v2: does Jev send simple commands down the fast path (and the
// right one) and everything else to the brain? Decisions only, nothing runs.
// Usage: node tests/router-e2e.mjs
import { classify } from '../core/router.js';

const CASES = [
  ['sesi yüzde 30 yap', 'volume'], ['Sesi yüzde 30 yap', 'volume'], ['sesi biraz kıs', 'volume'], ['sesi aç biraz', 'volume'], ['sesi sonuna kadar aç', 'volume'],
  ['sessize al', 'mute'], ['sesi geri aç', 'mute'],
  ['sonraki şarkı', 'music'], ['müziği durdur', 'music'], ['şarkıyı başa sar önceki şarkıya geç', 'music'],
  ['şu an hangi şarkı çalıyor', 'now_playing'],
  ["Spotify'da Tarkan çal", 'spotify_play'], ['beğendiğim şarkıları çal', 'spotify_play'], ['Space Echo listemi çal', 'spotify_play'],
  ['not al: yarın kargo gelecek', 'note_add'], ['notlarıma süt almayı ekle', 'note_add'],
  ['bugün takvimimde ne var', 'calendar_show'], ['yarın ne işim var takvimde', 'calendar_show'],
  ['hatırlatıcılarımda ne var', 'reminders_show'],
  ["yarın saat 9'da annemi aramayı hatırlat", 'needs_brain'], ['cuma 3te toplantı ekle takvime', 'needs_brain'],
  ['spotify uygulamasına gir', 'app_open'], ["Spotify'ı aç", 'app_open'], ['claude uygulamasını aç', 'app_open'], ["VS Code'a geç", 'app_open'], ['hesap makinesini aç', 'app_open'],
  ['hesap makinesini kapat', 'app_quit'], ["Xcode'u kapat", 'app_quit'],
  ["YouTube'u aç", 'web_open'], ["github.com'a git", 'web_open'],
  ["Google'da mac mini fiyatları ara", 'web_search'], ["YouTube'da lofi müzik ara", 'web_search'],
  ['karanlık moda geç', 'dark_mode'], ['ekranı kilitle', 'lock_screen'], ['ekran görüntüsü al', 'screenshot'],
  ["Hacker News'i aç ve ilk 5 başlığı özetle", 'needs_brain'],
  ["WhatsApp'ta Ali'ye geliyorum yaz", 'needs_brain'],
  ["masaüstümdeki son açılan projeleri söyle", 'needs_brain'],
  ["App Store Connect'te fiyatı ücretsiz yap ve kaydet", 'needs_brain'],
  ["jev klasörünü VS Code'da aç ve Claude sekmesine selam yaz", 'needs_brain']
];

let ok = 0;
const times = [];
for (const [command, expected] of CASES) {
  const { route, confidence, ms } = await classify(command);
  const fast = route !== 'needs_brain' && confidence >= 0.6;
  const good = expected === 'needs_brain' ? !fast : fast && route === expected;
  if (good) ok++;
  times.push(ms);
  console.log(`${good ? '✅' : '❌'} ${String(ms).padStart(4)} ms  %${String(Math.round(confidence * 100)).padStart(3)} ${route.padEnd(12)} ← "${command}"${good ? '' : `  (beklenen: ${expected})`}`);
}
console.log(`\n${ok}/${CASES.length} doğru · ortalama ${Math.round(times.reduce((a, b) => a + b, 0) / times.length)} ms`);
process.exit(ok === CASES.length ? 0 : 1);
