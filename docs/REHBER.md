# Handry Rehberi

Handry, Mac'ini senin yerine kullanan bir asistan. Yazarsın ya da söylersin; uygulamaları açar, düğmelere basar, form doldurur, dosya düzenler, riskli bir şey yapacaksa önce sana sorar. Kod bilmen gerekmez.

## Kurulum

1. `Handry-1.0.0.dmg` dosyasını indir ve çift tıkla.
2. Açılan pencerede **Handry'yi Applications'a sürükle**.
3. Uygulamalar klasöründen Handry'yi aç.
4. **İzinler** penceresi açılır. Önce "Başlamak için" bölümündeki **Erişilebilirlik**'e izin ver. Ekran Kaydı, Mikrofon ve Konuşma Tanıma önerilir, ama yazarak kullanacaksan şart değil.
5. Ana pencerede eksik bir şey varsa bir kart görürsün. **Claude'u Kur**, sonra **Giriş Yap** de.

Bu kadar. Xcode, Homebrew ya da terminal gerekmez.

> macOS "geliştirici doğrulanamadı" derse: Sistem Ayarları › Gizlilik ve Güvenlik › en altta **Yine de Aç**. Bu uyarı sadece Apple onayı olmayan deneme sürümlerinde çıkar.

### Neye ihtiyacım var?

| | |
|---|---|
| Mac | macOS 13.5 ya da üstü; Apple silicon ve Intel |
| Google Chrome | Web işleri için. Yoksa Handry söyler |
| Claude aboneliği | Form doldurma gibi düşünmek gereken işler için. Basit komutlar onsuz da çalışır |
| Jev anahtarı | İsteğe bağlı. Düğme seçme ve hızlı komutları daha akıllı yapar |

## İlk beş dakika

| Kısayol | Ne yapar |
|---|---|
| `⌥ Space` | Çentikten çubuğu açar, yazarsın. Çentikteki adaya tıklamak da açar |
| `⌥ ⇧ Space` | Basılı tut, konuş, bırak |
| "Hey Handry" | Sesle uyandırır (menüden açılıp kapanır) |
| `⌥ Esc` | **Acil durdurma.** Her şeyi durdurur, Handry 10 dakika ya da sen devam diyene kadar bir şey yapmaz |
| Dock simgesi | Büyük pencereyi açar: sohbetler, zamanlayıcılar, tarifler, ayarlar |

Denemek için çubuğa şunları yaz:

- `sesi yüzde 30 yap`
- `Spotify'da lo-fi çal`
- `hesap makinesinde 12 çarpı 7 yap`
- `Hacker News'i aç, ilk 5 başlığı özetle`

## Handry nasıl çalışır?

- **Basit işler anında:** Ses, müzik, uygulama açma gibi komutlar büyük bir yapay zekâya gitmeden 1-3 saniyede yapılır.
- **Zor işler Claude ile:** Claude adımları planlar, Handry tıklar ve yazar.
- **Ekrana bakmadan okur:** Düğmeleri çoğunlukla ekran görüntüsünden değil, uygulamanın ve sayfanın kendi düğme listesinden okur. Ekran görüntüsü yedektir.
- **Öğrenir:** Claude bir işi bir kez yapınca Handry aynı işi başka ayrıntılarla Claude'suz tekrarlayabilir.

Büyük penceredeki düğmeden modeli seçersin: **Hızlı** çoğu iş için yeterli, **Güçlü** daha zor işler için.

## Hızlı komutlar

Bunlar Claude olmadan da çalışır.

| Alan | Örnek |
|---|---|
| Ses | `sesi kıs`, `sesi yüzde 40 yap` |
| Müzik | `Spotify'da Tarkan çal`, `müziği durdur`, `sonraki şarkı`, `hangi şarkı çalıyor` |
| Uygulama | `Notlar'ı aç`, `Safari'yi kapat` |
| Site ve arama | `YouTube'u aç`, `Google'da Mac kısayolları ara` |
| Not | `not al: süt al` |
| Takvim | `bugün takvimimde ne var` |
| Sistem | `karanlık modu aç`, `ekranı kilitle` |

