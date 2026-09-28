# JEVIS — Claude için proje notları

Bu proje: Jev (TypeSafe System One) ile hızlanan, bilgisayarı ve tarayıcıyı kontrol eden asistan **JEVIS** ve Jev deney alanı.

**Her oturumda önce [PLAN.md](PLAN.md)'yi oku.** Hedef, mimari, kararlar, fazlar, deney sonuçları ve nerede kaldığımız orada.

## Kurallar

- Kullanıcıyla Türkçe konuş.
- Değişiklikten önce ve sonra git commit al. Bir şeyi silmeden önce mutlaka commit olsun; kullanıcı fikrini değiştirebilir.
- `.env` (JEV_KEY) asla commit edilmez ve içeriği ekrana yazdırılmaz.
- Şifreler hiçbir zaman LLM'e ya da kayıtlara gitmez. Anahtar Zinciri'nden kod okuyup yazar.
- Claude in Chrome önerme. Kullanıcı denedi ve reddetti: yavaş, şifre girmiyor.
- Bir faz bitince PLAN.md'deki kutuları işaretle, en üstteki "Durum" satırını ve "Geçmiş" bölümünü güncelle, commit al.
- Kullanıcının adına macOS izin pencerelerine (TCC) asla "İzin Ver" deme; bu onun kararı.

## JEVIS araçları (sen beyin olduğunda)

`.mcp.json` içindeki `jevis` MCP sunucusu `mcp__jevis__*` araçlarını verir. Kullanım kuralları sunucunun kendi talimatında yazıyor; özetle:
- Yeni sayfada önce `browser_read`. Hedefi sayfadaki kelimelerle ver ("Save", "None under Cartoon or Fantasy Violence") ya da `#id` kullan.
- Jev emin olmazsa adayları listeler; tahmin etme, `#id` ile seç.
- Onay penceresinde kullanıcı "Hayır" derse dur ve bildir. Başka bir yol arama.

### App Store işi akışı
1. `appstore/bilgi-karti.md`'yi oku, eksik bilgileri kullanıcıya sor.
2. Gizlilik için `node appstore/privacy-scan.js <kod-klasörü>` çalıştır ve taslağı kullanıcıya onaylat.
3. `browser_open appstoreconnect.apple.com`. Giriş sayfası çıkarsa kullanıcının JEVIS Chrome penceresinde giriş yapmasını bekle.
4. Bölüm bölüm ilerle: `browser_read` → doldur → Save (onay penceresi çıkar) → `browser_verify`.
5. "Add for Review" / "Submit for Review" butonlarına sadece kullanıcı açıkça isterse bas.

## Çalıştırma

- `npm start` → http://localhost:3000 — JEVIS sohbeti: Hızlı (Sonnet 5) / Güçlü (Opus 5.5) model düğmesi, katlanan adım listesi, tarifler ve ayarlar paneli, bas-konuş, DURDUR
- `node cli.js` → JEVIS komutları: `do "…"` (komut ver), `listen --do` (sesle), tarayıcı (open, read, click, type…), masaüstü (`desk …`, `app`, `mac`), `recipe …`, `secret`, `stop`, `doctor`
- `node cli.js app install && node cli.js app open` → menü çubuğu uygulaması JEVIS.app (⌥Space sohbet, ⌥⇧Space bas-konuş, ⌥Esc acil durdur)
- `node appstore/privacy-scan.js <klasör>` → App Privacy taslağı
- `node demo.js` → destek bileti yönlendirme örneği
- `node macos-cli.js "komut"` → eski tek adımlı macOS komutları (Jev dispatcher)
- Masaüstü yardımcısı `bin/jevis-ax`, ilk kullanımda `hands/ax-helper/main.swift`'ten kendiliğinden derlenir.

## Testler

- `node tests/browser-e2e.mjs` → tarayıcı elleri (gerçek Chrome + Jev, test sayfası)
- `node tests/mcp-smoke.mjs` → MCP sunucusu
- `node tests/guard-e2e.mjs` → kasa, bekçi, acil durdurma (Anahtar Zinciri'ne test kaydı ekleyip siler)
- `node tests/desktop-e2e.mjs` → masaüstü elleri (Hesap Makinesi ve TextEdit'i açıp kapatır)
- `node tests/app-e2e.mjs` → sohbet sunucusu: hızlı yol, Claude Code beyni, DURDUR, OpenAI uyumlu adaptör, arayüz (aboneliğinden iki kısa çalışma harcar)
- `node tests/voice-e2e.mjs` → ses: whisper, sessizlik filtresi, sesli cevap (hoparlörsüz), arayüz kayıt kodu, mikrofon
- `node tests/recipe-e2e.mjs` → tarifler: kaydet, beyinsiz oynat, değişkenler, beyne devretme
- `node tests/router-e2e.mjs` → hızlı yol kararları (30 Türkçe komut, hiçbir şey yapmaz)
- `node tests/fast-e2e.mjs` → hızlı yol uçtan uca: ses (eski seviyeye döner), Hesap Makinesi, YouTube, Google, sayfada tıklama
- `node tests/apps-e2e.mjs` → Spotify'ı okur (dokunmaz), koordinatla tıklama, bekleme, TextEdit pencereleri arasında geçiş
- `node tests/learn-e2e.mjs` → öğrenen tarifler (geçici bir JEVIS klasöründe; gerçek öğrenilenlere dokunmaz)
- `node tests/files-e2e.mjs` → dosya ve proje araçları (~/Library/Caches altında geçici klasör; TextEdit'i açıp kapatır)
- `node tests/appshortcuts-e2e.mjs` → Spotify'da gerçekten çalar ve sonra duraklatır; Müzik/Notlar/Anımsatıcılar/Takvim betiklerini sadece derler (macOS izni verilmişse okur)
- `node tests/dispatcher-dryrun.mjs` → eski macOS komut yönlendirici (deneme modu)
