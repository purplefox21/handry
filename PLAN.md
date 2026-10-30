# JEVIS — Proje Planı ve Hafızası

> **Durum (2026-10-30):** Faz 0-11 ✅. Uygulamanın adı Handry (MCP `handry`), görünen her yerde; ekranda parmaklarının üstünde yürüyen el (tilki Foxie seçilebilir), uyandırma "Hey Handry". Sunucu portu 4263. Sohbetler, zamanlayıcı/nöbet/güç, dosya değiştirme, kayıt ✅. Bağlantısız giriş penceresi, SMS/Gmail kodu okuma, telefondan onay (iMessage) ✅ (üçü de gerçek hesaplarla denenmedi). Jev yoğunken hızlı yol Claude'a devrediyor. Repo herkese açılmaya hazırlanıyor (İngilizce README; lisans seçilmedi). Varsayılan beyin Sonnet 5.5. Kullanıcıdan beklenenler en altta, "14. Senden gerekenler" bölümünde.
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
   - **Model kararı (2026-10-01, kullanıcı):** Varsayılan **Sonnet 5.5 + yalın mod + effort high** ("Hızlı"). Sonnet 5.5 28 Eylül 2026'da çıktı; Sonnet 5'ten ~%30 hızlı ve ucuz. Arayüzde tek tıkla **Opus 5.5**'e ("Güçlü") geçilir. Sonnet 5 listeden çıktı; Opus 4.8 daha önce bırakılmıştı (hem en pahalı hem en eski).
   - **Yalın mod:** Claude Code'un uzun kodlama talimatı yerine kısa JEVIS talimatı (`--system-prompt`) verilir, dahili kodlama araçları kapatılır (`--tools ""`). JEVIS araçları yine MCP'den gelir. Her turda tekrar okunan yük yaklaşık 5 kat azalır; beyinde terminal ve dosya erişimi de olmaz.
   - Opus 5.5 için `claude` 2.1.280, Sonnet 5.5 için 2.1.284 veya üstü gerekiyor (2.1.283 `claude-sonnet-5-5`'i tanımıyordu). 2026-10-01'de 2.1.286'ya güncellendi; eski sürümler `~/.local/share/claude/versions/` altında duruyor.
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
- [x] **9.2 Canlı yazı ve sessizlikte gönderme:** `app/macos/Listener.swift`. Kullanıcı Mikrofon ve Konuşma Tanıma izinlerini verdi.
  - Ölçüm: whisper, sesin başında "Hey Jev" kalınca cümlenin gerisini bozuyor ("Spotify'da Tarkan çal" → "Spotify, Dotar Cancel"). "Hey Jev" yokken doğru ve ~0.5 sn. Bu yüzden Apple'ın kelime zamanlarıyla "Hey Jev" sesten kesilip whisper'a sadece komut gidiyor.
  - Bluetooth kulaklık takılıyken mikrofon açılınca kulaklık düşük kaliteli "arama" moduna geçer; JEVIS dahili mikrofonu tercih ediyor.
  - Mikrofon JEVIS.app'te (Swift). Apple'ın cihaz içi Türkçe tanıması konuşurken kelimeleri anında çubuğa yazar.
  - ~1 sn sessizlik = cümle bitti. Aynı ses whisper'a da gider (JEVIS, VS Code, Claude gibi adları daha iyi tanıyor), doğru metin yerine oturur ve kendiliğinden gönderilir.
  - Göndermeden önce ~1 sn'lik ince bir geri sayım: Enter hemen gönderir, Esc iptal eder, klavyeye dokunmak düzenleme moduna geçirir.
  - Yeni izin: Konuşma Tanıma (ilk kullanımda macOS sorar).
- [x] **9.3 "Hey Jev":** `node tests/listener-e2e.mjs` **5/5** (macOS'un Yelda sesiyle üretilen kayıtlar JEVIS'in kendi dinleyicisinden geçiyor, mikrofon gerekmiyor):
  - "Hey Jev, sesi yüzde otuz yap" → uyanıyor, 6 parça canlı yazı, "sesi %30 yap".
  - "Hey Jev. Spotify'da Tarkan çal" → "Hey Jev" kesilmiş ses whisper'dan "Spotify'da Tarkan Çal" (0.67 sn).
  - Uyandırma kelimesi olmayan sohbet uyandırmıyor; "Hey Jev … (duraklama) … komut" çalışıyor; mikrofon düğmesi uyandırma kelimesiz çalışıyor.
  - Apple bazen "Hey Jev"i sonradan "Hey J" diye yeniden yazıyor: uyanırken kelime sayısı hatırlanıp atılıyor.
- **İmza kalıcı:** Yeniden derlenen JEVIS hiç izin sormadan açıldı (Apple Development kimliği).
- **Gerçek klavye testi (`tests/bar-live-e2e.mjs`) yarım kaldı:** ⌥Space çubuğu açıyor ve klavyeyi alıyor (JEVIS `~/.jevis/bar.json`'a yazıyor: `key: true`, öndeki uygulama yerinde kalıyor). Ama kullanıcı o sırada Godot'ta oyun test ediyordu; odak değişti, komut sunucuya ulaşmadı. Kullanıcı bilgisayarı kullanırken klavye testi çalıştırılmayacak. Test, çubuk klavyeyi almamışsa hiçbir tuş göndermiyor.
  - Açılıp kapatılabilen sürekli dinleme. Ucuz bir ses/konuşma kapısı; sadece kısa bir konuşma bitince whisper çalışır, metinde "hey jev" (ve "hey cev", "hey jeff" gibi yanlış duyulmuş hâlleri) aranır. Emin olunamayan durumda Jev karar verir ("JEVIS'e mi seslenildi?").
  - Uyanınca çubuk iner, kısa bir ses çalar, 9.2'deki akış başlar. "Hey Jev, sesi kıs" tek nefeste söylenirse komut doğrudan alınır.
  - JEVIS konuşurken ve ekran kilitliyken dinleme durur. Açıkken macOS menü çubuğunda turuncu mikrofon noktası sürekli görünür (sesin hiçbiri bilgisayardan çıkmaz).
  - Ölçülecek: yanlış uyanma (30 dk podcast/YouTube açıkken), kaçırma (20 deneme), gecikme, işlemci/pil. Yetersizse B planı: "hey jev" için openWakeWord ile küçük özel bir model eğitmek.
- [ ] **9.4 Cilalama:** uyanma/gönderme sesleri, sesle verilen komuta sesli cevap (yazılana değil), ayarlar (dinleme açık/kapalı, sessizlik süresi), uygulama logolu yeniden kurulum.

### Faz 10 — Gerçek işlerden gelenler (2026-09-30)
Kaynak: Başka bir Claude oturumu JEVIS'le GoDaddy'de DNS değiştirdi ve takıldığı yerleri raporladı; kullanıcı da istediklerini ekledi.

Kullanıcının kararları:
- Claude'dan bir şey gizlenmesin: Claude sayfadaki değerleri, anahtarları, indirilen dosyaları görebilir. Şifreler kolaylık için Anahtar Zinciri'nden doldurulmaya devam eder; kayıt dosyalarına şifre yazılmaz.
- "Göstererek öğretme"yi kullanıcı yapmaz: Claude işi yapar ve JEVIS'e öğretir.
- Giriş gerekince JEVIS hemen söylemeli (sesli, çubukta, bildirimle, başında değilse iPhone'a iMessage).

- [x] **10.1 Giriş farkındalığı:** giriş/2FA/CAPTCHA çıkınca ses + Mac bildirimi + JEVIS çubuğu (klavyeyi almadan, kullanıcı şifre yazıyor olabilir); `wait_for_user` 1 dakikada bitmezse iMessage (`node cli.js notify set <telefon|Apple ID>`, adres `~/.jevis/config.json`'da). `browser_sessions`: işin başında sitelerin hesap sayfalarını yeni sekmede açıp giriş gerekip gerekmediğine bakıyor, eksikleri tek seferde söylüyor.
- [x] **10.2 Toplu form doldurma (`browser_fill`):** bütün alanlar tek çağrıda (Jev paralel eşliyor); yazı, açılır menü, seçenek düğmesi, onay kutusu; "önce → sonra" tablosu; emin olunamayan alan doldurulmuyor, adaylarıyla listeleniyor. App Store benzeri formda 6/6 alan 2 sn.
- [x] **10.3 Claude JEVIS'e öğretir:** `jevis_teach` (MCP oturumunun adımlarından değişkenli öğrenilmiş iş; `jevis_do` ya da çubuk/ses Claude'suz yapar, testte 1.5 sn), site notları (`site_note`, `~/.jevis/sites/`, site açılınca/okununca gelir).
- [x] **10.4 İndirme ve değer kaydetme:** `browser_download` (istenen klasöre, üstüne yazmadan), `browser_save_value` (sayfadaki düz yazı anahtarları da buluyor; Anahtar Zinciri ya da git'e girmeyen `.env`).
- [x] **10.5 Onay penceresinde değişiklikler:** "Kaydet" onayında "• Name: … • Price: …" listesi; şifreler ••••.
- [x] **10.6 Tablo okuma (`browser_table`):** `<table>`, ARIA tablo/grid ve `<div>` listeleri JSON satırları olarak.
- [x] **10.7 Numaralı ekran görüntüsü:** `browser_screenshot marks=true`; renkli kutular + numara listesi, işaretler görüntü alınır alınmaz siliniyor.
  - Tasarım notu: ekran görüntüsünde her öğenin #numarası. Numara bir piksel yeri değil, öğenin kendisi: #14'e tıklamak o öğeye tıklar, sayfa kaymış olsa bile. Öğe kaybolduysa JEVIS başka bir şeye tıklamaz, "yeniden oku" der. Tıklamadan sonra neye tıkladığını adıyla söyler.

**Sonuç:** `node tests/faz10-e2e.mjs` **15/15**. Tarayıcı 27/27 (iki kez), formlar 9/9, MCP 11/11, koruma 12/12, tarif 7/7, öğrenme 10/10.
**Öğrenilen:** JEVIS sadece tıklanabilir öğeleri tanıyordu; sayfada düz yazı olarak duran bir API anahtarını göremiyordu. `browser_save_value` artık anahtar/token gibi görünen yazıları da aday yapıyor.

### Sohbetler ve oturumlar (2026-10-01)
Kullanıcının isteği: "sohbet sohbet olsun, session session"; eksileri de engellensin.
- [x] Her sohbetin kendi Claude oturumu (`core/chats.js`, `~/.jevis/chats/`). Çubuk, büyük pencere, ses ve terminal (`do`) aynı, o anki sohbete yazıyor. Büyük pencerede sohbet listesi var (geç, sil, yeni).
- [x] Eksilere karşı:
  - Claude'suz yapılanlar (hızlı yol, öğrenilmiş iş, tarif) bir sonraki Claude mesajında "[Sen yokken …]" diye gidiyor.
  - Her mesajda taze "[Şu an ekranda …]" bilgisi gidiyor; beyin talimatında "ekran değişmiş olabilir, işlemden önce bak" kuralı var.
  - 12 turda bir ya da model değişince Claude tarafı JEVIS'in kendi özetiyle tazeleniyor. Ek LLM çağrısı yok; sohbet uzadıkça yavaşlamıyor ve pahalılaşmıyor.
  - "yeni sohbet" / "yeni konu" komutu var; 2 saat sessizlikte yeni sohbet açılıyor, eskisi listede kalıyor.
  - Sohbetler diskte duruyor, uygulama kapanıp açılınca kaybolmuyor.
- [x] Testler: `tests/chats-e2e.mjs` **9/9** (sahte beyin), `tests/chats-ui-e2e.mjs` **4/4**. Gerçek Claude'la: önce hızlı yoldan "şu an hangi şarkı çalıyor", sonra "az önce ne sordum?" → Claude, hızlı yolun yaptığını bildi (4.5 sn).

### Zamanlayıcı, nöbet, güç ve "önce anla" (2026-10-01)
Kullanıcının gerçek sohbetinden: "saat 01:01 olunca … ekranı kilitle" dedi, hızlı yol saati görmeden hemen kilitledi; "kapatma kilitle kilitle…" diye düzeltince yine kilitledi; "anlamadın", "ne anlattım sana" mesajlarında Claude konuşmak yerine `browser_wait` ile saati beklemeye çalıştı; "selam"a "Size nasıl yardımcı olabilirim" dedi. İstekleri: iki VS Code işi bitince bilgisayarı kapatmak, "3 saat sonra kapat" gibi zamanlayıcılar, "5 dk'da bir kontrol et" gibi nöbetler, ve JEVIS'in cümleyi anlamadan iş yapmaması.
- [x] **Hızlı yol önce niyete bakıyor.** Jev aynı istekte bir de "niyet" soruyor: şimdi yap / sonra yap / JEVIS'e cevap-düzeltme ("bunu bir daha yap" gibi geri gönderme dahil) / sohbet (selam, itiraz, JEVIS hakkında soru, "yapma" demek). Hızlı yol sadece "şimdi yap"ta çalışıyor; gerisi Claude'a gidiyor. Jev'e JEVIS'in bir önceki cevabı da veriliyor (`previous`); yol seçimi yine sadece komutun kendi kelimelerine bakıyor. Süre değişmedi (~0.3 sn). `tests/router-e2e.mjs` **51/51** (sohbetten gelen 11 yeni cümle dahil).
- [x] **Zamanlayıcı ve nöbet** (`core/timers.js`, `~/.jevis/timers.json`): bir saatte, bir süre sonra ya da bir koşul olunca (Claude Code işleri bitince; bir uygulamada/sekmede yazı görününce, Jev'e sorarak ya da uygulama kapanınca) kilitle / uyut / yeniden başlat / kapat / hatırlat / JEVIS komutu çalıştır. Koşullara JEVIS kendisi bakıyor, LLM yok. JEVIS sunucusu çalıştırıyor (kilit dosyasıyla tek süreç); başka Claude oturumundan kurulan iş de çalışıyor, JEVIS kapalıysa arka planda açılıyor.
  - Türkçe kurallar (`parseSchedule`, LLM'siz): "3 saat sonra", "yarım saat sonra", "bir buçuk saat", "1 saat 20 dakika sonra", "saat 3'te", "01:01 olunca", "gece 2'de", "akşam 8 gibi", "yarın sabah 9'da", "işler bitince", "bilgisayarı kapatma" (bekleyeni iptal), "zamanlayıcıyı iptal et", "zamanlayıcılar neler". Olumsuzlar ayrılıyor: "kilitle, kapatma, uykuya da alma" → kilit. "bilgisayardaki Spotify'ı kapat" bilgisayarı kapatmıyor. Karışık ya da kurallara sığmayan ("5 dakikada bir bak…", "10 dk sonra Spotify'ı durdur") Claude'a gidiyor; Claude `schedule_task` ile kuruyor.
  - Araçlar: `schedule_task`, `scheduled_tasks`, `cancel_scheduled`, `claude_sessions`; `mac_action`'a sleep / restart / shutdown.
- [x] **Claude Code oturumları:** Claude Code her oturum için `~/.claude/sessions/<pid>.json` tutuyor (busy / waiting + waitingFor / idle). JEVIS bunu ve oturumun hâlâ çalışan komutlarını (shell-snapshots kabukları) okuyor: çalışıyor / senden cevap bekliyor / bitti. "İşler bitince" o an çalışan oturumları hedef alıyor; hepsi 1 dk boyunca bitmiş görününce iş yapılıyor. Cevap bekleyen oturum varsa kullanıcıya haber veriliyor (1 dk sonra iMessage) ve beklemeye devam ediliyor.
- [x] **Güç işleri Apple menüsünden** (`hands/power.js`): Finder'ın menü çubuğundaki Apple menüsü › Ekranı Kilitle / Uyut / Yeniden Başlat… / Sistemi Kapat…, arka planda AXPress ile (sadece Erişilebilirlik izni; "Bu Mac Hakkında" ile denendi). "Ekranı kilitle" artık gerçekten kilitliyor (önce ekranı uyutuyordu). Kapatma: JEVIS'in 30 sn geri sayımı (çubuk + sessiz bildirim; ⌥Esc, "dur" ya da "zamanlayıcıyı iptal et" iptal eder) → telefona iMessage → macOS'un kendi 1 dk'lık sorusu (Vazgeç denebilir). Uygulamalar önce kapanmaya çağrılıyor; kaydedilmemiş iş varsa macOS durur.
  - Güvenlik: Mac uyurken kaçan kapatma sonradan yapılmıyor (haber veriliyor); Mac uyanınca 10 dk hiçbir şey kapanmıyor; güç işi beklerken `caffeinate -i` Mac'in kendi kendine uyumasını engelliyor; nöbet 24 saatte bırakılıyor. Gece çalışan bildirimler sessiz (konuşma ve ses yok).
- [x] **Beyin kendini tanıyor ve konuşuyor:** BRAIN_PROMPT'a JEVIS'in kim olduğu, parçaları, nasıl ulaşıldığı ve neler yapabildiği eklendi. "sen" diye, samimi ve kısa konuşuyor; selam, sohbet, itiraz ve "ne dedim" sorularında araç kullanmadan konuşuyor; JEVIS yanlış bir şey yaptıysa söyleyip düzeltiyor; bir dakikadan uzun beklemeyi görevin içinde değil `schedule_task` ile yapıyor.
- [x] Testler: `tests/timers-e2e.mjs` **14/14** (geçici klasör, sahte Claude oturumları; kapatma, kilit ve iMessage sadece kaydediliyor). `chats-e2e` 9/9, `mcp-smoke` 11/11. Kullanıcı uyurken ses çıkarabilecek testler (`fast-e2e`, `app-e2e`, `learn-e2e`, `recipe-e2e`, `chats-ui-e2e`) çalıştırılmadı; sıradaki oturumda çalıştırılacak.
- [x] **Zamanlayıcı listesi** (kullanıcı: "14 dk sonra şunu yap dedim, gözükmüyor, iptal de edemiyorum"):
  - Büyük pencerede ⏰ düğmesi (bekleyen iş sayısıyla) ve "Zamanlayıcılar" çekmecesi: her iş için ne yapılacağı, ne zaman / hangi koşulla, canlı kalan süre, koşullularda JEVIS'in son bakışta gördüğü, kullanıcının kendi sözü. "İptal" önce "Emin misin?" diyor (3 sn); "Hepsini iptal et" de iki basışla. Geri sayımdaki kapatma en üstte kırmızı, tek basışla iptal.
  - Çubukta "⏰ 2" düğmesi → kısa liste, her satırda ✕ (iki basış). Kapatma geri sayımı başlayınca çubukta büyük kırmızı "İptal" düğmesi; geri sayım bitene kadar çubuk kapanmıyor. Zamanlayıcı bildirimleri çubukta "giriş bekleniyor" gibi değil, haber olarak görünüyor.
  - Liste birkaç saniyede bir tazeleniyor; çubuktan, sesle ya da başka bir Claude oturumundan kurulan iş kendiliğinden görünüyor. Sunucu: `GET /api/timers` (sıralı: geri sayım, en yakın saat, koşullular), `POST /api/timers/cancel` (`id` ya da `all`).
  - `tests/timers-ui-e2e.mjs` **9/9** (görünmez Chrome, ayrı sunucu, geçici klasör, ses yok): 2 zamanlayıcı + 1 koşul, ortadakine iptal → diğer ikisi yapıldı, iptal edilen hiç yapılmadı; tek basış iptal etmiyor; "Hepsini iptal et"; çubukta geri sayım İptal ile durdu, Mac "kapanmadı"; açık ve koyu temada ekran görüntüleriyle bakıldı.
- [x] **Zamanlayıcıdan sohbete ve menü çubuğu** (kullanıcı: "tıklayınca hangi sohbette istemişsem o açılsın"; "⚡ genişlesin, tıklayınca görevleri liste olarak görelim"):
  - Her iş kurulduğu sohbeti hatırlıyor (`chatId`; çalıştırıcı `JEVIS_CHAT_ID`'yi araçlara ve beynin MCP sunucusuna veriyor). Listede işe tıklayınca o sohbet açılıyor (pencerede doğrudan, çubukta büyük pencereyi açarak). VS Code'dan kurulanlarda "VS Code'dan kuruldu" yazıyor.
  - Saati gelen komut sonucunu kurulduğu sohbete yazıyor; o an açık olan sohbet değişmiyor (`currentChat(id, { switchTo: false })`).
  - JEVIS.app menü çubuğu: iş varken ⚡ sola doğru genişliyor ("⚡ ⏰ 8:12 · 2", geri sayımda "⚡ ⏻ 27 sn", sadece koşul varsa "⚡ 👀 1"); `~/.jevis/timers.json`'a saniyede bir bakıyor. Menünün en üstünde zamanlayıcılar (alt yazıda saat ve kalan süre ya da son bakış), her birinde "Kurulduğu Sohbeti Aç" / "İptal Et", birden fazlaysa "Hepsini İptal Et". İşin yazısı JEVIS'ten geliyor (`label`), menü olduğu gibi gösteriyor; iptal ve sohbet açma sayfanın kendi fonksiyonlarıyla (jetonlu API).
  - Testler: timers-e2e **15/15**, timers-ui-e2e **10/10**, chats-e2e 9/9, mcp-smoke 11/11.
- Not: bu işin testi sırasında eski hâliyle "bunu bir daha yap" (önceki cevap Spotify'dı) hızlı yoldan play/pause'a gitti ve kullanıcının Spotify'ını iki kez durdurup başlattı (sonuç: eski hâli, duraklatılmış). Düzeltildi: geri gönderen cümleler Claude'a gidiyor, router-e2e'de 3 cümleyle test ediliyor.

### Faz 11 — Foxie: yeni ad, izinler ekranı, ekranda gezen tilki (2026-10-01, başladı)
Kullanıcının istekleri: uygulamanın adı ve ikonu tilkiyle ilgili olsun; arkadaki kimlik de değişsin (sıfırdan kurulum ve izinlerin testi için); tıkla tıkla bütün izinlerin verildiği bir ekran olsun; ekranda arka planı olmayan bir piksel tilki gezsin (yatsın, uyusun, kuyruk sallasın; "Hey Foxie" deyince kulakları dikilsin; iş yaparken ekranın o tarafına koşsun, düşünürken masada kod yazsın); kapatma ve gizleme menü çubuğundan.
- Görseller kullanıcının Blender → piksel art hattından geldi (`app/foxie/sprites`, tarif `app/foxie/TARIF.md`): 21 animasyon, 878 kare, 180×146 (tutulma 180×190), 24 kare/sn, `manifest.json` (zemin 128, yürüme 36.8 px/sn, koşu 245 px/sn, tutma noktaları). Kontrol: yarı saydam piksel yok, palet sabit (20-28 renk). Görseller değiştirilmez; eksik ya da yanlış olursa kullanıcıya söylenir.
- [x] Ad **Foxie**, kimlik `studio.purpfox.foxie`, ikon bu tilkiden (mor zeminde piksel büst; menü çubuğunda ön cepheden tilki başı şablon simgesi; pencere ve çubuk logosu). İç adlar (`~/.jevis`, MCP sunucusu `jevis`, araç adları) aynı kalır; kullanıcının gördüğü her yerde Foxie.
- [x] İzinler ekranı (`app/macos/Permissions.swift`, SwiftUI): Erişilebilirlik, Ekran Kaydı, Mikrofon, Konuşma Tanıma, klasörler, uygulama izinleri (System Events, Spotify, Müzik, Notlar, Anımsatıcılar, Takvim, Mesajlar); canlı ✅/❌, her satırda "İzin Ver"; ilk açılışta ve eksik izin varken kendiliğinden.
- [x] Ekranda gezen tilki (`app/macos/Fox.swift`; şeffaf, sadece tilkinin pikselleri fareyi alıyor; varsayılan boyut Retina'da 0.5 = her sprite pikseli bir ekran pikseli; tam ekran uygulamada saklanıyor; asistan olayları `~/.jevis/activity.json` ile — `core/activity.js`, her araç çağrısı, beyin, uyarılar; VS Code'daki Claude JEVIS araçlarını kullanınca da): tarifteki davranışlar (yürüme, oturma, sıkılma, uyuma, pencere üstüne zıplama ve onunla gitme, köşede sarkma, kuyruğundan/ensesinden tutup taşıma, düşme) + asistan olayları (çağrılınca `ears_up` → `listen`, düşünürken `desk`, işin yapıldığı yere `run`, bitince `happy`, olmayınca `sad`). Menü çubuğundan göster/gizle/uyut, boyut.
- [x] "Hey Foxie" (foxie, foxy, foksi, fox… varyantları; Listener.swift ve voice/stt.js), "Hey Jev" de kalır. Uçtan uca ses testi (listener-e2e) kullanıcı Foxie'ye Konuşma Tanıma iznini verince çalıştırılacak.
- **Ad Inaro** (kullanıcı, 2026-10-01): Foxie adı tilkide kaldı, uygulama Inaro oldu (Zorro, Kitsune, Inari, Inary, Kumiho, Vulpi, Foxel, Kitsumi başka ürünlerde kullanılıyor ya da korunuyor; Inaro için aramada ürün çıkmadı — hukuki kontrol değil). Uyandırma yalnız "Hey Foxie" / "Hey Fox" (kullanıcı: "jev kalmasın"). Ad, Türkçe ekleri (ünlü uyumuyla: Inaro'ya, Inaro'dan…), tilkinin adı ve uyandırma deseni tek yerde: `core/brand.js`; sayfalara sunucu (`{{APP}}`, meta), Swift'e Info.plist taşıyor. Kimlik `studio.purpfox.foxie` aynı kaldı: yeniden adlandırmadan sonra izinler yerinde (İzinler penceresi açılmadı). listener-e2e **6/6** ("Hey Fox" dahil).
- **MCP de Inaro** (kullanıcı: "Claude doğru bilmeli neyi kullanacağını"): sunucu adı `inaro` (`core/brand.js` › `MCP_NAME`), araçlar `mcp__inaro__*`, `jevis_do` / `jevis_teach` → `inaro_do` / `inaro_teach` (eski adlar takma ad olarak çalışıyor). Araç açıklamaları, talimatlar, onay pencereleri, hata mesajları, sohbet özetleri, şüpheli metin işareti ve doktor çıktısı Inaro diyor (Türkçe ekleriyle). Kayıt: Claude Code kullanıcı kapsamında `jevis` kaldırıldı, `inaro` eklendi; proje `.mcp.json`; Claude masaüstü ayarı (yedeği yanında). Değişmeyenler: Anahtar Zinciri servisi `jevis` (kayıtlı şifreler), `~/.jevis`, Jev modeline giden yönlendirme talimatları (router-e2e onlarla ayarlı). Gerçek Claude denemesi: `claude_sessions` aracını yeni adla kullandı, kendini "Inaro, Foxie diye de bilinen tilki asistan" diye tanıttı (4.8 sn).
- **Uyandırma:** "Hey Foxie", "Hey Fox" ve uygulamanın adı. "Hey Inaro"yu Türkçe ses tanıma "Hayır", "Hey Mero", "Hüseyin", "Carol" diye duydu; "İnaro, …" (başında hey olmadan) 4'te 3 doğru duyuldu. Bu yüzden ad, başında "hey" olsa da olmasa da uyandırıyor. listener-e2e **7/7**.
- **Dosya değiştirme ve kayıt** (kullanıcı: "klasör aç, taşı, sil diyebilmeliyim"; "yaptıklarını AI anlatmasın, kayıt tutulsun"):
  - Araçlar: `files_make_folder`, `files_move` (yeniden adlandırma da), `files_copy`, `files_trash` (macOS `trash`; kalıcı silme yok, "Geri Koy" çalışır), `files_undo` (`~/.jevis/files-journal.jsonl` ile son işi geri alır, Çöp Sepeti'nden de). Kurallar kodda: sadece ev klasörü; Library, gizli ve anahtar klasörleri, ana klasörler ve projenin kendisi yasak; üstüne yazmaz; klasör ya da 3'ten fazla öğe çöpe atma, git projesi taşıma, 20'den fazla öğe ya da 500'den fazla dosya kopyalama önce sorar. Inaro'nun beynine terminal verilmedi; VS Code'daki Claude'un kendi terminali ve izin sistemi ayrı.
  - Kayıt: `guard/log.js` her araç çağrısına `who` ekliyor (uygulamanın kendisi ve kaynağı: çubuk, pencere, ses, zamanlayıcı, terminal; ya da Claude Code'un oturum dosyasından "VS Code · proje (oturum adı)"). Büyük pencerede "Yapılanlar" çekmecesi: gün gün, kime göre gruplu, ✓/✗, "sen onayladın / reddettin", tıklayınca ayrıntı; "Son dosya işini geri al" düğmesi (`/api/log`, `/api/files/undo`).
  - Güvenlik açığı kapatıldı: onay ya da "seni bekliyor" penceresi açıkken (`~/.jevis/confirming.json`, bütün süreçler için) masaüstü tıklama/yazma/tuş/pencere araçları reddediyor; yapay zekâ kendi onay penceresine "Evet" diyemez. Pencere başlıkları uygulamanın adıyla.
  - Testler: `tests/files-change-e2e.mjs` **11/11**; mcp-smoke 11/11, chats 9/9, timers 15/15, timers-ui 10/10, router 51/51. `files-e2e` (TextEdit açıp kapatıyor) kullanıcı bilgisayardayken çalıştırılmadı.
- Kuruldu (2026-10-01 16:20): eski JEVIS.app Çöp Sepeti'nde; Foxie ilk açılışta İzinler penceresini açtı; tilki Dock'un üstünde yürüyor. Kullanıcının denemesi bekleniyor: sevme, kuyruktan taşıma, pencere üstüne zıplama, "Hey Foxie". Eski kimliğin (com.jevis.menubar) izin kayıtları Sistem Ayarları'nda duruyor; silmek kullanıcıya soruldu.

### Ad: Handry (2026-10-09, kullanıcı)
Kullanıcı Inaro'yu akılda tutamadı; işlevi anlatan, "do it with your hands"teki "hands"i çağrıştıran, insan adı gibi bir isim istedi. Elenenler: Dex (Samsung DeX tescili; aynı işi yapan birkaç "Dex" AI asistanı, getdex.com'un MCP sunucusu; alan adları alınmış), Dobby (Warner Bros. tescili; Karpathy'nin ve başkalarının "Dobby" asistanları), Handrix, Thingers, Kumanda, Servo… Seçilen **Handry** (Henry + hand + handy). Aramada bu adla ürün yok; boş alan adları: handry.ai, heyhandry.com, usehandry.com, gethandry.com, handry.io, handry.co (handry.com alınmış). "Handy" adlı benzer işte ürünler var (karışma riski düşük). Hukuki marka kontrolü yayından önce yapılacak.
- [x] Uygulama Handry.app (kimlik aynı: `studio.purpfox.foxie`, izinler kalıyor), MCP sunucusu `handry`, araçlar `handry_do` / `handry_teach` (adlar `core/brand.js`'teki MCP_NAME'den türüyor; `jevis_*`, `inaro_*` takma ad), Türkçe ekler söylenişten ("hendri": Handry'ye, Handry'nin). Uyandırma "Hey Foxie" / "Hey Fox" / "Handry, …" (Handry sesle henüz denenmedi). Tilki yine Foxie.
- [x] Depo GitHub'da: github.com/purplefox21/handry (gizli). Yerel klasör hâlâ `~/Desktop/jev`.
- Başka bir Claude oturumunun commit'lenmemiş işi (onayda işlem türü, `confirm.kindCheck`) bulundu, testlerden geçti, ayrı commit olarak kaydedildi (fd4e189).

### El: Handry'nin maskotu ve ikonu (2026-10-10, kullanıcı)
Kullanıcı: "logosunu elli bir şey yap, Wednesday'deki gibi; tilki yerine o elden yap, o hareket eder"; menüde "Hey Foxie" yerine "Hey Handry".
- [x] Port 4263 (başka bir projenin Next.js sunucusu 3000'de; uygulama 3000'de ne cevap verirse onu açıyordu). Uygulama sunucuyu yeniden kullanmadan önce `GET /api/ping` → `{"jevis": true}` bakıyor; port doluysa sunucu açık bir mesajla çıkıyor.
- [x] "Inaro" görünmesinin büyük ihtimalle kaynağı: `dist/` içinde aynı kimlikli eski Inaro.app / Foxie.app / JEVIS.app (LaunchServices'te kayıtlıydı). Çöp Sepeti'ne atıldı, kayıttan silindi.
- [x] `app/hand/make.mjs`: küçük bir 3B el (parmaklar yuvarlak koniler, avuç elipsoidler, mor kol ağzı, beyaz şerit, altın düğme) her kare için pozlanıyor ve yandan ışın izlenerek piksel art çiziliyor (dört tonlu gölge, dış çizgi, arkadaki parçalarla arasına çizgi), her piksel 2×2. Parmaklar ters kinematikle yere basıyor; yürürken uçlar kaymıyor (hız manifest'te). Tilkinin animasyon adlarının hepsi, ayrıca `listen_out`, `bored_in`, `bored_out`. Ne yaptığı: avucu sana dönük kalkma ("Hey Handry"), laptop'ta yazma (Claude düşünürken), sevilince kalpler, iş bitince jazz hands, sıkılınca parmaklarla tempo, sırtüstü uyku ve Z'ler, kol ağzından tutulunca çırpınma, pencere köşesinden parmak sarkıtma. Uygulama ikonu (çapraz yandan, parmaklarının üstünde) ve menü çubuğu simgesi (kalkmış el ✋) de buradan. Çıktılar git'te değil, derleme üretiyor (4 sn).
- [x] Fox.swift döngülerin giriş/çıkışını oynuyor (`<ad>_in`, `<ad>_out`); menü › Ekrandaki El ▸ gizle/göster, uyut, boyut, El / Tilki (varsayılan el). Uygulamada `Resources/pets/{hand,fox}`.
- [x] Uyandırma etiketi "Hey Handry"; Foxie/Fox da çalışıyor. Sentetik sesle (Yelda): "Hey Hendri, Spotify'ı aç" uyandırıyor; "…, müziği durdur"da tanıyıcı "müziği"yi sonradan yuttu; "…, karanlık moda geç" uyanmadı ("Tayland"); "Handry" yazıldığı gibi okununca "Seyhan"/"Android", yalnız ad "Camby" duyuldu. Konuşma tanıma ipuçlarına (contextualStrings) "Hey Handry", "Hendri" eklendi, bu sesle fark etmedi. Kullanıcının kendi sesiyle denemesi gerekiyor. listener-e2e 7/7.
- Kuruldu (2026-10-10 13:54): menü çubuğunda el, Dock'ta yeni ikon, el Dock'un üstünde yürüyor (ekran görüntüsüyle bakıldı). Tilkiyi daha önce gizlemişti; yeni el için gizleme kapatıldı.

### Bağlantısız giriş penceresi ve doğrulama kodu (2026-10-10, kullanıcı)
Kullanıcı: Google girişi "bu tarayıcı güvenli olmayabilir" diyor, bot takibi yüzünden zarar görmek istemiyor; telefona/e-postaya gelen kodu elle yazmaktan yoruldu. "CAPTCHA'yı yapmıyoruz." Büyük ihtimalle Google'ın asıl gördüğü fare hareketi değil, Chrome'un hata ayıklama portuyla yönetilmesi; bu yüzden girişi bağlantısız bir Chrome'da elle yapmak.
- [x] `login_window` (CLI: `node cli.js login-window [adres]`): onay sorar, Handry'nin Chrome'unu temiz kapatır (CDP `Browser.close`; Chrome çerezleri çıkışta yazar), aynı profili `--remote-debugging-port` olmadan sıradan Chrome olarak açar, kullanıcıya haber verir ve bekler ("Tamam" ya da Cmd+Q), sonra pencereyi SIGTERM ile kapatır (SIGKILL yok: girişi kaybettirebilir), Chrome'u bir sonraki araçta bağlantıyla geri açar ve girişin durduğuna bakar. Sadece bu profilin Chrome'una dokunur (`pgrep` ile `--user-data-dir`), kullanıcının kendi Chrome'una değil. Pencere açıkken `ensureChrome` anlaşılır hata verir. "İnsan gibi giriş" ipucu artık engel sürerse bunu öneriyor.
- [x] `verification_code` (CLI: `node cli.js code sms|gmail [--from=kelime] [--wait=sn] [--target="alan"]`): `sms` = Mesajlar'ın `~/Library/Messages/chat.db`'si salt okunur (`/usr/bin/sqlite3`; yeni macOS'un `attributedBody` blobu da çözülüyor), `gmail` = Handry Chrome'unda geçici sekmede Gmail gelen kutusu satırları (`tr.zA`; bugünün saati olan satırlar taze sayılır). Sadece kod ve gönderen döner, diğer mesajlar dönmez. Her okumada onay penceresi (`codes.ask: false` kapatır); "Hayır" = dur. `target` verilirse kod alana yazılır; `wait_sec` henüz gelmemiş kodu bekler. Kayıt dosyasına kodun kendisi yazılmaz ("doğrulama kodu okundu (sms, gönderen…)"; `meta.logSummary`). Ayarlar `jevis.config.json › codes`.
- [x] Test: `tests/codes-e2e.mjs` 18/18 (sahte chat.db ve Gmail benzeri sayfa; gerçek Mesajlar veritabanına ve gerçek Gmail'e dokunmaz). human-e2e 19/19, guard-e2e 12/12, mcp-smoke 11/11.
- **Denenmedi:** Gerçek Gmail'in sınıf adları (`tr.zA`, `.yW`, `.bog`, `.y2`, `.xW`) ve gerçek Mesajlar veritabanı. Gerçek Google girişinin bağlantısız pencerede geçip geçmediği de bilinmiyor; kullanıcı ilk kullanımda görecek.
- Yapılmayanlar: CAPTCHA çözme, CAPTCHA'da yeni "hızlı devir" (mevcut davranış duruyor: bekçi fark eder, haber verir, `wait_for_user` bekler).

### Paylaşıma hazırlık (2026-10-30, kullanıcı)
Kullanıcı: GitHub reposunu LinkedIn'de herkese açık paylaşacak (ileride ücretli abonelik de olabilir, şimdilik repo). Önce "son hal": ad her yerde Handry, İngilizce, telefondan onay iMessage ile ("kendime cevap vereyim, o anlasın"; Telegram istemedi).
- [x] Ad: görünen her yerde JEVIS → Handry (onay penceresi, CLI, bildirim, indirme klasörü ~/Downloads/Handry, package adı `handry`). `jevis.config.json` → `handry.config.json` (eskisi de okunur), `JEVIS.swift` → `Handry.swift`. Bilerek kalanlar: `~/.jevis`, Anahtar Zinciri servisi `jevis` (kayıtlı şifreler), `JEVIS_*` değişkenleri, `X-Jevis-Token`, `JevisError`, `jevis-ax`, uygulama kimliği (izinler). Beyin prompt'unda kişisel yol yerine projenin klasörü. `.mcp.json` git'ten çıktı (kişisel yollar).
- [x] Jev 529 (system_overloaded) dönünce: `core/jev.js` 600 ms + 1,5 sn bekleyip tekrar dener (Retry-After en fazla 3 sn), sonra `JEV_DOWN`; `core/router.js` hızlı yol komutu düşürmeden Claude'a bırakır. Önceden Jev yoğunken her komut hata veriyordu.
- [x] Onay açığı: TextEdit'te "Sil" (kaydedilmemiş belgeyi atmak) soru sorulmadan geçiyordu. Jev riski %86-88 görüyordu ama işlem türü kontrolü bağlamsız ("\"Sil\" öğesine basmak") yapılıyor, Jev "zararsız" diyordu. Artık pencerenin metinleri de gidiyor (tarayıcıda düğmenin yanındaki metin). desktop-e2e 23/23.
- [x] "Bu sitede hep": gönder/yayınla/paylaş/davet/incelemeye gönder/release artık hiç hatırlanmıyor (para, sipariş, silme gibi).
- [x] Telefondan onay: Mac'teki onaya `confirm.remoteAfterSec` (20 sn) cevap yoksa `notify.imessageTo` adresine kodlu iMessage; kullanıcı kendine kodu yazar, Handry Mesajlar veritabanından okur; ilk gelen cevap (Mac ya da telefon) geçerli, toplam bekleme `confirm.remoteTimeoutSec` (600 sn). Sadece kendi konuşmasından gelen çıplak kod onaylar; beklerken eller ekrana dokunmaz; onay mesajı SMS kodu sanılmaz. Mesajlar okuma kodu `guard/messages.js`'e taşındı (codes.js da kullanıyor). Tam Disk Erişimi yoksa her şey eskisi gibi (sadece Mac'te sorar); `doctor` söylüyor.
- [x] README İngilizce, baştan (eski README "Gemma 4, JEVIS" diyordu). CAPTCHA'dan bahsetmiyor.
- [ ] Lisans (MIT mi, ticari kapıyı açık tutan bir lisans mı): kullanıcı karar verecek.
- [ ] Jev'siz mod (Jev anahtarı olmadan da çalışsın; risk kontrolünün yerine ne konacağı bir güvenlik kararı).
- [ ] Masaüstleri (Spaces) arası geçiş, pano aracı, Mail.app, arka planda Claude oturumu başlatma.
- [ ] İngilizce arayüz.
- Testler (2026-10-30): mcp-smoke 11/11 (Jev'den önce), recipe 7/7, chats 9/9, guard 12/12, timers 15/15, files-change 11/11, human 19/19, codes 18/18, site-permissions 15/15, desktop 23/23, jev-resilience 7/7, remote-approve 8/8, learn 9/10. learn'deki tek hata Jev'in kararı: "Test formunda ad alanını doldur" komutunu "önceki mesaja bağlı" saydı; sonuç yine doğru (uydurulan metin öğrenilmedi), test sadece sebebi farklı buldu. router-e2e Jev'in 529'ları yüzünden bitirilemedi. faz10 ve browser-e2e gerçek Handry Chrome'unu kullandığı ve orada başka bir iş (TradeLab) açık olduğu için koşulmadı.

## 7. Sınırlar ve riskler

- CAPTCHA: 2026-10-12'de başka bir Claude oturumu 2captcha.com + Claude ile otomatik çözücü ekledi (`hands/captcha.js`, `browser_solve_captcha`; 2captcha anahtarı tanımlı değilse çalışmaz, `wait_for_user`'a düşer). Kullanıcı 2026-10-30'da kodda kalmasını istedi. Bu projede Claude o parçayı yazmıyor, geliştirmiyor ve README'de anlatmıyor. İki adımlı kodlar her seferinde sorularak okunur: Authenticator için `totp_code`, SMS ve Gmail için `verification_code`.
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

- **2026-10-30:** Paylaşıma hazırlık (yukarıdaki bölüm): ad Handry, Jev yoğunken Claude'a devir, TextEdit "Sil" onay açığı, "Bu sitede hep" daraltıldı, telefondan onay (iMessage), İngilizce README. O gün TypeSafe Jev saatlerce ara ara 529 (system_overloaded) döndü; Jev'e bağlı testler birkaç kez tekrarlandı.
- **2026-10-12:** Handry.app "sunucusu başlamadı" diyordu. Sebep: derleme `process.execPath`'i, yani Homebrew'un sürüme özel yolunu (`/opt/homebrew/Cellar/node/26.4.0/bin/node`) uygulamaya gömüyordu; node 26.10.0'a güncellenince o klasör silindi, `Process.run()` sessizce düştü, `~/.jevis/logs/app-server.log` boş kaldı. Düzeltme: `app/macos/build.js › stableNodePath()` kalıcı bağlantıyı (`/opt/homebrew/bin/node`, `/usr/local/bin/node`) gömüyor; `JEVIS.swift › findNode()` gömülü yol yoksa bu bağlantılara bakıyor, bulamazsa ya da başlatamazsa nedenini log'a yazıyor. Not: `node cli.js app install` sadece `dist/`teki kopyayı kurar, derlemez; değişiklikten sonra önce `app build`. Aynı sertifikayla (Apple Development) kuruldu, izinler korunur. Uygulama çıkışında (Cmd+Q, menü › Çıkış) sunucu da kapanır; pencereyi kapatmak uygulamayı kapatmaz; uygulama zorla kapatılırsa sunucu açık kalır ve sonraki açılışta yeniden kullanılır.

- **2026-10-11:** Başka bir oturumun yarım bıraktığı üç iş test edilip alındı. (1) Onay penceresinde "Bu sitede hep": bir sitede bir düğmeye "hep" denirse orada bir daha sorulmaz (`~/.jevis/site-permissions.json`, `site_permissions` aracı listeler/kaldırır); para, sipariş, ödeme, silme kelimeleri geçen düğmeler hiç hatırlanmaz (`rememberable`). Dikkat: "Send / Submit / Publish / Gönder / Yayınla" hatırlanabiliyor; kullanıcı isterse bunlar da hatırlanamaz listesine alınır. (2) `browser_new_password`: 20 karakterlik şifre üretir, iki alana yazar, Anahtar Zinciri'ne sadece bu site için kaydeder; aynı ad varsa üstüne yazmaz (`replace` eskisini `-old` yapar); değer ne kayıtta ne cevapta. Çok satırlı değerler (kurtarma kodları) tek satır saklanır. (3) `browser_open new_window` ve `browser_tabs to_window` (sayfa yeni pencerede yeniden açılır; formdaki yazılar ve kaydırma gelmez). Test: `tests/site-permissions-e2e.mjs` 14/14. guard 12/12, mcp-smoke 11/11, human 19/19, codes 18/18, files-change 11/11, router 51/51. Bilinen: `desktop-e2e`'de iki "Sil" hatası (TextEdit'te "Sil" onaysız geçiyor) 4b634a4'te de var, bu işlerden gelmiyor.
- **2026-10-10:** Bağlantısız giriş penceresi (`login_window`) ve SMS/Gmail doğrulama kodu okuma (`verification_code`); CAPTCHA yok. Başka oturumun `human_mode` işi önce ayrı commit'e alındı (4c30581). Yeni: `hands/codes.js`, `hands/browser.js` (profil süreçleri, temiz kapatma, portsuz açma, geçici sekme), `tests/codes-e2e.mjs`. Test sırasında bulunan hata: Türkçe `toLocaleLowerCase` "GARANTI"yi "garantı" yapıyordu, `from` süzgeci eşleşmiyordu (iki tarafı katlayarak düzeltildi). Not: Claude Code'un otomatik izin denetimi bu işin birkaç adımını önce reddetti; kullanıcı "A" (devam et) deyince yeniden denendi.
- **2026-10-10:** El: Handry ekranda parmaklarının üstünde yürüyen piksel art el (`app/hand/make.mjs`, 3B el → ışın izleme → piksel art), yeni ikon ve menü çubuğu simgesi, "Hey Handry"; port 4263 (başka sunucularla çakışmıyor), `/api/ping` kimlik kontrolü; `dist/`teki eski aynı kimlikli uygulamalar kaldırıldı. mcp-smoke 11/11, chats 9/9, timers 15/15, timers-ui 10/10, files-change 11/11, listener 7/7.

- **2026-10-09:** İnsan gibi giriş, gerektiğinde (Google "bu tarayıcı güvenli olmayabilir" sorunu). Neden: `fill()` tek bir `input` olayı üretiyordu (hiç tuş vuruşu yok), tıklamada fare olduğu yere ışınlanıyordu; masaüstünde `jevis-ax click` tek `mouseMoved` ile ışınlıyor, `type` 16'şar karakter patlatıyordu. `navigator.webdriver` zaten false ve CDP olaylarının screenX/Y'si doğru (ölçüldü), yani sorun Chrome bayrağı değil davranış. Çözüm `hands/human.js`: eğrisel ve hızlanıp yavaşlayan fare yolu, tıklamada basılı kalma, tekerlekle kaydırma, harf harf yazma (Shift, duraksama, yanlışsa `fill` ile düzeltme); masaüstünde `jevis-ax` imleci süzdürüyor, kısa metni tuş tuş yazıyor (`glide <x> <y>`, `cursor` yeni komutlar). **Varsayılan KAPALI** (yavaş: tıklama ~1 sn, yazı ~0,1 sn/harf). Karar beyinde: `human_mode` aracı (`on`, `scope` site|all, `site`, `minutes`; durum `~/.jevis/state.json` içinde `human`). Site kapsamı o sitenin ana alan adı için (accounts.google.com → google.com) kapatılana kadar hatırlanır; `all` dakika sayaçlıdır (varsayılan 30) ve masaüstünü de açar. Engel sayfası (Google "may not be secure"/"Couldn't sign you in", "unusual traffic", robot doğrulaması, Cloudflare) görülünce `browser_open/click/type…` ve `browser_read` sonucu beyne "human_mode aç, tekrar dene" der; mod zaten açıksa "tekrar deneme, wait_for_user ile kullanıcıdan elle yapmasını iste" der. MCP talimatına eklendi. `JEVIS_HUMAN=1` her yerde açar, `JEVIS_HUMAN=0` ya da config `"human": {"enabled": false}` kapalı tutar (beyin açamaz). Testler: `tests/human-e2e.mjs` 19/19 (yalıtılmış Chrome), browser-e2e 26/27 (Şiddet sorusu adımı eskiden beri sınırda, Jev %57), forms-e2e 9/9, mcp-smoke 11/11. Yan etki düzeltmesi: yeni sekme açan tıklamada bekleme süresi süzülmeden kısa kalıyordu.

- **2026-10-09:** Adı Handry (MCP `handry`, Handry.app); depo github.com/purplefox21/handry (gizli). Başka oturumun onay türü işi ayrı commit'lendi.

- **2026-10-01:** Dosya değiştirme araçları (klasör, taşı, kopyala, Çöp Sepeti, geri al; kurallar kodda), kayıtta "kim", büyük pencerede "Yapılanlar"; onay penceresi açıkken ekrana dokunulmuyor. files-change-e2e 11/11.

- **2026-10-01:** MCP sunucusu `inaro`, araçlar `inaro_do` / `inaro_teach`; kullanıcıya ve Claude'a görünen her yer Inaro. Uyandırma: "Hey Foxie", "Hey Fox", "Inaro, …". listener-e2e 7/7, mcp-smoke 11/11.

- **2026-10-01:** Uygulamanın adı Inaro (tilki Foxie); uyandırma "Hey Foxie" / "Hey Fox", "Hey Jev" kalktı; ad tek yerde (`core/brand.js`); izinler korunarak yeniden kuruldu. listener-e2e 6/6.

- **2026-10-01:** Faz 11 — Foxie: yeni ad, kimlik ve tilkiden ikon; İzinler penceresi; kullanıcının Blender piksel tilkisi ekranda geziyor (pencerelere zıplama, taşıma, köşede sarkma, uyku; düşünürken masada, iş bitince sevinç); "Hey Foxie".

- **2026-10-01:** Zamanlayıcıya tıklayınca kurulduğu sohbet açılıyor; zamanlanan komut sonucu o sohbete yazıyor; JEVIS.app menü çubuğunda ⚡ zamanlayıcıyla genişliyor, menüde liste (Sohbeti Aç / İptal Et).

- **2026-10-01:** Zamanlayıcı listesi: büyük pencerede ⏰ çekmecesi, çubukta "⏰ N" ve geri sayımda büyük İptal; tek tek ya da hepsini iptal (iki basış). timers-ui-e2e 9/9.

- **2026-10-01:** Zamanlayıcı, nöbet ve güç işleri (Apple menüsünden kilit/uyku/yeniden başlat/kapat); "VS Code'daki işler bitince kapat" Claude Code oturum dosyalarından; hızlı yol artık niyete bakıyor (sohbet, itiraz, cevap ve "sonra" Claude'a); beyin kendini tanıyor, "sen" diye konuşuyor. timers-e2e 14/14, router-e2e 51/51.

- **2026-10-01:** Claude Sonnet 5.5 çıktı; kullanıcının isteğiyle JEVIS'in varsayılan beyni **Sonnet 5.5** oldu (önce Sonnet 5). `claude` 2.1.283 → 2.1.286. Model düğmesi: Hızlı = Sonnet 5.5 (varsayılan), Güçlü = Opus 5.5. Yalın mod ve effort high aynı. Pencere ve çubuk, varsayılan değişince bir kereye mahsus yeni varsayılana geçiyor; sonra kullanıcının seçimi korunuyor. Çubuk listede olmayan eski bir seçimi göndermiyor. Denendi: JEVIS'in beyni Sonnet 5.5 ile araçsız kısa soruda 2,9 sn; model arayüzü görünmez Chrome'da doğrulandı; app-e2e'ye model kontrolü eklendi (tamamı kullanıcı Mac'i kullanırken çalıştırılmadı: Hesap Makinesi açıyor).

- **2026-10-01:** Sohbetler: her sohbetin kendi Claude oturumu, "sen yokken" ve "şu an ekranda" bilgisi, 12 turda özetle tazeleme, "yeni sohbet", sohbet listesi. 9/9 + 4/4.

- **2026-10-01:** Faz 10 bitti: giriş farkındalığı + iMessage, `browser_sessions`, `browser_fill`, `jevis_teach`, site notları, `browser_download`, `browser_save_value`, onay penceresinde değişiklikler, `browser_table`, numaralı ekran görüntüsü. 15/15.

- **2026-09-30:** Gerçek kullanımdan (başka bir Claude oturumu JEVIS'le GoDaddy'de DNS değiştirdi) gelen raporla 5 tarayıcı hatası düzeltildi: görünmez `<select>`li kutular, açılır listede yan menüden seçenek seçilmesi, başarısız işlemden sonra kayan #id'ler, uzun sayfalarda gereksiz uzun liste, `wait_for_user`'ın yanlışlıkla Enter'la bitmesi. Yeni test sayfası `tests/fixtures/dns-like.html`, `tests/forms-e2e.mjs` 9/9. Not: browser-e2e'deki "Şiddet sorusu → None" adımı değişiklikten bağımsız olarak sınırda (Jev %59-74).

- **2026-09-29:** Claude → JEVIS: `jevis_do` aracı (Claude oturumları basit komutu JEVIS'in hızlı yoluna ve öğrendiği işlere 1-3 sn'de verir, düşünme gerekiyorsa beyin çağırmadan geri döner). JEVIS MCP'si bütün Claude Code oturumlarına (kullanıcı kapsamı) ve Claude masaüstü uygulamasına kuruldu. MCP 11/11.
- **2026-09-29:** Öğrenme düzeltmeleri: önceki mesaja bağlı ("okey bi daha dene") ve sırayla seçen ("ikinci şarkı") komutlar öğrenilmiyor; öğrenilmiş iş tekrar edilmeden önce Jev "aynı iş mi" diye ikinci kez bakıyor. Yanlış öğrenilen iki kayıt `~/.jevis/learned-removed`'a alındı. 10/10.

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
   - ~~JEVIS araçları her Claude Code oturumunda~~ ✅ 2026-09-29'da yapıldı (kullanıcı kapsamında MCP). Claude masaüstü uygulamasına da eklendi; orada kullanmak için Claude uygulamasına Erişilebilirlik ve Ekran Kaydı izni gerekir.
   - Bu klasörde yeni bir Claude Code oturumu açınca `jevis` MCP sunucusunu onayla.
5. **İsteğe bağlı başka beyinler:**
   - Codex: `npm i -g @openai/codex`, sonra giriş.
   - Ollama: kur, bir model indir, adını `jevis.config.json` › `brain.providers.ollama.model` alanına yaz.
   - Anthropic API: `ANTHROPIC_API_KEY`.
6. **Google girişi ve doğrulama kodu (2026-10-10):**
   - Google engellerse: `node cli.js login-window` (ya da Claude'a "login_window ile gireyim" de). Açılan sıradan Chrome'da girişi yap, "Tamam"a bas; oturum profilde kalır.
   - SMS kodu için (isteğe bağlı): iPhone › Ayarlar › Mesajlar › Mesaj Yönlendirme'de bu Mac açık olmalı. Sonra Sistem Ayarları › Gizlilik ve Güvenlik › **Tam Disk Erişimi**'nde Handry'yi (ve kodu Claude Code'dan okutacaksan Terminal / VS Code'u) aç. Bu izni sadece sen verirsin.
   - Gmail kodu için Handry Chrome'unda Gmail'e bir kere giriş yap. Gerçek Gmail ve gerçek Mesajlar ile ilk deneme sende: çalışmazsa bana söyle.
7. **Paylaşmadan önce (2026-10-30):**
   - Lisans seç (MIT ya da ticari kapıyı açık tutan bir lisans).
   - Telefondan onay için: Sistem Ayarları › Gizlilik ve Güvenlik › Tam Disk Erişimi'nde Handry.app'i aç (Handry'nin kendi sohbeti ve çubuğu için). Claude Code oturumlarında da istersen VS Code / Terminal'i aç; bu izin geniştir, karar senin. Sonra `node cli.js doctor` "Telefondan onay" satırına bak, ilk gerçek denemeyi birlikte yapalım.
   - Demo videosu: sesle komut, form doldurma, telefondan kontrol.