`yarın 10'da anımsat: toplantı` ya da `cuma 3'e görüşme ekle` gibi tarih ve saat gereken işlerde Claude devreye girer.

## Web'de iş yaptırma

Handry kendi Chrome penceresini kullanır. Sitelere bir kez elle girersin, oturum kalır.

- **Form doldurma:** `bu formu şu bilgilerle doldur: …`
- **Okuma:** `bu sayfayı özetle`, `bu tablodaki fiyatları listele`
- **İndirme ve yükleme:** `faturayı indir ve Projeler klasörüne koy`, `bu dosyayı forma yükle`
- **Bekleme:** `şu yazı çıkınca devam et`

Kaydet, gönder, yayınla, sil, öde gibi riskli gördüğü düğmelerde önce sana sorar.

### App Store Connect

Handry'nin başlama sebebi bu iş: fiyat, yaş sınırı anketi, gizlilik anketi, açıklamalar ve ekran görüntüleri. `uygulamamın App Store bilgilerini doldur` de; eksik bilgileri sorar, bölüm bölüm doldurur. **İncelemeye gönder** düğmesine sadece sen açıkça istersen basar.

## Mac uygulamalarını kullanma

Spotify, Slack, VS Code, Notlar, Finder ve çoğu uygulamada düğmeleri ve menüleri adıyla kullanır.

- `TextEdit'te yeni belge aç, şunu yaz: …`
- `Notlar'da "alışveriş" notunu bul`
- `Spotify'da beğendiklerimi aç`

Oyun gibi her şeyini kendi çizen uygulamalarda ekran görüntüsüne bakar.

## Pencereler ve masaüstleri

- `Safari'yi sola, Notlar'ı sağa al`
- `bu pencereyi tam ekran yap`, `ortala`
- `sağdaki masaüstüne geç`, `3. masaüstüne git`
- `şu projenin penceresine git`: başka masaüstünde ya da ekranda olsa da bulur

## Dosyalar

- `İndirilenler'de son PDF'i bul`, `bu klasörde neler var`
- `bu dosyaları Faturalar diye bir klasöre taşı`
- `bu dosyayı çöpe at`, `son yaptığını geri al`

Kurallar seni korur: hiçbir şey kalıcı silinmez, Çöp Sepeti'ne gider; üstüne yazılmaz; sadece ev klasöründe çalışır; sistem ve gizli klasörlere dokunmaz; büyük değişikliklerde önce sorar.

## "Nerede?" diye sor, göstersin

`karanlık mod ayarı nerede`, `bu sitede çıkış nasıl yapılır` gibi sorularda hiçbir şeye tıklamadan ekrana çizer: ok, daire, alt çizgi, kutu ve kısa bir etiket. Birkaç adım varsa sırayla gösterir. Sen tıklayınca ya da yazınca çizim kaybolur.

## Zamanlayıcı ve nöbet

Sohbet kapansa da çalışır, Handry kendisi kontrol eder.

- `10 dakika sonra hatırlat: fırını kapat`
- `saat 15'te ekranı kilitle`
- `şu pencerede "bitti" yazınca bana haber ver`
- `Claude işleri bitince bilgisayarı kapat`: kapatmadan önce geri sayım gösterir, iptal edebilirsin

Hepsi büyük penceredeki ⏰ listesinde ve menü çubuğundadır, oradan iptal edilir.

## Tarifler ve öğrenme

- **Kendiliğinden öğrenme:** Claude bir işi yapınca Handry aynı işi sonraki sefer onsuz, başka ayrıntılarla yapmayı dener.
- **Tarif:** Bir işi kaydeder, tek tıkla tekrarlarsın. İçine değişken konabilir: `App Store fiyatını {fiyat} yap`.
- Tarifler büyük penceredeki panelde durur.

## Girişler ve şifreler

