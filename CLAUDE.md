# JEVIS — Claude için proje notları

Bu proje: Jev (TypeSafe System One) ile hızlanan, bilgisayarı ve tarayıcıyı kontrol eden asistan **JEVIS** ve Jev deney alanı.

**Her oturumda önce [PLAN.md](PLAN.md)'yi oku.** Hedef, mimari, kararlar, fazlar, deney sonuçları ve nerede kaldığımız orada.

## Kurallar

- Kullanıcıyla Türkçe konuş.
- Değişiklikten önce ve sonra git commit al. Bir şeyi silmeden önce mutlaka commit olsun; kullanıcı fikrini değiştirebilir.
- `.env` (JEV_KEY) asla commit edilmez ve içeriği ekrana yazdırılmaz.
- Kullanıcı Claude'dan bir şey gizlenmesini istemiyor (2026-09-30): Claude sayfadaki değerleri, API anahtarlarını, indirilen dosyaları görebilir. Şifreler kolaylık için Anahtar Zinciri'nden doldurulur; kayıt dosyalarına (log) şifre yazılmaz.
- Claude in Chrome önerme. Kullanıcı denedi ve reddetti: yavaş, şifre girmiyor.
- Bir faz bitince PLAN.md'deki kutuları işaretle, en üstteki "Durum" satırını ve "Geçmiş" bölümünü güncelle, commit al.
- Kullanıcının adına macOS izin pencerelerine (TCC) asla "İzin Ver" deme; bu onun kararı.

## Handry araçları (sen beyin olduğunda)

