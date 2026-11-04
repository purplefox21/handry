// Handry · © 2026 Berat Olekli (purplefox) · github.com/purplefox21/handry
// Handry without Jev: the same judgments made here, with words and rules, for
// people who have no Jev key (core/jev.js switches to these by itself; see
// jevOff there). Quick and free, but plainer than Jev:
// - an element or option is found by its words (Turkish and English words for
//   the same button count as the same); when it isn't clear, the candidates go
//   back to the brain, which picks one by #id;
// - "is it risky?" is a word list, so the user is asked a little more often;
// - the fast path knows the common commands by rules; anything else goes to
//   the brain;
// - "does the page show it?" checks that the words are on the page;
// - the page guard hides text with well-known prompt-injection phrases and
//   notices login, code and CAPTCHA pages by their words.
import { T } from './i18n.js';

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/** Lower case, without accents or punctuation, and without Turkish endings after an apostrophe ("Kaydet'e" → "kaydet"). */
export function fold(text) {
  return String(text || '')
    .replace(/['’]\p{L}+/gu, '')
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
const words = text => fold(text).split(' ').filter(Boolean);

// Words that say what kind of thing it is or how to use it, not which one.
const FILLER = new Set(words(`
  click press tap choose select pick open the a an on in into to of for at with button link tab field box checkbox
  radio menu item option icon switch toggle dropdown list entry please type text enter upload file using
  tikla tıkla bas sec seç ac aç dugme düğme dugmesi düğmesi dugmesine düğmesine buton butonu butonuna link linki linkine
  baglanti bağlantı baglantisi bağlantısı sekme sekmesi sekmesine alan alani alanı alanina alanına kutu kutusu kutusuna
  kutucuk kutucugu kutucuğu menu menü menusu menüsü secenek seçenek secenegi seçeneği ikon ikonu simge simgesi
  lutfen lütfen yaz gir yukle yükle bir su şu bu o ve ile icin için bolum bölüm bolumu bölümü bolumune bölümüne kismi kısmı
  section area part sayfa sayfasi sayfası page soru sorusu sorusunun sorusuna sorusunda question
`));

// Turkish and English words for the same thing on a screen.
const SAME = [
  ['kaydet', 'save'], ['iptal', 'vazgec', 'cancel'], ['tamam', 'ok', 'okay', 'done', 'bitti'], ['evet', 'yes'], ['hayir', 'no'],
  ['gonder', 'send', 'submit'], ['sil', 'delete', 'remove', 'kaldir'], ['duzenle', 'edit'], ['ekle', 'add'], ['yeni', 'new', 'create', 'olustur'],
  ['ara', 'arama', 'search'], ['bul', 'find'], ['giris', 'signin', 'login', 'oturum'], ['cikis', 'signout', 'logout'], ['kaydol', 'signup', 'register'],
  ['ayarlar', 'ayar', 'settings', 'preferences', 'tercihler'], ['devam', 'continue', 'ileri', 'next'], ['geri', 'back', 'onceki', 'previous'],
  ['kapat', 'close'], ['ac', 'open'], ['ucretsiz', 'free'], ['fiyat', 'price'], ['fiyatlandirma', 'pricing'], ['yukle', 'upload'], ['indir', 'download'],
  ['paylas', 'share'], ['yayinla', 'publish'], ['onayla', 'confirm'], ['uygula', 'apply'], ['guncelle', 'update'], ['yenile', 'refresh', 'reload'],
  ['anasayfa', 'home'], ['profil', 'profile'], ['hesap', 'account'], ['sifre', 'parola', 'password'], ['eposta', 'email', 'mail'],
  ['kullanici', 'user', 'username'], ['ad', 'adi', 'isim', 'name'], ['aciklama', 'description'], ['kategori', 'category'], ['dil', 'language'],
  ['yardim', 'help'], ['bildirimler', 'bildirim', 'notifications'], ['mesajlar', 'mesaj', 'messages', 'message'], ['sepet', 'cart', 'basket'],
  ['satin', 'buy', 'purchase'], ['ode', 'pay'], ['odeme', 'payment', 'checkout'], ['siparis', 'order'], ['begen', 'like'], ['takip', 'follow'],
  ['yorum', 'comment'], ['yanitla', 'cevapla', 'reply'], ['sec', 'select', 'choose'], ['hepsi', 'tumu', 'all'], ['goster', 'show'], ['gizle', 'hide'],
  ['dosya', 'file'], ['klasor', 'folder'], ['resim', 'gorsel', 'image', 'picture', 'photo', 'fotograf'], ['oynat', 'cal', 'play'],
  ['duraklat', 'pause'], ['durdur', 'stop'], ['sonraki', 'next'], ['gizlilik', 'privacy'], ['sartlar', 'terms'], ['yas', 'age'], ['sinir', 'siniri', 'limit', 'rating'],
  ['derecelendirme', 'rating'], ['surum', 'version'], ['uygulama', 'app', 'application'], ['hesapmakinesi', 'calculator'],
  ['tarih', 'date'], ['saat', 'time'], ['ulke', 'country'], ['sehir', 'city'], ['adres', 'address'], ['telefon', 'phone'], ['not', 'note'],
  ['vscode', 'visualstudiocode', 'code', 'visual'], ['sohbet', 'chat'], ['takvim', 'calendar'], ['muzik', 'music'], ['notlar', 'notes'], ['hatirlaticilar', 'animsaticilar', 'reminders'],
  ['kabul', 'accept', 'agree'], ['cerez', 'cerezler', 'cookie', 'cookies'], ['reddet', 'reject', 'decline'], ['baslik', 'title', 'heading'],
  ['altbaslik', 'subtitle'], ['ana', 'primary', 'main'], ['ikincil', 'secondary'], ['gerekli', 'required'], ['otomatik', 'automatic', 'automatically', 'auto'],
  ['inceleme', 'incelemeye', 'review'], ['yayinlama', 'release', 'publishing'], ['siddet', 'violence'], ['kumar', 'gambling'], ['hicbiri', 'none'],
  ['dokumantasyon', 'documentation', 'docs'], ['belgeler', 'documents'], ['ozellik', 'features', 'feature'], ['urun', 'product'], ['magaza', 'store', 'shop'],
  ['bilgi', 'info', 'information'], ['ayrinti', 'detay', 'details'], ['durum', 'status'], ['iletisim', 'contact'], ['hakkinda', 'about'],
  ['destek', 'support'], ['ozet', 'summary'], ['liste', 'list'], ['rapor', 'report'], ['analiz', 'analytics'], ['satis', 'sales'], ['gelir', 'revenue'],
  ['kullanicilar', 'users'], ['erisim', 'access'], ['ekip', 'team'], ['proje', 'project'], ['gorev', 'task'], ['hata', 'error'], ['uyari', 'warning'],
  ['ekran', 'screen'], ['goruntu', 'goruntuleri', 'screenshot', 'screenshots'], ['onizleme', 'preview', 'previews'], ['icerik', 'content'],
  ['haklar', 'rights'], ['oyunlar', 'games'], ['egitim', 'education'], ['verimlilik', 'productivity'], ['araclar', 'utilities', 'tools'],
  ['puan', 'degerlendirme', 'ratings', 'reviews'], ['satin alma', 'purchases'], ['mevcut', 'availability', 'available'], ['surumu', 'version'],
  ['degisiklik', 'degisiklikler', 'changes', 'change'], ['kaydedildi', 'kaydedilen', 'saved'], ['gonderildi', 'sent', 'submitted'], ['silindi', 'deleted'],
  ['basarili', 'basariyla', 'success', 'successfully'], ['gerekli', 'required'], ['anahtar', 'anahtari', 'key'], ['belge', 'document'], ['metin', 'text']
];
const SAME_AS = new Map();
for (const group of SAME) for (const w of group) SAME_AS.set(w, new Set([...(SAME_AS.get(w) || []), ...group.filter(o => o !== w)]));

// One word a longer form of the other: a Turkish ending (up to 4 letters: "fiyatı", "ayarları") is the same
// word; more is another word grown from it ("fiyatlandırma" is not "fiyat").
const longer = (a, b) => (a.length >= b.length ? a.startsWith(b) && b.length >= 4 && a.length - b.length : b.startsWith(a) && a.length >= 4 && b.length - a.length);
const grown = extra => (extra === false || extra === 0 ? 0 : extra <= 4 ? 0.85 : 0.6);

/** How well two words match: the same word 1, the same meaning 0.9, the same word with a Turkish ending 0.85. */
function wordMatch(a, b) {
  if (a === b) return 1;
  let m = grown(longer(a, b));
  const same = SAME_AS.get(a);
  if (same) for (const o of same) m = Math.max(m, o === b ? 0.9 : grown(longer(o, b)) * 0.95);
  for (const [stem, others] of SAME_AS) {
    if (stem !== a && stem.length >= 3 && a.startsWith(stem) && others.has(b)) m = Math.max(m, grown(a.length - stem.length) * 0.95);
  }
  return m;
}

const best = (w, list) => list.reduce((m, x) => Math.max(m, wordMatch(w, x)), 0);

/** The wanted words: what is in quotes, or the description without the filler words. */
function wantedWords(text) {
  const quoted = String(text).match(/["“']([^"”']{1,80})["”']/)?.[1];
  const all = words(quoted || text);
  const kept = all.filter(w => !FILLER.has(w));
  return kept.length ? kept : all;
}

// The dictionary's word for two words written as one, with a Turkish ending allowed ("hesap makinesini" → "hesapmakinesi").
const knownAs = two => (SAME_AS.has(two) ? two : [...SAME_AS.keys()].find(k => k.length >= 6 && two.startsWith(k) && two.length - k.length <= 4));

// Two words that the dictionary knows as one ("alt başlık" → "altbaslik" → subtitle); null when there are none.
function joined(want) {
  const out = [];
  let changed = false;
  for (let i = 0; i < want.length; i++) {
    // (the dictionary's word has to reach into the second word, not be the first word with the second as an ending)
    const known = i + 1 < want.length && knownAs(want[i] + want[i + 1]);
    if (known && known.length > want[i].length) { out.push(known); i++; changed = true; } else out.push(want[i]);
  }
  return changed ? out : null;
}

// "[role] name — nearby text {state}" (hands/browser.js, hands/desktop.js), or a plain option.
function parseLabel(label) {
  const m = String(label).match(/^\[([^\]]*)\]\s*(.*?)(?:\s+—\s+(.*?))?(?:\s+\{([^}]*)\})?$/);
  if (!m) return { role: '', name: String(label), ctx: '', state: '' };
  return { role: m[1], name: m[2], ctx: m[3] || '', state: m[4] || '' };
}

const ROLE_WORDS = [
  [/button|dugme|buton/, /button/i], [/link|baglanti/, /link/i], [/checkbox|kutu|tick|isaret/, /checkbox|switch/i],
  [/radio/, /radio/i], [/tab|sekme/, /tab/i], [/field|alan|input|textbox/, /textbox|textfield|searchbox|input|combobox|textarea/i],
  [/menu/, /menu/i], [/dropdown|select|liste/, /combobox|listbox|popup|select/i]
];

/** How well one element matches the wanted words, 0…1 (the words as they are, or two of them as one). */
function scoreLabel(want, label, description, kind) {
  const two = joined(want);
  const score = Math.max(scoreWords(want, label, description), two ? scoreWords(two, label, description) : 0);
  // Typing goes into a field, choosing into a list, ticking into a box: other elements hardly count.
  // (Custom lists are often a button that opens them.)
  const role = parseLabel(label).role;
  const fits = { type: /text|search|input|area|combo|field|secure/i, select: /select|combo|list|popup|menu|button/i, check: /check|switch|radio|toggle/i, upload: /file|button/i }[kind];
  return fits && role && !fits.test(role) ? score * 0.5 : score;
}

// What the instruction asks for, from core/jev.js's purpose words.
function kindOf(instruction) {
  const s = String(instruction);
  if (/^(Type text into|Enter the password)/.test(s)) return 'type';
  if (/^Choose a value in the dropdown/.test(s)) return 'select';
  if (/^Tick or untick/.test(s)) return 'check';
  if (/^Upload a file/.test(s)) return 'upload';
  return 'click';
}

// Small words that say nothing about which element it is.
const STOP = new Set(words('and or the of for to a an under below above near next by ve veya ile için icin altında altinda yanında yaninda'));

function scoreWords(want, label, description) {
  want = want.filter(w => !STOP.has(w));
  if (!want.length) return 0;
  const { role, name, ctx, state } = parseLabel(label);
  const ctxWords = words(ctx).filter(w => !STOP.has(w));
  const unnamed = !fold(name) || /^\(?(isimsiz|unnamed)\)?$/.test(name.trim());
  // A field without a name of its own is named by the text next to it; a list shows its value, its name is next to it.
  const listy = /select|combo|listbox|popup/i.test(role);
  const nameWords = unnamed ? ctxWords : [...words(name), ...(listy ? ctxWords : [])].filter(w => !STOP.has(w));
  if (!unnamed && fold(name) === want.join(' ')) return 1;
  // The whole name for the whole description, written as one ("VS Code" → Visual Studio Code, "kaydet" → Save).
  if (!unnamed && nameWords.length && wordMatch(want.join(''), nameWords.join('')) >= 0.9) return 0.95;
  const inName = want.map(w => best(w, nameWords));
  const inAll = want.map((w, i) => Math.max(inName[i], best(w, ctxWords)));
  const avg = list => list.reduce((a, b) => a + b, 0) / want.length;
  // How much of the name was asked for (a name with other words in it is a weaker match).
  const precision = nameWords.length ? nameWords.reduce((a, n) => a + want.reduce((m, w) => Math.max(m, wordMatch(w, n)), 0), 0) / nameWords.length : 0;
  // The nearby text counts nearly as much as the name: it tells apart elements with the same name ("None", "Edit").
  let score = 0.3 * avg(inName) + 0.5 * avg(inAll) + 0.2 * precision;
  const said = fold(description);
  if (ROLE_WORDS.some(([w, r]) => w.test(said) && r.test(role))) score += 0.08;
  if (/disabled/.test(state)) score -= 0.1;
  if (/offscreen/.test(state)) score -= 0.02;
  return Math.max(0, Math.min(0.97, score));
}

/** Picks among scored candidates in core/jev.js's shape: sure only with a clear winner. */
function pickFrom(scores) {
  const order = scores.map((s, i) => [i, s]).sort((a, b) => b[1] - a[1]);
  const [top, second] = order;
  const alternatives = order.slice(0, 3).filter(([, s]) => s > 0.15).map(([index, p]) => ({ index, p }));
  if (!top || top[1] < 0.35) return { index: null, confidence: 0.9, alternatives, risk: null, ms: 0, local: true };
  const s1 = top[1], s2 = second?.[1] || 0;
  // A clear winner: well ahead of the next one (two elements with the same words stay a question for the brain).
  const confidence = s1 >= 0.95 && s2 < 0.95 ? 0.95 : s1 >= 0.5 && s1 - s2 >= 0.15 && s2 <= 0.75 * s1 ? 0.86 : Math.min(0.6, s1 * 0.6);
  return { index: top[0], confidence, alternatives, risk: null, ms: 0, local: true };
}

// The target after core/jev.js's purpose words ("Click: Save", "Choose a value in the dropdown/select: Country (a dropdown…").
function targetOf(instruction) {
  const s = String(instruction);
  const at = s.indexOf(': ');
  return (at >= 0 ? s.slice(at + 2) : s).replace(/\s+\((?:a dropdown usually|a radio button is named)[^)]*\)\s*$/, '');
}