- **Şifreler Anahtar Zinciri'nde:** Kayıtlı şifreyi Handry'nin kodu kutuya yazar, yapay zekâya gönderilmez. Her şifre sadece izin verdiğin sitelerde çalışır.
- **Yeni hesap:** Kayıt olurken Handry güçlü bir şifre üretir, yazar ve Anahtar Zinciri'ne kaydeder.
- **İki adımlı kod:** Uygulama kodları (TOTP) Anahtar Zinciri'nden gelir. SMS ve Gmail'e gelen kodları her seferinde sorarak okur.
- **Otomasyona izin vermeyen siteler (Google gibi):** Handry, Chrome'u bağlantısız açar, girişi elle yaparsın, oturum kalır. Giriş ya da doğrulama gerektiğinde seni çağırır ve bekler.

> SMS ve Gmail kodu okuma henüz yalnızca test ortamında denendi. Kullanırken ilk seferde sonucu kontrol et.

## Telefondan kullanım (deneysel)

Tam Disk Erişimi izni ve iMessage gerekir. Bu özellik henüz gerçek telefonlarla az denendi.

- **Komut:** Kendine `Handry, sesi kıs` diye iMessage yaz, yapıp cevabı yazar. `Handry, ekranı göster` ekran görüntüsü gönderir.
- **Onay:** Mac'teki soruya 20 saniye cevap gelmezse telefona kodlu mesaj gelir; kodu yazarsan onaylanır, "hayır" dersen iptal olur.
- Sadece kendi konuşman sayılır, sadece adla başlayan yeni mesajlar çalışır.

## Güvenlik: Handry ne yapmaz?

- **Riskli gördüğü adımda sorar.** Gönderme, yayınlama, silme, ödeme, fiyat değiştirme gibi adımlarda ekranın üstünde bir kart açılır. "Hayır" dersen durur ve başka yol aramaz. Kartı sadece senin tıklaman cevaplar; kart açıkken Handry'nin elleri ekrana dokunmaz.
- **"Bu sitede hep":** Sürekli sorulan bir düğme için seçebilirsin. Para, sipariş, silme ve dışarıya giden şeyler (gönder, yayınla, paylaş, davet) hiç hatırlanmaz.
- **Riski yapay zekâ ya da kurallar seçer,** bu yüzden kaçırabilir. Önemli işlerde ekrana bak; `⌥ Esc` her zaman durdurur.
- **Sayfadaki yazılar komut sayılmaz.** Bir sitenin asistanı yönlendirmeye çalışan yazıları gizlenir.
- **Her şey kaydedilir:** Kim, ne yaptı, sonuç ne oldu, sana soruldu mu. Büyük pencerede **Yapılanlar** bölümünde görürsün. Şifreler kayda yazılmaz.

## Ayarlar

| Nerede | Ne |
|---|---|
| Menü › İzinler | Bütün macOS izinleri tek pencerede |
| Menü › Mac Açılınca Başlat | Bilgisayar açılınca Handry de başlar |
| Menü › Dil / Language | Türkçe, İngilizce ya da Mac'in dili |
| Menü › Ekrandaki El | Göster, gizle, uyut, boyut; el ya da tilki |
| Menü › Çentikteki Ada | Hep, sadece çalışırken ya da hiç |
| Menü › Rehber | Bu sayfa |
| Büyük pencere › Ayarlar | Model, ses ve diğerleri |

## Sorun giderme

### Ayarlar'da izin açık ama Handry "verilmedi" diyor

- **Satırda "Yeniden Başlat" varsa** bas. macOS bazı izinleri (özellikle Ekran Kaydı) ancak uygulama yeniden açılınca uygular.
- **Satırda "Kaydı Sıfırla" varsa** bas. Ayarlar'daki kayıt Handry'nin eski bir kopyasına ait kalmıştır. Sıfırla, sonra yeniden izin ver.
- İkisi de yoksa Handry'den çık, yeniden aç ve **İzin Ver**'e bas.

