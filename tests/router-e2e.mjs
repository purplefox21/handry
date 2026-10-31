// Handry · © 2026 Berat Olekli (purplefox) · github.com/purplefox21/handry
// Fast path v2: does Jev send simple commands down the fast path (and the
// right one) and everything else to the brain? Decisions only, nothing runs.
// Turkish commands, then English ones (with JEVIS_LANG=en).
// Usage: node tests/router-e2e.mjs
import { classify, goesFast } from '../core/router.js';

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
  ["jev klasörünü VS Code'da aç ve Claude sekmesine selam yaz", 'needs_brain'],
  // Talk is not a command (from a real chat, 2026-10-01: these used to lock the screen or get acted on)
  ['selam', 'needs_brain'], ['anlamadın sanırım cümleyi okumadın', 'needs_brain'], ['bro son mesajlarımda ne anlattım sana', 'needs_brain'],
  ['neler yapabilirsin', 'needs_brain'], ['böyle bir becerin var mı', 'needs_brain'], ['hayır öyle demedim', 'needs_brain'],
  ["saat 3'te ekranı kilitle", 'needs_brain'], ['işler bitince haber ver', 'needs_brain'],
  ['bunu bir daha yap', 'needs_brain'], ['aynısını yap', 'needs_brain'], ['tekrar dene', 'needs_brain']
];

const EN_CASES = [
  ['set the volume to 30%', 'volume'], ['turn it down a bit', 'volume'], ['mute', 'mute'],
  ['next song', 'music'], ['pause the music', 'music'], ['what song is this', 'now_playing'],
  ['play Taylor Swift on Spotify', 'spotify_play'], ['take a note: the package comes tomorrow', 'note_add'],
  ["what's on my calendar today", 'calendar_show'], ['open Safari', 'app_open'], ['quit Xcode', 'app_quit'],
  ['open YouTube', 'web_open'], ['search Google for mac mini prices', 'web_search'],
  ['switch to dark mode', 'dark_mode'], ['lock the screen', 'lock_screen'], ['take a screenshot', 'screenshot'],
  ['open Hacker News and summarize the top 5 stories', 'needs_brain'],
  // later, talk and answers are not commands for now
  ['lock the screen at 3', 'needs_brain'], ['remind me in 10 minutes to stretch', 'needs_brain'],
  ['hi there', 'needs_brain'], ['what can you do', 'needs_brain'], ["no, that's not what I meant", 'needs_brain'],
  ['do that again', 'needs_brain'], ['try again', 'needs_brain']
];

let ok = 0;
const times = [];
for (const [command, expected, language] of [...CASES, ...EN_CASES.map(c => [...c, 'en'])]) {
  if (language) process.env.JEVIS_LANG = language;
  const decision = await classify(command);
  const { route, confidence, ms, intent } = decision;
  const fast = goesFast(decision);
  const good = expected === 'needs_brain' ? !fast : fast && route === expected;
  if (good) ok++;
  times.push(ms);
  console.log(`${good ? '✅' : '❌'} ${String(ms).padStart(4)} ms  %${String(Math.round(confidence * 100)).padStart(3)} ${route.padEnd(12)} ${intent.padEnd(8)} ← "${command}"${good ? '' : `  (beklenen: ${expected})`}`);
}
const all = CASES.length + EN_CASES.length;
console.log(`\n${ok}/${all} doğru (${CASES.length} Türkçe, ${EN_CASES.length} İngilizce) · ortalama ${Math.round(times.reduce((a, b) => a + b, 0) / times.length)} ms`);
process.exit(ok === all ? 0 : 1);