/** core/jev.js pickElement without Jev. page: { url, title } or a Mac window's { app, window, texts }. */
export function pickElement(instruction, labels, { withRisk = false, page = {} } = {}) {
  const form = String(instruction).match(/^Set the form field "(.*?)" to "(.*?)"/s);
  const target = form ? form[1] : targetOf(instruction);
  const want = wantedWords(target);
  const kind = kindOf(instruction);
  let scores = labels.map(l => scoreLabel(want, l, target, kind));
  if (form) {
    // hands/browser.js fill: a text field or list named like the field, or the radio button / checkbox
    // named like the answer, next to the field's question.
    const choice = wantedWords(`${form[2]} ${form[1]}`);
    scores = labels.map((l, i) => (/radio|check|switch|toggle/i.test(parseLabel(l).role) ? scoreLabel(choice, l, form[2], 'check') : scores[i]));
  }
  // The only field there is to type into (or list, or box) is the one meant when nothing else fits better.
  if (kind !== 'click') {
    const fit = { type: /text|search|input|area|combo|field|secure/i, select: /select|combo|list|popup|menu|button/i, check: /check|switch|radio|toggle/i }[kind];
    const fitting = fit ? labels.map((l, i) => [i, fit.test(parseLabel(l).role)]).filter(([, ok]) => ok) : [];
    if (fitting.length === 1 && scores[fitting[0][0]] < 0.6 && scores.every((s, i) => i === fitting[0][0] || s < 0.4)) scores[fitting[0][0]] = 0.6;
  }
  const pick = pickFrom(scores);
  if (withRisk) {
    const label = pick.index !== null ? labels[pick.index] : '';
    // "Evet", "OK", "Continue": what they do is in the question around them ("Bu uygulamayı silmek istiyor musunuz?").
    const around = GENERIC.test(parseLabel(label).name) ? ` ${page.title || ''} ${page.window || ''} ${[].concat(page.texts || []).join(' ')}` : '';
    pick.risk = riskOf(`${instruction} ${label}${around}`);
  }
  return pick;
}