### Uygulama dondu ya da "Cevap bekleniyor" yazıyor

Bir izin satırında "Cevap bekleniyor…" yazıyorsa o uygulama (örneğin Spotify) şu an cevap vermiyor. Handry beklemeye devam eder, sen de kullanmaya devam edebilirsin. O uygulamayı kapatıp açmak genelde çözer.

Gerçekten donarsa: `⌘ ⌥ Esc` ile Handry'yi kapat, yeniden aç. Olmazsa nerede olduğunu GitHub'da yaz.

### "Sunucu başlamadı"

Menüden **Sunucuyu Yeniden Başlat**'a bas. Kayıt dosyası: `~/.jevis/logs/app-server.log`.

### "Hey Handry"yi duymuyor

Mikrofon ve Konuşma Tanıma izinlerine bak. Olmazsa "Hey Fox" daha sağlam çalışır, `⌥ ⇧ Space` ile bas-konuş ise her zaman çalışır.

### Claude bağlanmıyor

Ana penceredeki kartta **Claude'u Kur** ve **Giriş Yap** adımlarını yap. Giriş için Claude aboneliği gerekir. O zamana kadar basit komutlar çalışır.

### Handry bir şeyi yanlış yaptı

`⌥ Esc` ile durdur. Dosya işlerini `son yaptığını geri al` ile geri alabilirsin. Yapılanlar listesinden ne olduğuna bak.

## Sık sorulanlar

**Ücretli mi?** Handry ücretsiz. Zor işler için Claude aboneliği gerekir.

**Verilerim nereye gidiyor?** Kayıtlar, ayarlar ve öğrenilenler Mac'inde `~/.jevis` klasöründe durur. Zor işlerde yapılacak iş ve okunan sayfa bilgileri Claude'a gider. Jev anahtarı kullanırsan düğme seçimleri için sayfa bilgisi Jev'e de gider.

**Jev nedir?** Hızlı karar veren küçük bir model: 300 düğmeden hangisi "Kaydet", bu tıklama riskli mi? Anahtar yoksa Handry aynı kararları kelimeler ve kurallarla verir; biraz daha sık sorar.

**Satabilir miyim?** Kullanabilir ve kurcalayabilirsin; satamazsın. Lisans: PolyForm Shield 1.0.0.

**Windows'ta çalışır mı?** Hayır, sadece Mac.

## Kod yazanlar için

### Kaynaktan kurma

Node.js 20+, Google Chrome ve Xcode Command Line Tools gerekir.

```bash
git clone https://github.com/purplefox21/handry.git
cd handry
npm install
node cli.js doctor
node cli.js app install
node cli.js app open
```

Kaynaktan derlenen kopyayı Apple sertifikan yoksa macOS her yeni derlemede yeni uygulama sayar ve izinleri yeniden ister. Gereksiz yeniden derleme.

### Claude Code ile

Handry'nin bütün araçları MCP ile her Claude Code oturumuna açılır:

```bash
claude mcp add --scope user handry -- node "$(pwd)/mcp/server.js"
```

İndirilen uygulamada yollar:

```bash
claude mcp add --scope user handry -- /Applications/Handry.app/Contents/Helpers/node /Applications/Handry.app/Contents/Resources/handry/mcp/server.js
```

`Claude'a jev projesinde testleri çalıştırt` dersen Handry, projenin VS Code penceresinde görünür bir Claude sekmesi açar, işi başlatır ve bitince haber verir. Arka planda gizli çalışma yoktur.

### Terminal

```bash
node cli.js do "Spotify'da lo-fi çal"
node cli.js read
node cli.js desk read --app=Notes
node cli.js stop
node cli.js app package
```

Beyin değiştirilebilir: Claude Code, Codex, Claude API, OpenAI uyumlu API'ler, Ollama.

---

Handry · Berat Olekli ([purplefox](https://github.com/purplefox21)) · [GitHub](https://github.com/purplefox21/handry) · [LinkedIn](https://www.linkedin.com/in/berat-olekli/)
