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

- `npm start` → http://localhost:3000 (Karar Laboratuvarı + macOS Kontrol Merkezi)
- `node cli.js` → JEVIS komutları (open, read, click, type, select, check, upload, tabs, shot, verify…)
- `node appstore/privacy-scan.js <klasör>` → App Privacy taslağı
- `node demo.js` → destek bileti yönlendirme örneği
- `node macos-cli.js "komut"` → eski tek adımlı macOS komutları (Jev dispatcher)
- Masaüstü yardımcısı `bin/jevis-ax`, ilk kullanımda `hands/ax-helper/main.swift`'ten kendiliğinden derlenir.

## Testler

- `node tests/browser-e2e.mjs` → tarayıcı elleri (gerçek Chrome + Jev, test sayfası)
- `node tests/mcp-smoke.mjs` → MCP sunucusu
- `node tests/guard-e2e.mjs` → kasa, bekçi, acil durdurma (Anahtar Zinciri'ne test kaydı ekleyip siler)
- `node tests/desktop-e2e.mjs` → masaüstü elleri (Hesap Makinesi ve TextEdit'i açıp kapatır)
- `node tests/dispatcher-dryrun.mjs` → eski macOS komut yönlendirici (deneme modu)