/** core/jev.js pickOption without Jev: the option whose words match `wanted`. */
export function pickOption(wanted, options) {
  const want = wantedWords(wanted).filter(w => !COMMAND_WORDS.has(w));
  return pickFrom(options.map(o => scoreLabel(want.length ? want : wantedWords(wanted), String(o), String(wanted))));
}

// Words of a spoken command around an app's name ("Spotify'ı aç", "VS Code'a geç", "quit Xcode").
const COMMAND_WORDS = new Set(words(`
  ac aç acar acsana aç kapat kapatir gec geç gecis başlat baslat calistir çalıştır gir sonlandir sonlandır
  uygulama uygulamasi uygulamasını uygulamasini uygulamasına uygulamasina programi programı programını
  open launch start switch go quit close app application please to the
`));

// ---------------------------------------------------------------------------
// Risk
// ---------------------------------------------------------------------------

// Things that are hard to undo or that other people see. English words whole; Turkish verbs with their endings.
const RISKY = /(?<![\p{L}])(?:(?:submit|send|post|publish|share|invite|transfer|pay|purchase|buy|checkout|order|subscribe|confirm|delete|remove|save|apply|update|reply|comment|tweet)(?![\p{L}])|(?:gönder|paylaş|yayınla|yayımla|davet et|satın al|sipariş|abone ol|onayla|kaldır|kaydet|güncelle|yanıtla|cevapla)\p{L}*|sil(?:mek|me|in|iyor|ecek|eceğ|eyim|elim|ebilir|di)\p{L}*|kalıcı olarak|geri alınamaz|permanently|cannot be undone|can't be undone|irreversible|(?:öde|ödeme|sil|uygula|yorum yap)(?![\p{L}]))/iu;
const HARMLESS = /(?<![\p{L}])(?:search|find|filter|ara|arama|bul|filtre|url|adres|address|go to)(?![\p{L}])/iu;
// Buttons that only say yes: the question next to them says what they do.
const GENERIC = /^\s*(?:yes|evet|ok|okay|tamam|continue|devam|devam et|confirm|onayla|accept|kabul|kabul et|proceed|ilerle|i agree|agree|done|bitti|go|apply|uygula)\s*[.!]?\s*$/iu;
// Where pressing Enter sends something to other people.
const OUTGOING = /(?<![\p{L}])(?:mesaj|message|yorum|comment|reply|yanıt|cevap|tweet|post|chat|sohbet|kime|alıcı|to)(?![\p{L}])/iu;

/** core/jev.js isRisky without Jev: high for words of sending, paying, deleting or saving; for Enter, by the field it is pressed in. */
export function riskOf(text) {
  const s = String(text);
  // "Type into "Message" and press Enter to submit", "Press Enter after typing into "Ara"", "Press Enter in "…" (this may submit a form)"
  if (/press enter/i.test(s)) {
    const field = s.match(/"([^"]*)"/)?.[1] || '';
    if (HARMLESS.test(field)) return 0.05;
    return OUTGOING.test(field) || RISKY.test(field) ? 0.85 : 0.4;
  }
  if (RISKY.test(s)) return 0.85;
  return HARMLESS.test(s) ? 0.05 : 0.1;
}

