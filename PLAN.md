# JEVIS — Proje Planı ve Hafızası

> **Durum (2026-09-28):** Faz 0-8 ✅ hepsi tamam. Faz 9 (kompakt çubuk, canlı ses, "Hey Jev") planlandı; kullanıcı "başla" deyince başlanacak. Kullanıcıdan beklenenler en altta, "14. Senden gerekenler" bölümünde. Kullanıcıdan beklenenler en altta, "14. Senden gerekenler" bölümünde (App Store işi, izinler, JEVIS.app kurulumu).
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
   - **Model kararı (2026-09-28, kullanıcı):** Varsayılan **Sonnet 5 + yalın mod + effort high**. Arayüzde tek tıkla **Opus 5.5**'e ("Güçlü") geçilir. Opus 4.8 bırakıldı: hem en pahalı hem en eski.
   - **Yalın mod:** Claude Code'un uzun kodlama talimatı yerine kısa JEVIS talimatı (`--system-prompt`) verilir, dahili kodlama araçları kapatılır (`--tools ""`). JEVIS araçları yine MCP'den gelir. Her turda tekrar okunan yük yaklaşık 5 kat azalır; beyinde terminal ve dosya erişimi de olmaz.
   - Opus 5.5 için `claude` 2.1.280 veya üstü gerekiyor; kullanıcı 2.1.283'e güncelledi.
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
- [x] `app/`: "macOS Kontrol Merkezi" ekranı JEVIS sohbetine dönüşür. İçinde: sohbet, canlı eylem akışı (Jev neyi seçti, ne kadar emin, ne kadar sürdü, küçük ekran görüntüsü), onay kartları, DURDUR butonu, beyin seçici
- [x] `brain/claude-code.js`: Claude Code'u arka planda (`claude -p`, abonelikle) JEVIS araçlarıyla çalıştırır ve akışı arayüze aktarır
- [x] `brain/codex.js` (deneysel, bu Mac'te kurulu olmadığı için test edilmedi), `brain/anthropic.js` (Anthropic SDK, anahtar gerekir), `brain/openai-compatible.js` (OpenAI, Ollama, LM Studio… sahte sunucuyla test edildi)
- [x] Hızlı yol (`core/router.js`): Jev "bu tek adımlık basit bir komut mu?" diye bakar. Öyleyse beyne gitmeden hemen yapılır.
- [x] Sunucu sadece `127.0.0.1`'i dinler ve oturum anahtarı ister
- [x] ~~Karar Laboratuvarı ayrı bir sekme olarak kalır~~ Kullanıcı gereksiz buldu. 2026-09-28 arayüz yenilemesinde kaldırıldı; git geçmişinde duruyor.

**Bitince:** Tarayıcıda `localhost:3000`'i açıp yazıyorsun, beyin olarak hangi LLM'in çalışacağını seçiyorsun.
**Test:** Aynı App Store akışı hem Claude Code hem de başka bir beyinle çalışıyor. Basit komutlar 1 saniyenin altında.
**Sonuç:** `node tests/app-e2e.mjs` **7/7**:
- Hızlı yol, beyin kullanmadan: "hesap makinesini aç" 1.2 sn; açık sayfada "fiyatlandırma bölümüne tıkla" 1.3 sn. Karar Jev'in 0.3-0.5 sn'lik tek sorusu; sürenin geri kalanı işin kendisi.
- Claude Code beyni formu doldurdu: 17.5 sn.
- İkinci iş 409 ile reddedildi; DURDUR çalışan işi 0.6 sn'de kesti.
- OpenAI uyumlu adaptör sahte sunucuyla araç çağırıp cevap verdi.
- JEVIS kendi sohbet arayüzünü kendi elleriyle kullandı.

**Öğrenilenler:**
- Arayüz JEVIS'in Chrome'unda açılırsa tarayıcı elleri o sekmeyi "yönetilecek sayfa" sanıyor. Sunucu kendi portunu `JEVIS_UI_PORT` ile duyuruyor, o sekme atlanıyor.
- Acil durdurma bir sonraki kullanıcı komutuna ya da 10 dakikaya kadar geçerli. Başka Claude Code oturumlarındaki JEVIS araçlarını da durdurur.
- Codex ve Gemini CLI bu Mac'te kurulu değil. Anthropic API anahtarı yok. OpenAI/Ollama için `jevis.config.json` › `brain.providers` altında model adı girilmeli.
- Anthropic API beyninde reddedilen isteklerin sunucu tarafında yedek modele devredilmesi (fallbacks) açık.

### Faz 6 — Ses
- [x] Bas-konuş: arayüzdeki mikrofon (basılı tut ya da dokun-başlat/dokun-bitir) ve `node cli.js listen [--do]`. Her yerden çalışan kısayol Faz 7'deki menü çubuğu uygulamasında.
- [x] whisper.cpp ile yerel Türkçe konuşma tanıma: `large-v3-turbo-q5_0`, 574 MB, 3-4 sn'lik cümle 0.6-1 sn.
- [x] `say` ile Türkçe (Yelda) sesli kısa cevaplar: markdown ve linkler atılır, en fazla 320 karakter.
- [ ] (İsteğe bağlı, yapılmadı) "Hey Jevis" uyandırma kelimesi. Sürekli dinleme hem pil hem gizlilik maliyeti getiriyor; bas-konuş ve kısayol yeterli görüldü.

**Bitince:** Sabah senaryosu sesle çalışıyor (tam senaryoyu kullanıcı deneyecek; mail okuma, müzik açma ve Claude paneline yazma kişisel olduğu için otomatik test edilmedi): "Günaydın, jev projesini VS Code'da aç, Claude paneline 'selam dünya' yaz, tarayıcıda sitelerimi aç, bu hafta dinlediğim tarzda müzik aç, son 20 mailimi webden okuyup özetle."

**Sonuç:** `node tests/voice-e2e.mjs` **8/8**. Hoparlör kullanılmadı: konuşmalar `say -o` ile dosyaya üretildi.
- Konuşma → yazı API'si çalışıyor. Sessizlikten yazı uydurulmuyor.
- Sesle verilen komut hızlı yoldan yapıldı. Sesli cevap dosyaya yazıldı; uzun cevabın sadece özeti okunuyor.
- Arayüzün kayıt kodu (44.1 kHz → 16 kHz → WAV → whisper) doğru yazıya çevirdi. Mikrofon kaydı çalışıyor, izin zaten verilmiş.
- Sesli komut → Claude Code: "Vikipedi'yi ve Hacker News'i ayrı sekmelerde aç" 15.8 sn.

**Öğrenilenler:**
- whisper sessizlikte "www.youtube.com.au", "Altyazı M.K." gibi şeyler uyduruyor. Enerji eşiği ve bilinen kalıp filtresi eklendi.
- Teknik isimler için whisper'a bir kelime listesi veriliyor (Jev, VS Code, Claude, Xcode…): "REV" → "Jev".
- Tarayıcıda örnek hızını basit ortalamayla düşürmek tanımayı bozuyor ("Xcode Ağaç ve Proje İdeale"). Tarayıcının kendi dönüştürücüsü (`OfflineAudioContext`) kullanılıyor.

### Faz 7 — Tarifler ve uygulama haline getirme
- [x] Başarılı akışlar tarif olarak kaydedilir. Adımlar doğal dilde saklanır ("Pricing and Availability'e tıkla"), böylece sayfa düzeni değişse bile tekrar oynatırken Jev doğru öğeyi bulur.
- [x] Tarif oynatma beyinsiz, sadece Jev ile çalışır: çok hızlı, neredeyse bedava. Takılırsa beyne devreder.
- [x] Hazır tarifler: `sabah-rutini` şablonu (değişkenli, düşünme adımlı). App Store tarifleri ilk gerçek App Store işinden "📌 Tarif olarak kaydet" ile kaydedilecek; gerçek sayfa görülmeden yazılırsa yanlış olur.
- [x] Menü çubuğu uygulaması JEVIS.app: ⌥Space sohbet, ⌥⇧Space basılı tut-konuş, ⌥Esc acil durdur; sunucuyu kendisi başlatır. Açılışta başlama `node cli.js autostart on` ile; varsayılan kapalı.

**Bitince:** Tekrar eden işler tek komutla, saniyeler içinde yapılıyor.
**Sonuç:**
- `node tests/recipe-e2e.mjs` **7/7**:
  - İşten tarif çıkarma: #id hedefleri isimlere çevriliyor.
  - Beyinsiz tekrar oynatma, değişkenler, takılınca beyne devretme, düşünme adımı.
  - Sohbet API'sinden "tarif: …" komutu **2.5 sn**. Aynı iş Claude ile 17-25 sn sürüyor.
- Takılan tarif gerçek Claude Code'a da devredildi, kalan adımları tamamladı (25.7 sn).
- JEVIS.app derlendi ve ad-hoc imzalandı. Sunucuyu kendisi başlattı, ⌥Space ile pencere açıldı ve sohbet yüklendi, ⌥Esc acil durdurmayı yazdı. Uygulama kapanınca sunucusu da kapandı.
- `node cli.js doctor` bütün parçaları kontrol ediyor.

**Öğrenilenler:**
- Proje `~/Desktop` içinde olduğu için JEVIS.app'in başlattığı sunucu ilk açılışta macOS'un "Masaüstü klasörüne erişim" iznini bekliyor. Başka bir izin sorusu ekrandayken bu soru sıraya giriyor ve sunucu takılı kalıyor.
- Ekranda cevap bekleyen bir sistem izin sorusu varken macOS uygulamaların öne gelmesine izin vermiyor gibi. Bu yüzden masaüstü testi son çalıştırmada 17/23 kaldı (soru çıkmadan önce 23/23'tü).
- Bu sırada bir güvenlik açığı bulundu: ⌘N, TextEdit yerine öndeki Chrome'a gidiyordu. Artık tuş ve klavye yazısı sadece istenen uygulama gerçekten öndeyse gönderiliyor; değilse "gönderilmedi" hatası dönüyor.

### Faz 8 — Daha hızlı, her uygulamada, öğrenen JEVIS
Kullanıcının isteği: "sesi yüzde 30 yap" gibi basit işler Claude'a gitmesin, Spotify gibi uygulamalar web'e kaçmasın, bir kere yapılan iş öğrenilsin.

- [x] **1. Hızlı yol v2:** Jev tek istekte komutun türünü (13 tür) ve ayrıntısını (ses ne kadar, hangi müzik tuşu, YouTube mu) seçiyor; basit komutlar Claude'suz çalışıyor. Yüklü 96 uygulamanın hepsi açılıp kapatılabiliyor.
  - `node tests/router-e2e.mjs` **30/30** (karar ortalama ~340 ms), `node tests/fast-e2e.mjs` **9/9**.
  - Ses 0.5 sn, uygulama aç/kapat ~1 sn, sayfada tıklama 1.2 sn. Önceden Sonnet ile 15-20 sn.
- [x] **2. Chromium/Electron uygulamaları, pencereler, ekrana bakıp tıklama:**
  - Spotify, Slack, Discord gibi uygulamalar düğmelerini ancak `AXEnhancedUserInterface` açılınca gösteriyor. Yardımcı artık Chromium tabanlı uygulamayı (Frameworks klasöründen) tanıyıp bunu açıyor. Spotify: **0 → 158 isimli öğe**, "Ne çalmak istiyorsun?" kutusunu Jev %93 ile buluyor.
  - `desktop_click_at`: son ekran görüntüsünün pikseliyle tıklama (canvas, oyun). Açıklama + o noktadaki öğe Jev risk kontrolünden geçiyor. Tıklamadan hemen önce yardımcı, noktadaki pencerenin hâlâ hedef uygulamanın olduğunu kontrol ediyor; değilse tıklamıyor.
  - `desktop_windows` / `desktop_focus_window`: bir uygulamanın pencereleri arasında geçiş (ör. her proje için bir VS Code penceresi).
  - `desktop_wait`: bir yazı çıkana (ya da kaybolana) kadar bekleme.
  - `node tests/apps-e2e.mjs` **21/21**, `node tests/desktop-e2e.mjs` **23/23**.
  - Öğrenilen: tam ekran bir uygulamadan (Spotify) masaüstüne dönerken macOS odağı bir anlığına başka uygulamaya verebiliyor. Koordinatla tıklamadaki son kontrol bu yüzden var.
- [x] **3. Öğrenen tarifler (`core/learn.js`):** Claude'un bitirdiği iş kendiliğinden tarif oluyor (`~/.jevis/learned`, repoya girmez).
  - Komutun adımlarda geçen kelimeleri aday; hangilerinin "bir dahaki sefere değişebilecek ayrıntı" olduğuna Jev karar veriyor. Örnek: `Test formunda uygulama adını "[x1]" yap, fiyatı [x2] seç ve kaydet`.
  - Öğrenilmeyenler: sorular ve özetler (orada sonuç cevabın kendisi), yarım kalan işler, Claude'un kendi uydurduğu metinler, görüntüye bakarak tıklamalar.
  - Yeni komut, yönlendiricinin tek Jev isteğinde öğrenilenlerle karşılaştırılıyor (ek bekleme yok). Eşleşirse yeni ayrıntılar komutun kendi kelimelerinden seçiliyor (üretilmiyor) ve adımlar Claude'suz oynatılıyor. Takılırsa Claude devralıyor; iki kez olmazsa o yol unutuluyor.
  - `node tests/learn-e2e.mjs` **7/7**. Öğrenilmiş iş **2.4 sn**; aynı iş Claude ile 7-25 sn.
  - Gerçek deneme: app-e2e'deki gerçek Sonnet 5 çalışması (7.9 sn) kendiliğinden öğrenildi, sonraki iki çalıştırmada Claude'suz **1.7 sn** sürdü. Bu yüzden o test artık `fast: false` ile çalışıyor.
  - Arayüz: cevabın altında "Bunu öğrendim" notu; Tarifler panelinde "öğrenildi" etiketi ve kaç kez Claude'suz yapıldığı.
- [x] **4. Dosya ve proje zekâsı (`hands/files.js`):** 6 yeni araç, hepsi Finder'a tıklamadan, doğrudan dosya sisteminden (~40 ms).
  - `files_list` ("Masaüstü", "İndirilenler" gibi Türkçe adlar da), `files_search` (Spotlight), `files_recent` (son dosyalar, son uygulamalar, son projeler), `files_read` (metin, Word, RTF), `files_open`.
  - `project_activity`: git (dal, son commitler, kaydedilmemiş değişiklikler) + o klasörde çalışan Claude Code oturumları (başlık, ilk ve son istekler, Claude'un son cevabı). Büyük kayıtların sadece başı ve son 6 MB'ı okunuyor.
  - Son projeler: VS Code'un her klasör için tuttuğu kayıt + Claude Code oturumları; hangisinin VS Code'da açık olduğu da görünüyor.
  - Koruma: sadece ev klasörü; `.env`, anahtar/sertifika dosyaları, `.ssh` gibi klasörler ve `~/.jevis` okunmuyor; metinlerdeki API anahtarları ve şifreler `[gizli]` oluyor; açılınca program olarak çalışacak dosyalar önce soruluyor.
  - `node tests/files-e2e.mjs` **13/13**. Gerçek deneme: "kaptan-oyunu projesinde en son ne yaptık" → Sonnet 5 iki araçla **8.1 sn**'de doğru özetledi. Soru olduğu için öğrenilmedi.
- [x] **5. Uygulama kısayolları (`hands/apps.js`) ve yeni hızlı yollar:**
  - Spotify: `spotify_play` arama sonucunu ya da Beğenilen Şarkılar'ı açıp "Çal"a erişilebilirlik ağacından basıyor (Apple Events izni gerekmiyor) ve çaldığını oynatıcıdaki "Duraklat" düğmesinden doğruluyor.
  - Müzik, Notlar, Anımsatıcılar, Takvim: AppleScript (`music_play`, `notes_add`, `notes_find`, `reminders_add`, `reminders_list`, `calendar_events`, `calendar_add`). İzin durumu soru çıkarmadan okunuyor (`jevis-ax automation`); kapalıysa ne yapılacağı Türkçe söyleniyor.
  - Hızlı yollar: "Spotify'da X çal", "beğendiğim şarkıları çal", "not al: …", "bugün/yarın takvimimde ne var", "hatırlatıcılarımda ne var". Çalınacak şeyi ve notun metnini Jev komutun kendi kelimelerinden seçiyor (`core/spans.js`).
  - Tarih isteyen işler ("yarın 9'da hatırlat") Claude'a gidiyor. Yalın modda Claude'un kendi sistem mesajı olmadığı için şimdiki tarih ve saat her mesajın sonuna ekleniyor (önbelleği bozmamak için sistem mesajına değil).
  - Chromium uygulamalarında isimsiz hücreler ve aynı yerde duran kopyalar atılıyor, sınır 900: Spotify arama sayfası 579 → 217 öğe.
  - Testler: `router-e2e` **40/40**, `appshortcuts-e2e` **10/10**. "Spotify'da Tarkan çal" Claude'suz **3.4 sn**, "beğendiğim şarkıları çal" **3.0 sn**.
  - Bilinen sınır: Takvim'in AppleScript'i tekrarlanan etkinliklerin sonraki tekrarlarını göstermeyebilir. Notlar/Anımsatıcılar/Takvim/Müzik için macOS ilk kullanımda bir kere izin soracak.
- [x] **6. JEVIS.app logosu** (`app/macos/icon.swift`): mavi-mor zemin üzerinde beyaz şimşek. `node cli.js app build` her boyutta `.icns` üretiyor; sohbet sayfasının sekme simgesi de bu. Uygulama artık Dock'ta duruyor, normal menüsü var, açılışta penceresi geliyor, sunucu çökerse kendiliğinden yeniden başlıyor.
  - Ad-hoc imzada her derleme yeni bir kimlik demek; macOS izinleri (Masaüstü klasörü, Erişilebilirlik, Ekran Kaydı, Mikrofon) yeniden istenir.

**Yan etki bulundu ve düzeltildi (VS Code "Screen Reader Optimized"):**
- JEVIS bir Electron uygulamasını okumak için erişilebilirlik ağacını açınca VS Code editörünü ekran okuyucu moduna alıyor.
- Ağacı her işlemden sonra kapatmak çalışmıyor: VS Code ağacı saniyelerce geri kurmuyor.
- Çözüm: VS Code ayarlarına `"editor.accessibilitySupport": "off"` eklendi (yedeği alındı, başka ayara dokunulmadı). `node cli.js doctor` bunu kontrol ediyor.

**Test turu sırasında öğrenilen:** Kullanıcı bilgisayarı kullanırken masaüstü testleri uygulamaları öne getiremeyebiliyor. Güvenlik kontrolü o zaman tuş göndermeyi reddediyor (doğru davranış), test düşüyor. Sakin anda tekrar çalıştırınca 23/23 + 13/13 geçti.

### Faz 9 — Kompakt çubuk ve "Hey Jev" (planlandı, kullanıcı "başla" deyince)
Kullanıcının isteği: büyük sohbet penceresi yerine ekranın üstünden açılan küçük bir yazı alanı; yaz, Enter. "Hey Jev" deyince aynı alan açılsın, konuşulanı canlı yazsın, "gönder" demeden gitsin.

Bugünkü durum: sesli kullanım bas-konuş. ⌥⇧Space basılı tutulur, bırakınca whisper yazıya çevirir ve kendiliğinden gönderir. Konuşurken yazı görünmez, sessizlikte kendiliğinden bitmez, uyandırma kelimesi yok.

Yapılan ölçümler (2026-09-28): Apple'ın konuşma tanıması Türkçeyi cihaz içinde (internetsiz) destekliyor (`SFSpeechRecognizer tr-TR`, on-device: evet). macOS 26'nın yeni `SpeechTranscriber`'ı 30 dil destekliyor ama Türkçe yok. whisper.cpp'nin `whisper-stream`, `whisper-command` ve VAD araçları kurulu.

- [x] **9.1 Kompakt çubuk (klavye):** Yapıldı. `app/public/bar.html` + `bar.js`, ortak kod `common.js`'e taşındı. JEVIS.app'te etkinleştirmeyen panel (`BarPanel`): yazarken öndeki uygulama önde kalıyor, "bunu kapat" gibi komutlar doğru uygulamaya gidiyor. Çubuktaki işler büyük pencerenin geçmişinde "Çubuktan" diye görünüyor, Claude oturumu iki arayüz arasında paylaşılıyor. `app-e2e` **8/8** (çubuk adımı dahil).
  - JEVIS.app artık Xcode'un kurduğu "Apple Development" kimliğiyle imzalanıyor: kimliği derlemeden derlemeye aynı, macOS izinleri bir kere verilince kalıyor.
  - JEVIS.app'te ekranın üst ortasında açılan, kenarsız, yüzen bir panel (Spotlight gibi, ~680×52). Tam ekran uygulamaların üstünde ve her masaüstünde görünür.
  - ⌥Space açar/kapatır, Esc ya da dışarı tıklama gizler, Enter gönderir. Çalışırken tek satır canlı durum ("Spotify'da çalınıyor: Tarkan…") ve DURDUR; bitince kısa cevap aşağı doğru açılır, birkaç saniye sonra kendiliğinden kapanır.
  - Arayüz `app/public/bar.html` (sohbet kodunun akış/adım kısmı ortak bir dosyaya alınır). Büyük pencere "ayrıntılar ve geçmiş" olarak kalır, aynı sohbeti paylaşır.
- [x] **9.2 Canlı yazı ve sessizlikte gönderme:** Kodu yazıldı (`app/macos/Listener.swift`), izin bekleniyor.
  - Ölçüm: whisper, sesin başında "Hey Jev" kalınca cümlenin gerisini bozuyor ("Spotify'da Tarkan çal" → "Spotify, Dotar Cancel"). "Hey Jev" yokken doğru ve ~0.5 sn. Bu yüzden Apple'ın kelime zamanlarıyla "Hey Jev" sesten kesilip whisper'a sadece komut gidiyor.
  - Bluetooth kulaklık takılıyken mikrofon açılınca kulaklık düşük kaliteli "arama" moduna geçer; JEVIS dahili mikrofonu tercih ediyor.
  - Mikrofon JEVIS.app'te (Swift). Apple'ın cihaz içi Türkçe tanıması konuşurken kelimeleri anında çubuğa yazar.
  - ~1 sn sessizlik = cümle bitti. Aynı ses whisper'a da gider (JEVIS, VS Code, Claude gibi adları daha iyi tanıyor), doğru metin yerine oturur ve kendiliğinden gönderilir.
  - Göndermeden önce ~1 sn'lik ince bir geri sayım: Enter hemen gönderir, Esc iptal eder, klavyeye dokunmak düzenleme moduna geçirir.
  - Yeni izin: Konuşma Tanıma (ilk kullanımda macOS sorar).
- [x] **9.3 "Hey Jev":** Kodu yazıldı, izin bekleniyor. Mikrofonsuz test: `node tests/listener-e2e.mjs` (macOS'un Yelda sesiyle üretilen kayıtlar JEVIS'in kendi dinleyicisinden geçiyor).
  - Açılıp kapatılabilen sürekli dinleme. Ucuz bir ses/konuşma kapısı; sadece kısa bir konuşma bitince whisper çalışır, metinde "hey jev" (ve "hey cev", "hey jeff" gibi yanlış duyulmuş hâlleri) aranır. Emin olunamayan durumda Jev karar verir ("JEVIS'e mi seslenildi?").
  - Uyanınca çubuk iner, kısa bir ses çalar, 9.2'deki akış başlar. "Hey Jev, sesi kıs" tek nefeste söylenirse komut doğrudan alınır.
  - JEVIS konuşurken ve ekran kilitliyken dinleme durur. Açıkken macOS menü çubuğunda turuncu mikrofon noktası sürekli görünür (sesin hiçbiri bilgisayardan çıkmaz).
  - Ölçülecek: yanlış uyanma (30 dk podcast/YouTube açıkken), kaçırma (20 deneme), gecikme, işlemci/pil. Yetersizse B planı: "hey jev" için openWakeWord ile küçük özel bir model eğitmek.
- [ ] **9.4 Cilalama:** uyanma/gönderme sesleri, sesle verilen komuta sesli cevap (yazılana değil), ayarlar (dinleme açık/kapalı, sessizlik süresi), uygulama logolu yeniden kurulum.

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
- **2026-09-28, beyin modeli karşılaştırması:**
  - Görev: App Store benzeri form (isim, kategori, fiyat, kutucuk, yaş sınırı penceresi). `claude` 2.1.283, her ayar bir kez çalıştı, hepsi doğru yaptı.
  - Maliyet resmi fiyatlarla hesaplandı. Claude Code önbelleğe 1 saatlik yazıyor (girdi fiyatının 2 katı).

  | Ayar | Süre | Maliyet |
  |---|---|---|
  | Opus 4.8, tam (güncellemeden önceki varsayılan) | 40 sn | $0.48 |
  | Opus 5.5, tam | 28 sn | $0.27 |
  | Sonnet 5, tam | 25 sn | $0.33 |
  | Opus 5.5, yalın | 23 sn | $0.13 |
  | Sonnet 5, yalın | 20 sn | $0.05 |
  | Opus 5.5, yalın + high | 19 sn | $0.07 |
  | Sonnet 5, yalın + high | 17 sn | $0.07 |

  - Sonraki denemeler öncekilerin önbelleğinden faydalandığı için küçük farklar gürültü sayılmalı.
  - Net sonuç: yalın mod maliyeti 2-6 kat düşürüyor. Effort high bu basit işlerde maliyeti artırmadı.
  - Yeni ayarla `tests/app-e2e.mjs` 7/7; beyinle form doldurma 11.5 sn (önceki 17.5 sn).

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

- **2026-09-28:** Faz 9 planlandı: kompakt çubuk, konuşurken canlı yazı ve sessizlikte gönderme, "Hey Jev".

- **2026-09-28:** Faz 8/6: JEVIS.app logosu ve yeni sürüm. VS Code ekran okuyucu modu yan etkisi bulundu, düzeltildi. Faz 8 bitti.

- **2026-09-28:** Faz 8/5: Uygulama kısayolları ve 5 yeni hızlı yol; "Spotify'da Tarkan çal" Claude'suz 3.4 sn. 40/40 + 10/10.

- **2026-09-28:** Faz 8/4: Dosya ve proje araçları; "projede ne yaptık" 8 sn. 13/13.

- **2026-09-28:** Faz 8/3: Öğrenen tarifler. Claude'un yaptığı iş öğreniliyor, benzer komut Claude'suz 2.4 sn. 7/7.

- **2026-09-28:** Faz 8/2: Chromium uygulamaları (Spotify 0 → 158 öğe), koordinatla tıklama, pencere geçişi, bekleme. 21/21 + 23/23.
- **2026-09-28:** Faz 8/1: Hızlı yol v2, basit komutlar Claude'suz ve bir saniyenin altında. 30/30 + 9/9.

- **2026-09-25:** Proje incelendi; JEVIS ve Jev'in yetenekleri araştırıldı.
- **2026-09-26:** macOS kısımları silindi (sadece Jev kalsın denmişti). Jev konuşmaları ve deneyler yapıldı.
- **2026-09-28:** Arayüz baştan yazıldı:
  - macOS tarzı, açık/koyu tema.
  - Hızlı (Sonnet 5) / Güçlü (Opus 5.5) düğmesi; varsayılan Sonnet 5.
  - Türkçe adım açıklamaları katlanan listede.
  - Tarifler ve Ayarlar yan panelleri (tarif çalıştırma ve kaydetme sayfa içinde).
  - Karar Laboratuvarı ve API anahtarı kutusu kaldırıldı.
  - Testler: sohbet 7/7, ses 8/8, tarif 7/7.
- **2026-09-28:** Beyin varsayılanı Opus 5.5 + yalın mod + effort high oldu; arayüze model/effort seçici eklendi. JEVIS'in Chrome penceresi kapalıyken bağlanamama hatası düzeltildi.
- **2026-09-28:** Faz 7 bitti: tarifler, JEVIS.app menü çubuğu uygulaması, açılışta başlama, doctor. Bütün fazlar tamam.
- **2026-09-28:** Faz 6 bitti: whisper.cpp ile Türkçe konuşma tanıma, Yelda ile sesli cevap, bas-konuş, `do` / `listen` komutları. 8/8.
- **2026-09-28:** Faz 5 bitti: sohbet arayüzü (app/), beyin adaptörleri, hızlı yol, DURDUR. 7/7.
- **2026-09-28:** Faz 4 bitti: Swift erişilebilirlik yardımcısı, masaüstü elleri, mac_action, terminal/kısayol korumaları. 23/23.
- **2026-09-28:** Faz 3 bitti: kasa, kayıt, acil durdurma, gizli talimat bekçisi, kullanıcıyı bekleme, site bazlı onay kuralları.
- **2026-09-28:** Faz 2 bitti: MCP sunucusu, Claude Code ile uçtan uca test, gizlilik tarayıcısı, bilgi kartı.
- **2026-09-28:** Faz 1 bitti: Jev çekirdeği, tarayıcı elleri, CLI, onay penceresi. Test sayfasında 27/27, gerçek sitelerde 9/9.
- **2026-09-28:** Faz 0 bitti: güvenlik açığı kapandı, 3 hata düzeldi, bağımlılıklar kuruldu.
- **2026-09-28:** Silinenler geri istendi ve kayıtlardan byte byte geri getirildi. Git kuruldu (`6b77f32`). Claude in Chrome reddedildi, kendi JEVIS sistemimize karar verildi. Bu plan yazıldı.

## 14. Senden gerekenler (2026-09-28)

1. **Yeni JEVIS.app'e izinler:** Yeni sürüm kuruldu. Açılınca macOS sırayla soracak; cevaplar senin: **Masaüstü klasörü** (sunucu bu olmadan başlamaz), sonra Sistem Ayarları › Gizlilik ve Güvenlik altında **Erişilebilirlik** ve **Ekran Kaydı** (JEVIS'i listeden çıkarıp yeniden ekle ya da kapatıp aç), ilk sesli komutta **Mikrofon**.
   - Notlar, Anımsatıcılar, Takvim, Müzik ilk kullanımda bir kere "JEVIS … kontrol etmek istiyor" diye soracak.
2. **App Store işi:**
   - Hangi uygulama? Bilgisayarda kullanıcının birkaç uygulaması var (adları burada tutulmuyor).
   - `node cli.js open appstoreconnect.apple.com` ile açılan JEVIS Chrome penceresinde App Store Connect'e **bir kez giriş yap**.
   - `appstore/bilgi-karti.md`'yi doldur (ya da sohbette söyle).
3. **İsteğe bağlı, her derlemede izin sormasın diye:** Kendi imzalı bir sertifikayla imzalama (Anahtar Zinciri'nde "JEVIS Dev" sertifikası). İstersen kurarız.
4. **İsteğe bağlı:**
   - `node cli.js autostart on`: bilgisayar açılınca başlasın.
   - `claude mcp add --scope user jevis -- /opt/homebrew/bin/node /Users/purplefox/Desktop/jev/mcp/server.js`: JEVIS araçları her Claude Code oturumunda olsun.
   - Bu klasörde yeni bir Claude Code oturumu açınca `jevis` MCP sunucusunu onayla.
5. **İsteğe bağlı başka beyinler:**
   - Codex: `npm i -g @openai/codex`, sonra giriş.
   - Ollama: kur, bir model indir, adını `jevis.config.json` › `brain.providers.ollama.model` alanına yaz.
   - Anthropic API: `ANTHROPIC_API_KEY`.