`handry` MCP sunucusu (`mcp/server.js`) `mcp__handry__*` araçlarını verir (önceki adları `jevis` ve `inaro`; `jevis_do`, `inaro_do` gibi eski araç adları da çalışır). Bu klasörde `.mcp.json` ile, ayrıca kullanıcı kapsamında bütün Claude Code oturumlarında ve Claude masaüstü uygulamasında kurulu. Kullanım kuralları sunucunun kendi talimatında yazıyor; özetle:
- Basit tek adımlık işler (ses, müzik, uygulama aç/kapat, site, arama, Spotify, not, takvim) için önce `handry_do`: Handry'nin hızlı yolu 1-3 sn'de yapar. "Kendi başına yapamıyor" derse işi diğer araçlarla yap.
- Yeni sayfada önce `browser_read`. Hedefi sayfadaki kelimelerle ver ("Save", "None under Cartoon or Fantasy Violence") ya da `#id` kullan.
- Jev emin olmazsa adayları listeler; tahmin etme, `#id` ile seç.
- Onay penceresinde kullanıcı "Hayır" derse dur ve bildir. Başka bir yol arama.
- Dosya değiştirme: `files_make_folder`, `files_move` (yeniden adlandırma da), `files_copy`, `files_trash` (kalıcı silme yok, Çöp Sepeti; Finder'ın "Geri Koy"u çalışır), `files_undo`. Sadece ev klasöründe; Library, gizli ve anahtar klasörleri, ana klasörler (Masaüstü, Belgeler…) ve projenin kendisi yasak; üstüne yazmaz; klasör ya da 3'ten fazla öğe çöpe atma, git projesi taşıma, 20'den fazla öğe sorar.
- Kayıt: her araç çağrısını kod `~/.jevis/logs/<gün>.jsonl`'a yazar (kim: uygulamanın kendisi ve kaynağı ya da hangi Claude oturumu; ne, sonuç, sorulduysa cevap). Büyük pencerede "Yapılanlar". Onay penceresi açıkken masaüstü araçları ekrana dokunmaz (`~/.jevis/confirming.json`).

### App Store işi akışı
1. `appstore/bilgi-karti.md`'yi oku, eksik bilgileri kullanıcıya sor.
2. Gizlilik için `node appstore/privacy-scan.js <kod-klasörü>` çalıştır ve taslağı kullanıcıya onaylat.
3. `browser_open appstoreconnect.apple.com`. Giriş sayfası çıkarsa kullanıcının JEVIS Chrome penceresinde giriş yapmasını bekle.
4. Bölüm bölüm ilerle: `browser_read` → doldur → Save (onay penceresi çıkar) → `browser_verify`.
5. "Add for Review" / "Submit for Review" butonlarına sadece kullanıcı açıkça isterse bas.

## Çalıştırma

- `npm start` → http://localhost:3000 — JEVIS sohbeti: Hızlı (Sonnet 5.5, varsayılan) / Güçlü (Opus 5.5) model düğmesi, sohbet listesi, ⏰ zamanlayıcı listesi, katlanan adım listesi, tarifler ve ayarlar paneli, bas-konuş, DURDUR
- `node cli.js` → JEVIS komutları: `do "…"` (komut ver), `listen --do` (sesle), tarayıcı (open, read, click, type…), masaüstü (`desk …`, `app`, `mac`), `recipe …`, `secret`, `stop`, `doctor`
- `node cli.js app install && node cli.js app open` → **Handry.app** (eski adları JEVIS.app, Foxie.app, Inaro.app; kimlik hep `studio.purpfox.foxie`, izinler kalsın diye değişmez): ⌥Space üstten inen kompakt çubuk, ⌥⇧Space bas-konuş, "Hey Foxie" / "Hey Fox" / "Handry, …" ile sesli uyandırma (Handry henüz sesle denenmedi; "Inaro"da ad tek başına "hey"den sonrakinden çok daha iyi duyulmuştu), ⌥Esc acil durdur; ekranda gezen piksel tilki Foxie (menü › Tilki: göster/gizle, uyut, boyut); menü › İzinler… bütün macOS izinleri tek pencerede; Dock simgesi büyük pencereyi açar. Ad, Türkçe ekleri, tilkinin adı ve uyandırma kelimesi tek yerde: `core/brand.js` (sayfalara sunucu, Swift'e Info.plist taşır). MCP sunucusu `handry` (Claude Code kullanıcı kapsamı, proje `.mcp.json`, Claude masaüstü ayarı). Depo: github.com/purplefox21/handry (gizli). İçeride kalan adlar: `~/.jevis` klasörü, Anahtar Zinciri servisi `jevis` (kayıtlı şifreler buna bağlı, değiştirilmez), `JEVIS_*` ortam değişkenleri.
- `node appstore/privacy-scan.js <klasör>` → App Privacy taslağı
- `node demo.js` → destek bileti yönlendirme örneği
- `node macos-cli.js "komut"` → eski tek adımlı macOS komutları (Jev dispatcher)
- Masaüstü yardımcısı `bin/jevis-ax`, ilk kullanımda `hands/ax-helper/main.swift`'ten kendiliğinden derlenir.

## Testler

- `node tests/browser-e2e.mjs` → tarayıcı elleri (gerçek Chrome + Jev, test sayfası)
- `node tests/faz10-e2e.mjs` → giriş uyarısı ve iMessage (kaydedilir, gönderilmez), oturum kontrolü, toplu doldurma, jevis_teach, site notu, indirme, değer kaydetme (Anahtar Zinciri'ne test kaydı ekleyip siler), onay penceresi, tablo, numaralı ekran görüntüsü
- `node tests/forms-e2e.mjs` → zor formlar: görünmez select'li kutular, açılır listeler ve aynı adlı yan menü, sabit #id'ler, ekran dışı özeti, wait_for_user'ın sayfayı izlemesi
- `node tests/mcp-smoke.mjs` → MCP sunucusu
- `node tests/guard-e2e.mjs` → kasa, bekçi, acil durdurma (Anahtar Zinciri'ne test kaydı ekleyip siler)
- `node tests/desktop-e2e.mjs` → masaüstü elleri (Hesap Makinesi ve TextEdit'i açıp kapatır)
- `node tests/app-e2e.mjs` → sohbet sunucusu: hızlı yol, Claude Code beyni, DURDUR, OpenAI uyumlu adaptör, arayüz, model seçimi (aboneliğinden iki kısa çalışma harcar)
- `node tests/voice-e2e.mjs` → ses: whisper, sessizlik filtresi, sesli cevap (hoparlörsüz), arayüz kayıt kodu, mikrofon
- `node tests/recipe-e2e.mjs` → tarifler: kaydet, beyinsiz oynat, değişkenler, beyne devretme
- `node tests/router-e2e.mjs` → hızlı yol kararları ve niyet (51 Türkçe cümle, hiçbir şey yapmaz)
- `node tests/fast-e2e.mjs` → hızlı yol uçtan uca: ses (eski seviyeye döner), Hesap Makinesi, YouTube, Google, sayfada tıklama
- `node tests/apps-e2e.mjs` → Spotify'ı okur (dokunmaz), koordinatla tıklama, bekleme, TextEdit pencereleri arasında geçiş
- `node tests/learn-e2e.mjs` → öğrenen tarifler (geçici bir JEVIS klasöründe; gerçek öğrenilenlere dokunmaz)
- `node tests/files-e2e.mjs` → dosya ve proje araçları (~/Library/Caches altında geçici klasör; TextEdit'i açıp kapatır)
- `node tests/appshortcuts-e2e.mjs` → Spotify'da gerçekten çalar ve sonra duraklatır; Müzik/Notlar/Anımsatıcılar/Takvim betiklerini sadece derler (macOS izni verilmişse okur)
- `node tests/listener-e2e.mjs` → "Hey Foxie", "Hey Fox", "Handry, …" ve canlı yazı: Yelda sesiyle üretilen kayıtlar Handry.app'in dinleyicisinden geçer (mikrofon ve hoparlör gerekmez; uygulamanın Konuşma Tanıma izni gerekir)
- `node tests/chats-e2e.mjs` → sohbetler ve Claude oturumları (sahte beyin, geçici JEVIS klasörü)
- `node tests/chats-ui-e2e.mjs` → sohbetler pencerede ve çubukta (ayrı sunucu, geçici JEVIS klasörü, sadece hızlı yol)
- `node tests/files-change-e2e.mjs` → dosya değiştirme ve geri alma, yasak yerler, önce sorma ("hayır" = hiçbir şey olmaz), onay penceresi açıkken ekrana dokunmama, kayıtta "kim" (geçici klasör; Çöp Sepeti'ne atılanlar geri alınır; ekran ve ses yok)
- `node tests/timers-ui-e2e.mjs` → zamanlayıcı listesi pencerede ve çubukta, iptal, geri sayımda İptal (görünmez Chrome, ayrı sunucu, geçici klasör; ses ve ekran yok)
- `node tests/timers-e2e.mjs` → zamanlayıcı, nöbet, "işler bitince kapat", geri sayım ve iptal, hızlı yolun sohbeti komut sanmaması (geçici klasör, sahte Claude oturumları; kapatma/kilit/iMessage sadece kaydedilir, ses yok)
- `node tests/dispatcher-dryrun.mjs` → eski macOS komut yönlendirici (deneme modu)