// ---------------------------------------------------------------------------
// Does the page show it?
// ---------------------------------------------------------------------------

/** core/jev.js checkState without Jev: are the expectation's words (or its quoted text) on the page? */
export function checkState(expectation, page = {}) {
  const hay = fold([page.url, page.title, page.text, ...(page.alerts || []), ...(page.controls || [])].map(x => (typeof x === 'string' ? x : JSON.stringify(x ?? ''))).join(' '));
  const quoted = [...String(expectation).matchAll(/["“]([^"”]{2,120})["”]/g)].map(m => fold(m[1]));
  if (quoted.length) {
    const p = quoted.filter(q => hay.includes(q)).length / quoted.length;
    return { yes: p === 1, p, ms: 0, local: true };
  }
  const want = wantedWords(expectation).filter(w => w.length >= 3 && !EXPECT_WORDS.has(w));
  if (!want.length) return { yes: false, p: 0, ms: 0, local: true };
  const hayWords = hay.split(' ');
  const p = want.reduce((a, w) => a + (hay.includes(w) ? 1 : best(w, hayWords)), 0) / want.length;
  return { yes: p >= 0.75, p, ms: 0, local: true };
}
const EXPECT_WORDS = new Set(words('page sayfa shows show gorunuyor görünüyor var is are the that has have yazıyor yaziyor says said text yazi yazı message mesaji görünür gorunur'));

// ---------------------------------------------------------------------------
// The fast path's rules
// ---------------------------------------------------------------------------

const lower = s => String(s).toLocaleLowerCase('tr');
// A word or phrase on its own (JavaScript's \b does not know Turkish letters).
const has = (s, re) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${re})(?![\\p{L}\\p{N}])`, 'iu').test(s);

const CHAT = 'selam|merhaba|naber|nasılsın|günaydın|iyi akşamlar|iyi geceler|teşekkürler|teşekkür ederim|sağ ol|eyvallah|hi|hello|hey there|hi there|thanks|thank you|good morning|neler yapabilirsin|ne yapabilirsin|becerin|kimsin|nesin sen|what can you do|who are you|anlamadın|okumadın|yanlış anladın|you didn\'t|you did not|ne dedim|ne anlattım|ne söyledim|what did i';
const REPLY = 'hayır|evet|yok|aynen|ikisi de|öyle değil|öyle demedim|bunu|aynısını|onu da|tekrar dene|bir daha|yine|no|yes|both|not like that|not what i meant|that\'s not|do that again|the same|that one|try again|again';
const LATER = '\\d+\\s*(?:dk|dakika|saat|sn|saniye)\\s*(?:sonra|içinde)|saat\\s*\\d+|\\d+[\'’]?\\s*(?:te|ta|de|da)|yarın|öbür gün|haftaya|akşam|sabah|pazartesi|salı|çarşamba|perşembe|cuma|cumartesi|pazar|bitince|olunca|bittiğinde|hatırlat|in\\s+\\d+\\s*(?:min|minutes?|hours?|seconds?)|at\\s+\\d+|tomorrow|tonight|when\\b.+\\b(?:done|finished|over)|remind';
const MANY = '\\sve\\s|\\ssonra\\s|\\sardından\\s|\\sand\\s|\\sthen\\s|,\\s*(?:sonra|ve|and|then)';

/**
 * The fast path's decision by rules, in core/router.js classify's shape:
 * { route, confidence, intent, answers, ms }. apps: Mac app names, so "WhatsApp'ı aç" opens the app when
 * there is one. siteIn: core/router.js's site finder.
 */
export function classify(command, { previous = '', apps = [], siteIn = () => null } = {}) {
  const c = lower(command).trim();
  const done = (route, answers = {}, intent = 'do_now') => ({ route, confidence: route === 'needs_brain' ? 0.9 : 0.9, intent, answers: { ...answers, intent: { choice: intent, confidence: 0.9 }, route: { choice: route, confidence: 0.9 } }, ms: 0, local: true });

  // Asking to see something now; time words in them are part of the question.
  if (/^(?:not al|not et)\b|^not\s*:|^take a note|^note\s*:/.test(c) || (/notlar[ıi]m(?:a|ıza)/.test(c) && has(c, 'ekle')) || /^(?:please\s+)?(?:add|put|write)\s+.+\s+(?:to|in|into)\s+(?:my\s+|the\s+)?notes\s*[.!]?$/.test(c)) return done('note_add');
  if ((/takvim/.test(c) && has(c, 'ne var|neler var|ne işim var|programım|ne yapıyorum') && !has(c, 'ekle|oluştur|kur|yaz')) || /what(?:'s| is) on my calendar|my calendar (?:today|tomorrow|this week)|what do i have (?:on )?(?:today|tomorrow)/.test(c)) {
    return done('calendar_show', { calendar_when: { choice: has(c, 'yarın|tomorrow') ? 'tomorrow' : has(c, 'hafta|week') ? 'week' : 'today' } });
  }
  if ((/(?:hatırlatıcı|anımsatıcı|yapılacak)/.test(c) && has(c, 'ne var|neler|listele|göster') && !has(c, 'ekle')) || /what are my (?:reminders|to-?dos)|show (?:my )?reminders|my reminders/.test(c)) return done('reminders_show');
  if (has(c, '(?:hangi|ne) şarkı (?:çalıyor|bu)|ne çalıyor|what song|what(?:\'s| is) playing|which song')) return done('now_playing');

  // Not "do this now": talk, an answer, or something for later.
  if (has(c, CHAT) && c.split(/\s+/).length <= 8) return done('needs_brain', {}, 'chat');
  if (has(c, REPLY) && c.split(/\s+/).length <= 6 && !has(c, 'sesi|ses|volume|şarkı|song|music|müzik')) return done('needs_brain', {}, 'reply');
  if (new RegExp(LATER, 'iu').test(c)) return done('needs_brain', {}, 'do_later');
  if (new RegExp(MANY, 'iu').test(` ${c} `)) return done('needs_brain');

  if (has(c, 'sessize al|sesi kapat|sesi geri aç|sesi tekrar aç|sesi açık hale getir|mute|unmute')) {
    return done('mute', { unmute: { noul: has(c, 'geri aç|tekrar aç|açık hale|unmute') ? 0.9 : 0.1 } });
  }
  if (has(c, 'ses|sesi|sesin|sesini|volume|louder|quieter') || /turn (?:it|the (?:volume|sound)) (?:up|down)/.test(c)) {
    const how = /\d/.test(c) ? 'number'
      : has(c, 'sonuna kadar|en yüksek|en yükseğe|full|max|maximum|all the way up') ? 'max'
        : has(c, 'kıs|kis|azalt|düşür|down|lower|quieter') ? 'down'
          : has(c, 'yarı|yarıya|orta|half') ? 'half'
            : has(c, 'aç|yükselt|artır|up|louder|higher') ? 'up' : null;
    return how ? done('volume', { volume_how: { choice: how } }) : done('needs_brain');
  }
  if (has(c, 'karanlık mod|karanlık modu|karanlık moda|koyu mod|koyu modu|koyu moda|aydınlık mod|aydınlık modu|aydınlık moda|açık mod|açık modu|açık moda|dark mode|light mode|night mode')) return done('dark_mode');
  if (has(c, 'ekranı kilitle|kilitle ekranı|lock the screen|lock screen|lock my (?:mac|computer)')) return done('lock_screen');
  if (has(c, 'ekran görüntüsü al|ekran görüntüsü|ekranın görüntüsünü al|ekran resmi al|take a screenshot|screenshot')) return done('screenshot');
  if (has(c, '(?:sonraki|önceki|bir sonraki|bir önceki) şarkı\\p{L}*|şarkıyı (?:geç|atla|değiştir)|next (?:song|track)|previous (?:song|track)|skip (?:this )?(?:song|track)|şarkıyı başa sar')) {
    return done('music', { music_action: { choice: has(c, 'önceki|previous|başa') ? 'previous_track' : 'next_track' } });
  }
  if (has(c, 'müziği (?:durdur|başlat|devam ettir|duraklat|aç)|şarkıyı (?:durdur|duraklat|devam ettir)|(?:pause|resume|play|stop) the music|pause|resume|play music|müzik çal|müziği çal')) {
    return done('music', { music_action: { choice: 'play_pause' } });
  }
  if (has(c, 'çal|oynat|çalar mısın|çalsana') || /^play\s/.test(c)) {
    const liked = has(c, 'beğendiğim|beğendiklerim|beğenilen|beğenilenler|liked songs|my likes|favori');
    return done('spotify_play', { liked: { noul: liked ? 0.9 : 0.1 } });
  }
  if (has(c, 'tıkla|tıklar mısın') || /^click\s/.test(c)) return done('page_click');
  if ((has(c, 'google|youtube|internet|web') && has(c, 'ara|arat|araştır|bul')) || /^(?:search|google)\s|search (?:google|youtube|the web)|look (?:up|for)\s/.test(c)) {
    return done('web_search', { on_youtube: { noul: has(c, 'youtube') ? 0.9 : 0.1 } });
  }
  const opens = has(c, 'aç|açar mısın|açsana|başlat|çalıştır|geç|gir|git|open|launch|start|switch to|go to|visit');
  const quits = has(c, 'kapat|sonlandır|quit|close');
  if (opens || quits) {
    // Only the name of an app (or a site) and the verb: "Chrome'da yeni sekme aç" is more than opening Chrome.
    const rest = words(command).filter(w => !COMMAND_WORDS.has(w) && !FILLER.has(w));
    const app = rest.length && rest.length <= 3 && (!apps.length || apps.some(a => covers(words(a), rest)));
    if (!quits && !has(c, 'uygulama\\p{L}*|program\\p{L}*|app') && siteIn(command) && !app) return done('web_open');
    if (app) return done(quits ? 'app_quit' : 'app_open');
    return done('needs_brain');
  }
  return done('needs_brain');
}

// Does an app's name account for every word left in the command ("hesap makinesini" → Hesap Makinesi, "vs code" → Visual Studio Code)?
function covers(nameWords, rest) {
  const all = [...nameWords, nameWords.join('')];
  const two = joined(rest);
  return [rest, two].filter(Boolean).some(list => list.every(w => all.some(n => wordMatch(w, n) >= 0.85)));
}

/**
 * core/spans.js pickSpan without Jev, for the two things the fast path takes out of a command: what to play
 * ("Spotify'da Tarkan çal" → "Tarkan") and a note's text ("notlarıma süt almayı ekle" → "süt almayı").
 * null when the rules can't find it.
 */
export function pickSpan(command, kind) {
  const s = String(command).trim();
  if (kind === 'note') {
    const m = s.match(/notlar[ıi]m(?:a|ıza)\s+(.+?)\s+ekle\b/iu) || s.match(/^(.+?)\s+(?:yi|yı|i|ı|u|ü|['’]\p{L}+)?\s*notlar[ıi]m(?:a|ıza)\s+ekle\b/iu) || s.match(/notlar[ıi]m(?:a|ıza)\s+ekle\s*:?\s+(.+)$/iu);
    return m?.[1]?.trim() || null;
  }
  const out = s
    .replace(/(?<![\p{L}])spotify['’]?\p{L}*/giu, ' ')
    .replace(/(?<![\p{L}])(?:çalar mısın|çalsana|çal|oynat|play|please|lütfen|bana|bir|bu|şu|on|in|from|the|my|this|song|songs|album|playlist|şarkısını|şarkılarını|şarkısı|şarkıyı|şarkı|müziği|albümünü|albümü|listemi|listesini|listesi|çalma|playlistimi|playlistini)(?![\p{L}])/giu, ' ')
    .replace(/['’]\p{L}+/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return out && !/^(?:müzik|şarkı|music|something|bir şey|birşey)$/iu.test(out) ? out : null;
}

// ---------------------------------------------------------------------------
// Page guard
// ---------------------------------------------------------------------------

const INJECTION = [
  /ignore (?:all |any )?(?:the )?(?:previous|prior|above|earlier) (?:instructions|prompts|messages|rules)/i,
  /disregard (?:all |any )?(?:the )?(?:previous|prior|above|earlier)/i,
  /(?:new|updated) (?:system )?instructions? (?:for|to) (?:the )?(?:ai|assistant|agent|model)/i,
  /system prompt/i,
  /as an (?:ai|llm|language model)(?: assistant| agent)?,? you (?:must|should|will|need)/i,
  /(?:ai|llm|assistant|agent)s?,? (?:must|should|are required to|need to) (?:now )?(?:send|forward|email|transfer|visit|open|click|enter|reveal|share)/i,
  /(?:forward|send|email|upload|transfer) (?:all|every|the user'?s?|your) (?:e-?mails?|messages|data|passwords?|files|contacts|cookies|tokens?)/i,
  /(?:enter|type|give|share|reveal|paste) (?:your|the user'?s?) (?:password|api key|credentials|token|2fa code|verification code)/i,
  /önceki (?:tüm |bütün )?(?:talimatları|komutları|kuralları) (?:yok say|unut|görmezden gel|dikkate alma)/iu,
  /yapay ?zek[aâ](?:ya)?\s.{0,40}(?:yapmalı|zorunda|şunu yap|gönder|ilet)/iu,
  /(?:tüm|bütün) (?:e-?postaları|mailleri|mesajları|dosyaları|şifreleri) .{0,40}(?:ilet|gönder|yükle|paylaş)/iu,
  /(?:şifreni|şifrenizi|parolanı|parolanızı|doğrulama kodunu) (?:gir|yaz|gönder|paylaş)/iu
];
const LOGIN = /(?<![\p{L}])(sign in|log in|login|giriş yap|oturum aç|şifre|password|parola)(?![\p{L}])/iu;
const SECRET_FIELD = /(?<![\p{L}])(password|şifre|parola)(?![\p{L}])/iu;
const CODE = /(verification code|security code|2fa|two-?factor|two-?step|one-?time code|enter the code|doğrulama kodu|güvenlik kodu|iki adımlı|kodu gir|tek kullanımlık)/iu;
const CAPTCHA = /(captcha|i'?m not a robot|ben robot değilim|verify you are (?:a )?human|insan olduğunuzu doğrulayın|checking your browser|tarayıcınız kontrol ediliyor)/iu;

/** guard/page-guard.js guardPage without Jev: well-known injection phrases are hidden; logins, codes and CAPTCHAs are noticed by their words. */
export function guardPage({ url = '', title = '', text = '' }, chunks, mark) {
  const flagged = chunks.map(c => INJECTION.some(re => re.test(c)));
  const covered = chunks.join('\n').length;
  const safeText = flagged.some(Boolean)
    ? chunks.map((c, i) => (flagged[i] ? mark : c)).join('\n') + (text.length > covered ? `\n${text.slice(covered)}` : '')
    : text;
  const head = `${url}\n${title}\n${String(text).slice(0, 1500)}`;
  const login = (LOGIN.test(head) && SECRET_FIELD.test(head)) || /\/(?:login|signin|sign-in|auth|accounts)\b/i.test(url);
  const needsUserP = CAPTCHA.test(head) || CODE.test(head) || login ? 0.8 : 0.05;
  return { text: safeText, flagged: flagged.filter(Boolean).length, needsUser: needsUserP >= 0.5, needsUserP, ms: 0, local: true };
}

/** Said when something only Jev can do is asked for. */
export const offNote = () => T("Jev kapalı (Jev anahtarı yok); bu karar Jev'siz verilemiyor.", "Jev is off (no Jev key); this judgment can't be made without it.");
