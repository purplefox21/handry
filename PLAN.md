# JEVIS — Proje Planı ve Hafızası

> **Durum (2026-09-28):** Faz 0-4 ✅ (Faz 2'deki gerçek App Store işi kullanıcı bekleniyor). Faz 5 (sohbet kutusu + beyin seçimi) devam ediyor.
> **Öncelik:** Faz 0 → 1 → 2. App Store işi Faz 2'de biter.
>
> Bu dosya projenin hafızası. Her oturumda buradan devam edilir. Bir faz bitince kutular işaretlenir, "Durum" satırı güncellenir ve commit alınır.

---

## 1. Hedef

Bilgisayarımı ve tarayıcımı benim yerime kullanan, hızlı ve beyni değiştirilebilir bir asistan.

- **Jev** nereye tıklanacağını ve nereye yazılacağını yarım saniyede seçer.
- **Beyin** (bir LLM) planı yapar.
- **Bizim kodumuz** tıklar ve yazar.

**İlk gerçek iş:** Mobil uygulamamın App Store Connect bilgilerini doldurmak: fiyat, yaş sınırı anketi, gizlilik anketi, açıklamalar, ekran görüntüleri. Bu iş elle saatler sürüyor.

## 2. Sonunda elimizde ne olacak?

- **JEVIS:** Chrome'da ve her Mac uygulamasında tıklayan, yazan, okuyan, ekran görüntüsü alan ve dosya yükleyen yerel bir asistan.
- **Değiştirilebilir beyin:** Claude Code (abonelik), Codex, Gemini CLI, API ya da yerel model. Biri istediğini yapmazsa beyin değişir, eller aynı kalır.
- **Hızlı yol:** Basit tek adımlık komutlar hiç LLM'e gitmeden, sadece Jev ile anında çalışır.
- **Güvenlik:** Riskli işlerde onay penceresi. Şifreler Anahtar Zinciri'nde durur ve LLM'e hiç gitmez. Ayrıca acil durdurma ve eylem kaydı.
- **Tarifler:** Tekrar eden işler (örneğin her sürümde App Store güncellemesi) kaydedilir, sonra tek komutla ve saniyeler içinde tekrar oynatılır.

## 3. Nasıl kullanılacak?

| Yol | Nerede | Hazır olduğu faz |
|---|---|---|
| **Claude Code sohbeti** | VS Code panelinde veya terminalde yazarsın, Claude Code JEVIS araçlarını kullanır | Faz 2 |
| **JEVIS sohbet kutusu** | `localhost:3000`: sohbet, canlı eylem akışı, onay kartları, DURDUR butonu, beyin seçici | Faz 5 |
| **Ses** | Kısayola basıp konuşursun, cevap sesli gelir | Faz 6 |
| **Hızlı komut** | Beyin yok, sadece Jev: "sesi kıs", "fiyatlandırmaya git" | Faz 1 (terminal), Faz 5 (arayüz) |

**Örnek akış (App Store):**

```
Sen: "X uygulamasında fiyatı ücretsiz yap, yaş sınırı anketini doldur, göndermeden önce bana sor."

1. Beyin planlar              → browser_open("appstoreconnect.apple.com")
2. browser_act("fiyatlandırma") → Jev 0.3 sn: "Pricing and Availability" → tıklandı
3. browser_select("Price", "Free")
4. browser_act("Save")          → Jev: "fiyat değişikliği, riskli" → macOS onay penceresi → Evet
5. Beyin: "Fiyat ücretsiz yapıldı. Sırada yaş sınırı anketi var."
```

## 4. Mimari

```
Sen (yazı / ses)
   │
🧠 BEYİN (değiştirilebilir): Claude Code · Codex · Gemini CLI · API · yerel model
   │   "ne yapılacak?"
   ▼
🔌 JEVIS MCP sunucusu (bizim kod, bu bilgisayarda, ağa port açmaz)
   ├─ ⚡ JEV: "Hangi öğe?" / "Riskli mi?" / "Sayfa beklenen halde mi?"  (0.3–0.5 sn)
   │        Emin değilse → ekran görüntüsü beyne gider
   ├─ 🌐 TARAYICI ELLERİ: Playwright + Chrome (ayrı profil, oturumlar kalıcı)
   ├─ 🖥️ MASAÜSTÜ ELLERİ: erişilebilirlik ağacı + fare/klavye + ekran görüntüsü (Swift yardımcı)
   ├─ 🍎 HIZLI SİSTEM KOMUTLARI: uygulama aç/kapat, ses, Spotify, Notlar…
   └─ 🔐 KORUMA: onay penceresi · Anahtar Zinciri kasası · gizli talimat bekçisi · kayıt · acil durdurma
```

**Hedef klasör yapısı.** Taşımalar ilgili fazda yapılır, erkenden değil:

```
jev/
├── PLAN.md · CLAUDE.md
├── core/jev.js          # Jev istemcisi + hazır kararlar (öğe seç, riskli mi, durum kontrolü, rota)
├── hands/browser.js     # Playwright + Chrome
├── hands/desktop.js     # Masaüstü: erişilebilirlik, fare, klavye, ekran görüntüsü
├── hands/mac.js         # Hızlı sistem komutları (eski macos-controller.js)
├── hands/ax-helper/     # Swift yardımcı program (erişilebilirlik + fare/klavye olayları)
├── guard/               # onay, kasa (Anahtar Zinciri), gizli talimat bekçisi, eylem kaydı
├── mcp/server.js        # MCP sunucusu
├── brain/               # beyin adaptörleri: claude-code, codex, api, ollama
├── app/                 # sohbet kutusu: sunucu + arayüz (Karar Laboratuvarı da burada kalır)
├── voice/               # whisper.cpp + say
├── recipes/             # kaydedilmiş iş akışları
└── cli.js               # terminalden test + hızlı komut
```

## 5. Temel kararlar ve nedenleri

1. **Claude in Chrome kullanılmayacak.** Kullanıcı denedi: çok yavaş, şifre girmeyi reddediyor. Tekrar önerilmeyecek.
2. **Tarayıcı olarak Chrome ve Playwright.** Chrome ayrı bir profille (`~/.jevis/chrome-profile`) ve yalnızca bu bilgisayardan erişilebilen bir hata ayıklama portuyla normal şekilde açılır, Playwright sonradan bağlanır.
   - Neden: Gerçek tıklama ve klavye olayları, dosya yükleme, bekleme, ekran görüntüsü, sekmeler hazır geliyor. Bir kere giriş yaparsın, oturum açık kalır.
   - Normal açılan Chrome'da girişler sorunsuz çalışır. Otomasyon moduyla açılan tarayıcılarda bazı siteler girişi engelleyebiliyor.
   - Safari şimdilik yok, sonra eklenebilir.
3. **Jev öğe seçer, metin üretmez.** Beyin "ne" yapılacağını söyler, Jev "nereye" sorusunu cevaplar, kod yapar. Yazılacak metni ya kullanıcı söyler ya beyin üretir.
4. **Her şey MCP araçları olarak sunulur.** Böylece beyin değiştirilebilir. Bağlantı doğrudan (stdio) kurulur, ağa port açılmaz.
5. **İlk beyin Claude Code (abonelik).** Yavaş kalırsa ya da reddederse: Codex CLI, Gemini CLI, API (Anthropic / OpenAI uyumlu) veya Ollama.
6. **Şifreler LLM'e hiç gitmez.** macOS Anahtar Zinciri'nden kod okuyup yazar, kayıtlarda maskelenir.
7. **Riskli işlerde onay.** Gönderme, yayınlama, silme, ödeme, fiyat değişikliği gibi işlemlerde macOS onay penceresi açılır. Riskli olup olmadığına Jev karar verir ("Bu tıklama geri alınamaz ya da dışarıyı etkiler mi?"), ayrıca bir kural listesi var. Kullanıcı ayarlardan değiştirebilir.
8. **Güven eşikleri** ayar dosyasında durur. Başlangıç değerleri:
   - Jev ≥ 0.85 eminse hemen yapar.
   - Daha az eminse ekran görüntüsünü beyne gönderir.
   - "Hiçbiri" seçerse beyne sorar.
9. **Git disiplini:** Her değişiklikten önce ve sonra commit alınır. `.env` asla commit edilmez.

## 6. Fazlar

### Faz 0 — Hazırlık ve temizlik
- [x] Git kuruldu, ilk kayıt alındı (`6b77f32`), `.env` git dışında
- [x] PLAN.md + CLAUDE.md
- [x] Güvenlik açığını kapat: `server.js` sadece `127.0.0.1`'i dinlesin, `Access-Control-Allow-Origin: *` kalksın, `/api/macos/execute` yerel bir token istesin
- [x] `macos-controller.js`: kabuk komutlarını `exec` yerine `execFile` / argüman dizisiyle çalıştır (kesme işareti hatası ve enjeksiyon açığı)
- [x] `jev-dispatcher.js`: `media_control` dalını bağla ("sonraki şarkı" çalışsın)
- [x] Bağımlılıklar: `playwright-core`, `@modelcontextprotocol/sdk`, `zod`

**Bitince:** Eski özellikler güvenli ve düzgün çalışıyor, yeni fazların temeli hazır.
**Test:** "Ali'ye süt al" notu oluşuyor. "Sonraki şarkı" çalışıyor. Başka bir sitenin localhost'a gönderdiği istek reddediliyor.
**Sonuç:** `node tests/dispatcher-dryrun.mjs` 6/6 doğru (deneme modu, Mac'e dokunmaz). Sunucu testi: tokensiz 401, yabancı Origin 403, sahte Host 403, CORS başlığı yok, sadece 127.0.0.1. Kabuk enjeksiyonu denemesi (`$(...)`) metin olarak kaldı. Ek düzeltme: medya AppleScript'i tek satıra birleştirildiği için zaten bozuktu, düzeltildi. Ayrıca `dispatchCommand(..., { dryRun: true })` eklendi.

### Faz 1 — Jev çekirdeği ve tarayıcı elleri
- [x] `core/jev.js`: tek TypeSafe istemcisi. Fonksiyonlar: `pickElement(talimat, adaylar)` ("hiçbiri" seçeneği dahil), `isRisky(eylem)`, `checkState(beklenen)`
- [x] Büyük sayfalar: 60'tan fazla öğe varsa adaylar 50'lik gruplara bölünür, tek istekte paralel sorulur, sonra kazananlar arasında son seçim yapılır. Hız ve doğruluk ölçülecek.
- [x] `hands/browser.js`: Chrome'u ayrı profille aç ve bağlan. Araçlar: `open`, `tabs` (listele / geç / kapat), `read`, `act`, `type`, `select`, `check`, `upload`, `scroll`, `back`, `wait`, `screenshot`
- [x] Öğe listesi çıkarıcı: görünür etkileşimli öğeler (buton, bağlantı, alan, sekme, onay kutusu, açılır liste). Her öğe için etiket, placeholder ve aria adı; durumu (seçili / dolu / pasif). iframe desteği.
- [x] Doğrulama: Her eylemden sonra sayfa beklendiği gibi değişti mi, hata mesajı çıktı mı? (Jev `noul`)
- [x] Basit onay penceresi: riskli tıklamada macOS diyaloğu
- [x] `cli.js`: `node cli.js open appstoreconnect.apple.com`, `node cli.js click "fiyatlandırma"`

**Bitince:** Terminalden adım adım komut vererek Chrome'u Jev ile yönetebiliyorsun. Henüz beyin yok, komutları sen veriyorsun.
**Test:** App Store Connect ve 2 başka sitede 20 komutluk liste. Hedef: en az 18/20 doğru öğe, sayfa yüklemesi hariç eylem başına 1 saniyenin altında.
**Sonuç:**
- `node tests/browser-e2e.mjs` (App Store Connect'e benzeyen test sayfası, gerçek Chrome + Jev): **27/27**, adım başına ortalama **0.48 sn**. Kapsam: React div'leri, aynı isimli iki "Edit", gizli input'lu onay kutusu, özel açılır liste, Türkçe "ücretsiz" → "Free", modal içinde aynı isimli radyolar, gizli dosya alanı, iframe, yeni sekme, riskli butonlarda onay/ret, "hiçbiri" durumu.
- Gerçek siteler: Vikipedi araması, Hacker News "new", sekme geçişi, ekran görüntüsü, `verify`. 9/9.
- Gerçek App Store Connect testi, kullanıcı JEVIS Chrome profilinde bir kez giriş yapınca yapılacak.

**Öğrenilenler:**
- Jev'de tek soruda en fazla 255 seçenek olabiliyor. 250'den fazla aday gruplara bölünüp paralel sorulur (300 aday: 9/9, 0.34 sn).
- Aday başına yaklaşık 21 token harcanıyor.
- Çevre metni sadece etiket gibi duran, tıklanamayan yakın metinden oluşmalı. Diğer linklerin ve butonların isimleri Jev'i şaşırtıyor.
- Sayfadaki kelimelerle yazılan hedefler %96-98 güven alıyor. Serbest Türkçe %60-80'de kalıyor. Bu yüzden beyne "hedefi sayfadaki kelimelerle tarif et" denecek.
- Kabul kuralı: güven ≥ %85, ya da en iyi aday ≥ %60 ve en yakın rakip **öğeden** en az 40 puan önde. "Hiçbiri"ye giden pay rakip sayılmaz.

### Faz 2 — MCP, Claude Code bağlantısı ve App Store işi
- [x] `mcp/server.js`: tarayıcı araçları (`browser_*`) ve `jev_ask`. `jev_ask`, beynin toplu kararlar için Jev'i doğrudan kullanmasını sağlar.
- [x] Jev emin olmadığında ekran görüntüsü beyne resim olarak döner
- [x] Bağlantı: proje kapsamında `.mcp.json` (her yerde kullanmak için: `claude mcp add --scope user jevis -- /opt/homebrew/bin/node /Users/purplefox/Desktop/jev/mcp/server.js`)
- [x] CLAUDE.md'ye JEVIS kullanım kuralları: önce `read` / `act`, ekran görüntüsü sadece gerektiğinde, riskli işlerde onay
- [x] App Store bilgi kartı: fiyat, kategori, yaş sınırı cevapları (`appstore/bilgi-karti.md`)
- [x] Gizlilik anketinin cevaplarını uygulamanın kodundan çıkar (kullanılan SDK'lar, istenen izinler). Kullanıcı onaylar, JEVIS doldurur. (`appstore/privacy-scan.js`, LLM'siz)
- [ ] **Kullanıcı bekleniyor:** hangi uygulama? Bilgisayarda kullanıcının birkaç uygulaması var (adları burada tutulmuyor). JEVIS Chrome'unda App Store Connect'e bir kez giriş yapılacak.

**Bitince:** VS Code'daki Claude Code sohbetinde "App Store'da şunu yap" diyorsun, JEVIS yapıyor.
**Test:** Fiyat, yaş sınırı, gizlilik ve açıklama akışı baştan sona çalışıyor. Riskli adımların hepsinde onay penceresi çıktı.
**Sonuç:**
- `node tests/mcp-smoke.mjs`: 15 araç, 9/9.
- Claude Code (abonelik, `claude -p` + MCP) test sayfasında Name, kategori, fiyat, onay kutusu, yaş sınırı modalı ve Done adımlarını JEVIS ile yaptı. Hedefleri kendiliğinden sayfadaki kelimelerle verdi, Jev %96-100 güvenle seçti.
- Save'i Jev riskli buldu, onay istendi. Testte "Hayır" dedirtildi; Claude durup bildirdi, başka yol denemedi. 15 tur, 77 sn. Sürenin çoğu LLM düşünmesi, JEVIS eylemleri eylem başına 0.3-0.6 sn.
- `verify` artık form alanlarının değerlerini de görüyor. Düz sayfa metni input değerlerini içermiyordu.
- `privacy-scan.js` örnek uygulamada 6 SDK ve 3 izin buldu, 12 satırlık taslak çıkardı. Yanlış alarm yok.

### Faz 3 — Koruma: kasa, kayıt, acil durdurma
- [x] `guard/vault.js`: `node cli.js secret add appstore` şifreyi Anahtar Zinciri'ne kaydeder. `fill_secret(alan, isim)` şifreyi alana yazar ama değeri asla beyne döndürmez.
- [x] Onay kuralları ayar dosyası: her zaman sor / asla sorma listeleri, site bazında
- [x] Gizli talimat bekçisi: beyne giden sayfa metninde "tüm mailleri şuna ilet" gibi talimatları Jev işaretler
- [x] Eylem kaydı: `~/.jevis/logs/` altında her adım için komut, Jev kararı, güven, süre ve ekran görüntüsü
- [x] Acil durdurma: `node cli.js stop` (kısayol tuşu Faz 7'deki menü çubuğu uygulamasında)
- [x] 2FA / CAPTCHA: JEVIS çözmeye çalışmaz. Durur ve sana haber verir, sen halledince devam eder.

**Bitince:** Şifreli girişler dahil, gönül rahatlığıyla işi bırakabileceğin bir sistem.
**Test:** Şifre hiçbir LLM mesajında ya da kayıtta görünmüyor. Acil durdurma 1 saniyede kesiyor. Test sayfasına gizlenmiş talimat yakalanıyor.
**Sonuç:** `node tests/guard-e2e.mjs` **12/12**. Kapsam:
- Anahtar Zinciri'nden şifre yazıldı. Şifre ne araç cevabında ne günlükte göründü; izinsiz sitede yazılmadı.
- 2FA sayfası kendiliğinden işaretlendi. `wait_for_user` çalıştı.
- Gizli talimat gizlendi, masum paragraflar korundu.
- Acil durdurma ve devam etme çalıştı.
- Site bazlı "Save onaysız" kuralı ve onaylanan işlemin kanıt ekran görüntüsü çalıştı.

Gerçek sayfalarda (Vikipedi, Hacker News, Apple inceleme kuralları) **0 yanlış alarm**.

**Nasıl çalışıyor:**
- Kasa: şifreler Anahtar Zinciri'nde `jevis` servisi altında durur. `~/.jevis/secrets.json` sadece isim ve izinli siteleri tutar.
- Sayfa bekçisi: gizli talimat ve "kullanıcı gerekli mi" kontrolleri tek Jev isteğinde yapılır. Metin paragraf bazında parçalanır.
- CLI, MCP ve beyinler aynı `callTool` yolundan geçer; durdurma, kayıt ve bekçi her yerde geçerli.

### Faz 4 — Masaüstü elleri (her Mac uygulaması)
- [x] `hands/ax-helper`: küçük bir Swift programı. Öndeki uygulamanın öğe listesini çıkarır, öğeye basar, değer yazar, koordinata tıklar, klavye kısayolu gönderir, kaydırır, pencere ekran görüntüsü alır.
- [x] `hands/desktop.js` ve MCP araçları: `desktop_read`, `desktop_act`, `desktop_type`, `desktop_key`, `desktop_screenshot`
- [x] Tarayıcıdakiyle aynı Jev yöntemi: "Gönder butonuna bas" dendiğinde Jev öğe listesinden seçer
- [x] `hands/mac.js`: eski hızlı komutlar (uygulama aç/kapat, ses, Spotify, Notlar, karanlık mod…) MCP aracı olarak
- [x] Erişilebilirlik ağacı boş gelen uygulamalarda ekran görüntüsü ve beynin görsel yorumu yedek olarak kullanılır
- [x] İzin kontrolü: `jevis-ax trusted` (Erişilebilirlik ve Ekran Kaydı bu Mac'te zaten verilmiş; izin yoksa araçlar ne yapılacağını söyler)

**Bitince:** "Xcode'da Release şemasını seç", "Ayarlar'da Wi-Fi'yi kapat", "Spotify'da sonraki şarkı" gibi komutlar çalışıyor.
**Test:** 5 uygulamada (Finder, Xcode, Sistem Ayarları, Notlar, Spotify) 20 komut. Hedef: en az 17/20.
**Sonuç:** `node tests/desktop-e2e.mjs` **23/23**. Kullanıcının açık uygulamalarına dokunmamak için Hesap Makinesi ve TextEdit ile test edildi.
- Türkçe adla uygulama açma.
- 12+30=42: butonlara fare yerine erişilebilirlik üzerinden basıldı, eylem başına 0.6-0.9 sn.
- Menü öğesi ("Düz Metin Yap"): menü açılmadan basıldı.
- Metin alanına yazma: erişilebilirlik değeri üzerinden, klavye olayı yok.
- "Kaydedilsin mi?" dialogunu okuma ve onaylı "Sil".
- cmd+q engeli, pencere ekran görüntüsü, VS Code (Electron) okuma: 193 öğe.

Claude Code (claude -p + MCP) Hesap Makinesi'nde 7×8=56'yı Türkçe buton adlarıyla hesaplayıp uygulamayı kapattı: 11 tur, 42 sn.

**Öğrenilenler:**
- Menü çubuğu başlığına basmak menüyü açık bırakıp uygulamayı kilitliyor. Başlıklar aday listesinden çıkarıldı; menü öğeleri "Dosya > Kapat" yoluyla listeleniyor.
- Dialog butonlarının anlamı pencere metninde saklı ("bu belgeyi tutmak istiyor musunuz?"). Jev'e pencerenin metinleri de veriliyor.
- Kaydedilmemiş belge varken `quit` cevap beklerse takılıyor. Artık cevap beklenmiyor; açık kalan "kaydedilsin mi?" sorusu beyne bildiriliyor.
- Onay kelimeleri iki sınıf:
  - **Kesin** (gönder, yayınla, öde, add for review…): her zaman sorulur.
  - **Yumuşak** (sil, delete): Jev risk %30'un altındaysa sorulmaz ("Tümünü Sil" %21, belgeyi atan "Sil" %92, "Delete App" %90).
- Uygulama adları Türkçe ("Hesap Makinesi"); paket kimliğiyle ve Jev ile eşleştiriliyor.

### Faz 5 — JEVIS sohbet kutusu ve beyin seçimi
- [ ] `app/`: "macOS Kontrol Merkezi" ekranı JEVIS sohbetine dönüşür. İçinde: sohbet, canlı eylem akışı (Jev neyi seçti, ne kadar emin, ne kadar sürdü, küçük ekran görüntüsü), onay kartları, DURDUR butonu, beyin seçici
- [ ] `brain/claude-code.js`: Claude Code'u arka planda (`claude -p`, abonelikle) JEVIS araçlarıyla çalıştırır ve akışı arayüze aktarır
- [ ] `brain/codex.js`, `brain/api.js` (Anthropic / OpenAI uyumlu), `brain/ollama.js` (yerel)
- [ ] Hızlı yol: Jev "bu tek adımlık basit bir komut mu?" diye bakar. Öyleyse beyne gitmeden hemen yapılır.
- [ ] Sunucu sadece `127.0.0.1`'i dinler ve oturum anahtarı ister
- [ ] Karar Laboratuvarı (Jev deney alanı) ayrı bir sekme olarak kalır

**Bitince:** Tarayıcıda `localhost:3000`'i açıp yazıyorsun, beyin olarak hangi LLM'in çalışacağını seçiyorsun.
**Test:** Aynı App Store akışı hem Claude Code hem de başka bir beyinle çalışıyor. Basit komutlar 1 saniyenin altında.

### Faz 6 — Ses
- [ ] Her yerden çalışan bas-konuş kısayolu
- [ ] whisper.cpp ile yerel Türkçe konuşma tanıma (M5 Pro'da hızlı çalışır)
- [ ] `say` ile Türkçe sesli kısa cevaplar
- [ ] (İsteğe bağlı) "Hey Jevis" uyandırma kelimesi

**Bitince:** Sabah senaryosu sesle çalışıyor: "Günaydın, jev projesini VS Code'da aç, Claude paneline 'selam dünya' yaz, tarayıcıda sitelerimi aç, bu hafta dinlediğim tarzda müzik aç, son 20 mailimi webden okuyup özetle."

### Faz 7 — Tarifler ve uygulama haline getirme
- [ ] Başarılı akışlar tarif olarak kaydedilir. Adımlar doğal dilde saklanır ("Pricing and Availability'e tıkla"), böylece sayfa düzeni değişse bile tekrar oynatırken Jev doğru öğeyi bulur.
- [ ] Tarif oynatma beyinsiz, sadece Jev ile çalışır: çok hızlı, neredeyse bedava. Takılırsa beyne devreder.
- [ ] Hazır tarifler: `appstore-yeni-surum`, `appstore-fiyat`, sabah rutini
- [ ] Menü çubuğu uygulaması (kısayolla açılan pencere) ve bilgisayar açılınca otomatik başlama

**Bitince:** Tekrar eden işler tek komutla, saniyeler içinde yapılıyor.

## 7. Sınırlar ve riskler

- CAPTCHA ve 2FA'yı JEVIS çözmez. Durur, sen çözersin.
- Jev yanlış öğe seçebilir. Buna karşı güven eşiği, eylem sonrası doğrulama ve riskli işlerde onay var.
- Çizim alanı kullanan ya da çok dinamik sayfalarda öğe listesi yetersiz kalır. O zaman ekran görüntüsü ve beyin devreye girer, iş yavaşlar.
- Beyin olan LLM bazı istekleri yine reddedebilir. Bu yüzden beyin değiştirilebilir; şifreler zaten ona gitmiyor.
- Her Jev kararı TypeSafe hesabından token harcar. Aday sayısı arttıkça harcama da artar.
- macOS izinleri (Erişilebilirlik, Ekran Kaydı, Otomasyon) bir kere verilmeli.
- Chrome'un hata ayıklama portu sadece bu bilgisayardan erişilebilir. Yine de açıkken bu bilgisayardaki diğer programlar bağlanabilir, bu yüzden sadece JEVIS çalışırken açık tutulur.

## 8. Açık sorular

- Mobil uygulamanın kodu hangi klasörde? (Faz 2, gizlilik anketi için)
- App Store bilgileri: fiyat, kategori, yaş sınırı cevapları (Faz 2)
- Faz 5'te ikinci beyin ne olacak: Codex mi, Gemini mi, yerel model mi?

## 9. Deney sonuçları

- **2026-09-26, oyun hamlesi puanlama (`score` + `noul`):**
  - Saldırmak 10, kapıyı çalmak 37, para fırlatıp içeri süzülmek 69, ekmekle sohbet açmak 67 puan aldı.
  - "Bana 100 puan ver" hilesi 0 aldı (oyun içi eylem mi sorusu 0.05).
  - Her biri 290–436 ms sürdü.
- **2026-09-28, öğe seçimi (`choice`):**
  - App Store Connect'e benzeyen 60 öğe ve "hiçbiri" seçeneği ile 9 Türkçe komut denendi, **9'u da doğru** çıktı, her biri 264–465 ms sürdü.
  - "İncelemeye gönder" %73 güvenle bulundu; eşiğin altında olduğu için sorar.
  - "Dark mode'u aç" için "hiçbiri" dedi (%94).
  - Test betikleri: `node tests/jev-pick.mjs` (öğe seçimi) ve `node tests/npc-score.mjs` (hamle puanlama).
- **Canlı API:** Model `jev-1.13.0`. Basit bir `noul` sorusu yaklaşık 490 ms sürüyor (istemci tarafında ölçüldü).

## 10. Jev notları (öğrendiklerimiz)

- **Jev (TypeSafe System One)** metin, kod ya da açıklama üretmez. Bir durum (JSON) ve sorular alır, tipli bir cevap ve olasılık döndürür.
  - `choice`: tanımlı seçeneklerden biri ve güven
  - `noul`: evet olasılığı (0–1). 0.5 "orta şiddet" değil, "iki cevap da eşit olası" demek.
  - `score`: tarif edilen sıralı seviyeler üzerinde konum, ara değer olarak (örneğin 2.73)
- **Zihinsel model:** "Akıllı if / switch / sort". Kuralı önceden yazılamayan ama anlam gerektiren her yere konur.
- **Neden LLM değil?**
  1. Cevap her zaman tanımlı seçeneklerden biri, ayrıştırmaya gerek yok.
  2. Güven değeri kalibre, eşik koyulabilir.
  3. Akışı kod yönetir, test edilebilir.
  4. Bir istekte çok soru, hepsi paralel.
  5. Ölçek: sürekli ve çok sayıda karar gerektiren işler LLM ile pahalı ve yavaş.
- **Yapamadıkları:** Metin, kod ya da çeviri üretmek; çok adımlı akıl yürütmek; görüntü görmek (sadece metin okur).
- **1–100 puan:** Doğrudan "kaç puan?" diye sorulmaz. 4–5 net seviye tarif edilir, Jev'in ara değeri kodda 1–100'e çevrilir. **Matematik kodda, yargı Jev'de.**
- **Güven eşiği örneği:** ≥0.9 ise otomatik yap, 0.5–0.9 arasıysa sor, altındaysa bırak. Gerçek veriyle ayarlanmalı.
- **Fikir üretmek için kalıp:** "Sürekli akan veri + her adımda anlam gerektiren küçük bir karar." Soru: "İnsan gibi bir yargıyı saniyede yüzlerce kez, neredeyse bedavaya verebilseydim ne yapardım?"
- **Kaynaklar:** https://docs.typesafe.ai/llms.txt. İlgili örnekler: function calling, fan-out (paralel sorular), rerank, LLM guardrails, citation check, pre-parsed value extraction. Ayrıca `.agents/skills/typesafe-ai/SKILL.md`.

## 11. Fikir havuzu (JEVIS'ten sonra)

- **Serbest metinli oyun:** Jev hakem, kod kurallar ve hafıza, LLM anlatıcı. Tohumlar: sorgu odası, pazarlık, hayatta kalma.
- **Canlı çeviri zamanlayıcısı:** Jev "cümlenin anlamı kesinleşti mi?" diye bakar, kesinleşince çevirmen başlar.
- **Sözü kesmeyen sesli asistan:** "Kullanıcı bitirdi mi, yoksa düşünüyor mu?"
- **Yaşayan köy:** 200 NPC olayları değerlendirir, dedikodu yayılır.
- **Hikâyeye göre değişen müzik.**
- **Twitch sohbeti oyunu yönetir.**
- **Göndermeden önce uyaran klavye.**
- **Canlı tartışma hakemi.**
- **Sözleşme tuzak dedektörü.**
- **Bildirim kalkanı.**
- **Turing partisi.**
- **Anlamla arama.**
- **Odak Bekçisi.**

## 12. Mevcut kod (2026-09-28)

| Dosya | Ne yapıyor |
|---|---|
| `server.js` | Web arayüzü + `/api/evaluate` (Jev proxy) + `/api/macos/execute` |
| `jev-dispatcher.js` | Jev ile komutu 11 aksiyondan birine ayırır; parametreler regex ile çıkarılır |
| `macos-controller.js` | AppleScript, `open` ve `screencapture` işlemleri |
| `macos-cli.js` | Terminal arayüzü |
| `public/` | Karar Laboratuvarı + macOS Kontrol Merkezi |
| `demo.js` | Destek bileti yönlendirme örneği |
| `tests/` | Jev deneyleri: öğe seçimi (`jev-pick.mjs`), hamle puanlama (`npc-score.mjs`) |

**Bilinen sorunlar (Faz 0'da düzelecek):**
1. `media_control` dalı bağlı değil, "sonraki şarkı" çalışmıyor (`jev-dispatcher.js`).
2. Kesme işareti kabuk komutunu kırıyor (`createNote` vb.). Bu aynı zamanda bir enjeksiyon açığı. Arama sorgusu çıkarıcı da kesme işaretini tırnak sanıyor.
3. `server.js`'te CORS herkese açık (`*`) ve `/api/macos/execute` şifresiz. Herhangi bir site bu bilgisayara komut gönderebilir.

## 13. Geçmiş

- **2026-09-25:** Proje incelendi; JEVIS ve Jev'in yetenekleri araştırıldı.
- **2026-09-26:** macOS kısımları silindi (sadece Jev kalsın denmişti). Jev konuşmaları ve deneyler yapıldı.
- **2026-09-28:** Faz 4 bitti: Swift erişilebilirlik yardımcısı, masaüstü elleri, mac_action, terminal/kısayol korumaları. 23/23.
- **2026-09-28:** Faz 3 bitti: kasa, kayıt, acil durdurma, gizli talimat bekçisi, kullanıcıyı bekleme, site bazlı onay kuralları.
- **2026-09-28:** Faz 2 bitti: MCP sunucusu, Claude Code ile uçtan uca test, gizlilik tarayıcısı, bilgi kartı.
- **2026-09-28:** Faz 1 bitti: Jev çekirdeği, tarayıcı elleri, CLI, onay penceresi. Test sayfasında 27/27, gerçek sitelerde 9/9.
- **2026-09-28:** Faz 0 bitti: güvenlik açığı kapandı, 3 hata düzeldi, bağımlılıklar kuruldu.
- **2026-09-28:** Silinenler geri istendi ve kayıtlardan byte byte geri getirildi. Git kuruldu (`6b77f32`). Claude in Chrome reddedildi, kendi JEVIS sistemimize karar verildi. Bu plan yazıldı.
