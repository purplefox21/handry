# Handry Rehberi

Handry, Mac'ini senin yerine kullanan bir asistan. Yazarsın ya da söylersin; uygulamaları açar, düğmelere basar, form doldurur, dosya düzenler, riskli bir şey yapacaksa önce sana sorar. Kod bilmen gerekmez.

## Kurulum

1. `Handry-1.0.0.dmg` dosyasını indir ve çift tıkla.
2. Açılan pencerede **Handry'yi Applications'a sürükle**.
3. Uygulamalar klasöründen Handry'yi aç.
4. **İzinler** penceresi açılır. Önce "Başlamak için" bölümündeki **Erişilebilirlik**'e izin ver. Ekran Kaydı, Mikrofon ve Konuşma Tanıma önerilir, ama yazarak kullanacaksan şart değil.
5. Ana pencerede eksik bir şey varsa bir kart görürsün. **Claude'u Kur**, sonra **Giriş Yap** de.

Bu kadar. Xcode, Homebrew ya da terminal gerekmez.

Claude uygulamasında ya da Claude Code'da da kullanmak istersen: [Claude ile kullanma](#claude-ile-kullanma-mcp).

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
| `⌥ ⇧ P` | **Kalem:** ekrana sen çiz, sonra sor |
| `⌥ Esc` | **Acil durdurma.** Her şeyi durdurur. Yeni bir komut verene kadar, en fazla 10 dakika, Handry bir şey yapmaz |
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
- **Önce giriş kontrolü:** `App Store Connect ve Firebase'e girişim var mı bak`: işe başlamadan hangi sitelere girmen gerektiğini söyler.
- **Sekme ve pencere:** `bunu ayrı pencerede aç`, `açık sekmeleri listele`
- **Değer kaydetme:** `bu API anahtarını Anahtar Zinciri'ne kaydet`: sayfada görünen anahtarı ya da kimliği doğrudan kaydeder.
- **İnsan gibi kullanma:** Site otomasyonu fark ederse fare yavaş ve eğrisel gider, yazı harf harf yazılır. Daha yavaş olduğu için normalde kapalıdır. `bu sitede insan gibi kullan` diyerek de açarsın.
- **Site notları:** Bir sitede gizli bir ayar bulunursa not bırakılır, o siteye dönünce not da geri gelir.

Kaydet, gönder, yayınla, sil, öde gibi riskli gördüğü düğmelerde önce sana sorar.

### App Store Connect

Handry'nin başlama sebebi bu iş: fiyat, yaş sınırı anketi, gizlilik anketi, açıklamalar ve ekran görüntüleri. `uygulamamın App Store bilgilerini doldur` de; eksik bilgileri sorar, bölüm bölüm doldurur. **İncelemeye gönder** düğmesine sadece sen açıkça istersen basar.

## Mac uygulamalarını kullanma

Spotify, Slack, VS Code, Notlar, Finder ve çoğu uygulamada düğmeleri ve menüleri adıyla kullanır.

- `TextEdit'te yeni belge aç, şunu yaz: …`
- `Notlar'da "alışveriş" notunu bul`
- `Spotify'da beğendiklerimi aç`
- `Müzik'te caz listemi çal`
- `anımsatıcılarımı listele`

Oyun gibi her şeyini kendi çizen uygulamalarda ekran görüntüsüne bakar.

## Pencereler ve masaüstleri

- `Safari'yi sola, Notlar'ı sağa al`
- `bu pencereyi tam ekran yap`, `ortala`, `küçült`, `geri getir`
- `Safari, Notlar ve Slack'i yan yana diz`: üç ve daha fazla pencere ızgara gibi dizilir
- `sağdaki masaüstüne geç`, `3. masaüstüne git`
- `şu projenin penceresine git`: başka masaüstünde ya da ekranda olsa da bulur

## Dosyalar

- `İndirilenler'de son PDF'i bul`, `bu klasörde neler var`
- `bu dosyaları Faturalar diye bir klasöre taşı`
- `son değiştirdiğim dosyalar neler`, `bu dosyayı aç`
- `bu dosyayı Yedekler'e kopyala`, `adını Fatura 2026 yap`
- `bu dosyayı çöpe at`, `son yaptığını geri al`

Kurallar seni korur: hiçbir şey kalıcı silinmez, Çöp Sepeti'ne gider; üstüne yazılmaz; sadece ev klasöründe çalışır; sistem ve gizli klasörlere dokunmaz; büyük değişikliklerde önce sorar. Büyük penceredeki **Yapılanlar**'da **Son dosya işini geri al** düğmesi de vardır.

## "Nerede?" diye sor, göstersin

`karanlık mod ayarı nerede`, `bu sitede çıkış nasıl yapılır` gibi sorularda hiçbir şeye tıklamadan ekrana çizer: ok, daire, alt çizgi, kutu ve kısa bir etiket. Birkaç adım varsa sırayla gösterir. Sen tıklayınca ya da yazınca çizim kaybolur. Riskli bir adım onayını beklerken de ilgili düğmenin çevresine daire çizer.

## Kalem: sen çiz, Claude baksın

Bir yeri daire içine alıp ya da altını çizip "bu ne?", "buraya mı basayım?" diye sorabilirsin. Claude çizdiğin yere ve altında ne olduğuna bakarak cevap verir.

1. Kalemi aç: `⌥ ⇧ P`, çentikteki adanın solundaki kalem, menü › **Kalem** ya da çubuktaki ✏️.
2. Fareyle ya da trackpad'le çiz. Çizgilerin fosforlu yeşil olur; Handry'nin kendi çizimleri hiç bu renkte olmaz. `⌘ Z` son çizgiyi geri alır, üstteki **Temizle** hepsini siler.
3. `Esc` ya da **Bitti** ile çık. Çubuk "✏️ Çizim ekli" etiketiyle açılır: sorunu yaz ya da `⌥ ⇧ Space` ile söyle. Soru çizimle birlikte gider.
4. Soruyu Handry yerine VS Code'daki açık bir Claude oturumuna sormak istersen, çubukta "ya da gönder: → oturum adı" düğmesine bas.

- Çizgiler sen silene ya da yeni bir çizime başlayana kadar ekranda kalır. Etiketteki ✕ çizimi siler.
- Kalem kapalıyken çizgiler tıklamaları engellemez, fare normal çalışır.
- İki ekranda da çalışır.
- Bir onay kartı açıkken kalem açılmaz.
- Ekran görüntüsü sadece Claude çizime bakarken alınır, `~/.jevis/marks` klasöründe kalır.

> Claude Code'da Handry'yi bu güncellemeden önce açtıysan çizime bakan araç o oturumda yoktur. Oturumda `/mcp` yazıp handry'yi yeniden bağla ya da yeni bir oturum aç. Çubuktan gönderilen soru yine de çalışır, çünkü mesajda çizimin özeti ve resimlerin yolu var.

## Göz takibi (deneysel)

Kamera ekranın neresine baktığını tahmin eder. Şimdilik sadece baktığın yeri saydam bir daireyle gösterir; ilerde okurken kaydırma ve "şunu aç" gelecek.

1. Menü › **Göz Takibi**. İlk seferde macOS kamera izni sorar, izin vermek senin kararın.
2. İlk açılışta kalibrasyon (yaklaşık 35 saniye, `Esc` vazgeçer): önce 9 yeşil noktaya başını oynatmadan sadece gözlerinle bak. Sonra 3 noktada gözünü noktadan ayırmadan başını yavaşça oynat: sağa sola, aşağı yukarı, biraz öne ve geriye. Bu bölüm başını oynattığında da doğru çalışmasını sağlar.
3. Sonra baktığın yeri mavi saydam bir daire ve kısa bir iz takip eder. Ne kadar saptığı ekranda yazar. Gözlerini kapatınca "Gözler kapalı", ekrana bakmayınca "Ekrana bakmıyorsun" yazar ve daire kaybolur.

- Yeniden ayar için menü › **Gözü Kalibre Et**. Başka bir ekranda yeniden kalibre et.
- Kamera görüntüsü Mac'ten çıkmaz, kaydedilmez. Göz takibi açıkken kameranın yeşil ışığı yanar.
- Web kamerasıyla beklenen sapma 1-2 cm; ekranın kenarlarında daha fazla.

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
- **Kaydetme:** Claude bir işi bitirince sohbette **Tarif olarak kaydet** düğmesi çıkar.
- Tarifler büyük penceredeki panelde durur. Claude kullanmazlar; bir adımda takılırsa Claude kaldığı yerden devam eder.

## Sohbetler

Her sohbetin kendi Claude oturumu vardır, bu yüzden `bunu`, `tekrar dene` gibi sözleri anlar. Çubuk, ses ve büyük pencere aynı sohbete yazar.

- Konu değişince `yeni sohbet` de ya da büyük penceredeki **Yeni sohbet**'e bas. 2 saat sessizlikten sonra yenisi kendiliğinden başlar.
- Eski sohbetler büyük penceredeki **Sohbetler** listesindedir.

## Ekrandaki el ve ada

- **El:** Parmaklarının üstünde yürüyen küçük bir el, Dock'ta ve pencerelerin üst kenarında gezer, Handry'nin ne yaptığını gösterir. Menüden gizleyebilir, uyutabilir, boyutunu değiştirebilir ya da yerine tilkiyi seçebilirsin.
- **Ada:** Ekranın üstünde, çentiğin yanında durur. Çalışırken iki yana açılır, tıklayınca çubuk açılır. Menüden hep görünsün, sadece çalışırken görünsün ya da hiç görünmesin diye seçersin.

## Girişler ve şifreler

- **Şifreler Anahtar Zinciri'nde:** Kayıtlı şifreyi Handry'nin kodu kutuya yazar, yapay zekâya gönderilmez. Her şifre sadece izin verdiğin sitelerde çalışır.
- **Yeni hesap:** Kayıt olurken Handry güçlü bir şifre üretir, yazar ve Anahtar Zinciri'ne kaydeder.
- **İki adımlı kod:** Uygulama kodları (TOTP) Anahtar Zinciri'nden gelir. SMS ve Gmail'e gelen kodları her seferinde sorarak okur.
- **Otomasyona izin vermeyen siteler (Google gibi):** Handry, Chrome'u bağlantısız açar, girişi elle yaparsın, oturum kalır. Giriş ya da doğrulama gerektiğinde seni ses, bildirim ve çubukla çağırır, bir dakika sonra iMessage da atar ve bekler.
- **Şifre kaydetme:** Şimdilik terminal gerekir. Aşağıdaki komut şifreyi iki kez sorar ve ekranda göstermez. Sonra `GitHub'a github şifresiyle gir` dersin. Authenticator anahtarı da aynı komutla kaydedilir (`github-2fa` gibi bir adla). Şifre kaydetmek şart değil: sitelere elle de girebilirsin, oturum kalır.

```bash
/Applications/Handry.app/Contents/Helpers/node /Applications/Handry.app/Contents/Resources/handry/cli.js secret add github --site=github.com
```

> SMS ve Gmail kodu okuma henüz yalnızca test ortamında denendi. Kullanırken ilk seferde sonucu kontrol et.

## Telefondan kullanım (deneysel)

Tam Disk Erişimi izni ve iMessage gerekir. Bu özellik henüz gerçek telefonlarla az denendi.

- **Komut:** Kendine `Handry, sesi kıs` diye iMessage yaz, yapıp cevabı yazar. `Handry, ekranı göster` ekran görüntüsü gönderir.
- **Onay:** Mac'teki soruya 20 saniye cevap gelmezse telefona kodlu mesaj gelir; kodu yazarsan onaylanır, "hayır" dersen iptal olur.
- **Telefona gönderme:** Mac'teyken `ekranı telefonuma at` dersen ekran görüntüsü kendi adresine gelir. Başka kimseye gönderilmez.
- Sadece kendi konuşman sayılır, sadece adla başlayan yeni mesajlar çalışır.

## Claude ile kullanma (MCP)

Handry'nin çubuğu Claude'u zaten kullanır, onun için bir şey bağlaman gerekmez. Bu bölüm tersi için: Claude uygulamasında ya da Claude Code'da sohbet ederken Claude'un Handry'nin ellerini kullanması. MCP, Claude'a araç bağlama yolunun adıdır.

Bağlayınca Claude'a `Handry ile sesi yüzde 30 yap` ya da `Handry ile bu formu doldur` diyebilirsin. Onay kartları, `⌥ Esc` ve Yapılanlar kaydı aynen çalışır. Ekrana çizim, ada ve el için Handry açık olmalı.

### Claude uygulaması

1. Ekranın en üstündeki menü çubuğundan **Claude › Settings… › Developer › Edit Config**'e bas (Claude penceresinin içindeki ayarlar değil).
2. `claude_desktop_config.json` dosyasını TextEdit ile aç.
3. Dosya boşsa ya da içinde sadece `{}` varsa aşağıdaki metni yapıştır. Başka ayarlar varsa onları silme: `"handry"` bölümünü `mcpServers`'ın içine ekle, `mcpServers` yoksa onu da ekle.
4. Kaydet, Claude'dan **⌘ Q** ile çık ve yeniden aç.
5. **Sistem Ayarları › Gizlilik ve Güvenlik › Erişilebilirlik**'te **Claude**'u aç. Ekran görüntüsü de kullanacaksa **Ekran Kaydı**'nda da aç.

```json
{
  "mcpServers": {
    "handry": {
      "command": "/Applications/Handry.app/Contents/Helpers/node",
      "args": ["/Applications/Handry.app/Contents/Resources/handry/mcp/server.js"]
    }
  }
}
```

Bağlandığını görmek için mesaj kutusundaki **+** › **Connectors › Manage connectors** listesine bak; `handry` orada olmalı.

> Claude'a neden ayrıca izin? macOS izni, Handry'nin araçlarını başlatan uygulamaya sorar. Bunları Claude başlattığı için Handry'ye verdiğin izin burada sayılmaz.

### Claude Code

Terminalde şunları çalıştır. İkinci komut `✔ Connected` yazmalı. Handry bundan sonra bütün projelerinde açık olur.

```bash
claude mcp add --scope user handry -- /Applications/Handry.app/Contents/Helpers/node /Applications/Handry.app/Contents/Resources/handry/mcp/server.js
claude mcp get handry
```

Erişilebilirlik iznini Claude Code'u çalıştırdığın uygulamaya ver: Terminal ya da Visual Studio Code.

Handry `/Applications`'ta değilse (örneğin ev klasöründeki Uygulamalar'daysa) iki yöntemde de yolları ona göre değiştir.

## Güvenlik: Handry ne yapmaz?

- **Riskli gördüğü adımda sorar.** Gönderme, yayınlama, silme, ödeme, fiyat değiştirme gibi adımlarda ekranın üstünde bir kart açılır. "Hayır" dersen durur ve başka yol aramaz. Kartı sadece senin tıklaman cevaplar; kart açıkken Handry'nin elleri ekrana dokunmaz.
- **"Bu sitede hep":** Sürekli sorulan bir düğme için seçebilirsin. Para, sipariş, silme ve dışarıya giden şeyler (gönder, yayınla, paylaş, davet) hiç hatırlanmaz.
- **Riski yapay zekâ ya da kurallar seçer,** bu yüzden kaçırabilir. Önemli işlerde ekrana bak; `⌥ Esc` her zaman durdurur.
- **Sayfadaki yazılar komut sayılmaz.** Bir sitenin asistanı yönlendirmeye çalışan yazıları gizlenir.
- **Her şey kaydedilir:** Kim, ne yaptı, sonuç ne oldu, sana soruldu mu. Büyük pencerede **Yapılanlar** bölümünde görürsün. Şifreler kayda yazılmaz.

## Ayarlar

| Nerede | Ne |
|---|---|
| Menü › Kalem | Ekrana çizip sormak (`⌥ ⇧ P`) |
| Menü › İzinler | Bütün macOS izinleri tek pencerede |
| Menü › Mac Açılınca Başlat | Bilgisayar açılınca Handry de başlar |
| Menü › Dil / Language | Türkçe, İngilizce ya da Mac'in dili |
| Menü › Ekrandaki El | Göster, gizle, uyut, boyut; el ya da tilki |
| Menü › Çentikteki Ada | Hep, sadece çalışırken ya da hiç |
| Menü › Rehber | Bu sayfa |
| Menü › Tarayıcıda Aç | Büyük pencereyi tarayıcıda açar |
| Ayarlar › Model | Hızlı ya da Güçlü |
| Ayarlar › Düşünme seviyesi | Claude'un her adımda ne kadar düşüneceği; Yüksek önerilir |
| Ayarlar › Hızlı yol | Basit komutları Claude'a sormadan yapar; kapatılabilir |
| Ayarlar › Sesli cevap | Cevabın kısa özetini sesli okur |
| Ayarlar › Gelişmiş › Beyin | Kurduysan Claude Code yerine başka bir beyin seçer |
| Ayarlar › Durum | Jev, Claude, Chrome ve whisper hazır mı |

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

Mikrofon ve Konuşma Tanıma izinlerine bak; bütün sesli komutlar bu ikisini ister. İzinler tamamsa "Hey Fox" daha sağlam çalışır, `⌥ ⇧ Space` ile bas-konuş ise uyandırma kelimesi gerektirmez.

### Durum'da "Ses tanıma (whisper): kurulu değil" yazıyor

Sorun değil. Sesli komut Apple'ın tanıyıcısıyla çalışır. whisper isteğe bağlıdır, Handry gibi adları daha iyi duyar. Büyük penceredeki mikrofon düğmesi sadece whisper kuruluysa görünür; `⌥ ⇧ Space` her durumda kullanılır.

### Claude bağlanmıyor

Ana penceredeki kartta **Claude'u Kur** ve **Giriş Yap** adımlarını yap. Giriş için Claude aboneliği gerekir. O zamana kadar basit komutlar çalışır.

### Claude uygulamasında ya da Claude Code'da Handry görünmüyor

- Claude'dan **⌘ Q** ile tamamen çık, yeniden aç.
- Ayar dosyasında eksik virgül ya da tırnak olabilir. Yolların Handry'nin bulunduğu yerle aynı olduğuna bak.
- Ne olduğunu şu kayıt söyler: `~/Library/Logs/Claude/mcp-server-handry.log`. Claude Code'da `claude mcp get handry` çalıştır.
- "Erişilebilirlik izni yok" derse izni Handry'ye değil Claude'a, Terminal'e ya da Visual Studio Code'a ver.

### Handry bir şeyi yanlış yaptı

`⌥ Esc` ile durdur. Dosya işlerini `son yaptığını geri al` ile geri alabilirsin. Yapılanlar listesinden ne olduğuna bak.

## Sık sorulanlar

**Ücretli mi?** Handry ücretsiz. Zor işler için Claude aboneliği gerekir.

**Verilerim nereye gidiyor?** Kayıtlar, ayarlar ve öğrenilenler Mac'inde `~/.jevis` klasöründe durur. Zor işlerde yapılacak iş ve okunan sayfa bilgileri Claude'a gider. Jev anahtarı kullanırsan düğme seçimleri için sayfa bilgisi Jev'e de gider.

**Jev nedir?** Hızlı karar veren küçük bir model: 300 düğmeden hangisi "Kaydet", bu tıklama riskli mi? Anahtar yoksa Handry aynı kararları kelimeler ve kurallarla verir; biraz daha sık sorar.

**Jev anahtarını nereye yazarım?** [TypeSafe](https://typesafe.ai)'ten aldığın anahtarı terminalde `echo "JEV_KEY=anahtarın" >> ~/.jevis/.env` ile kaydet, sonra menüden **Sunucuyu Yeniden Başlat**'a bas.

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

Kaynaktan çalışan kopyayı Claude Code'a bağlamak için (indirilen uygulama için [Claude ile kullanma](#claude-ile-kullanma-mcp)):

```bash
claude mcp add --scope user handry -- node "$(pwd)/mcp/server.js"
```

Sesli komutlarda adları daha iyi duymak için isteğe bağlı whisper: `brew install whisper-cpp` ve bir model. `node cli.js doctor` eksiğini söyler.

### Claude Code'a iş yaptırma

- `Claude'a jev projesinde testleri çalıştırt`: Handry, projenin VS Code penceresinde görünür bir Claude sekmesi açar ve işi başlatır. Arka planda gizli çalışma yoktur.
- `jev projesindeki Claude'a "devam et" yaz`: Açık bir oturuma yazar.
- `jev projesinde ne yaptık`: Son işleri ve Claude oturumlarını özetler.
- Oturum bitince ya da cevap bekleyince çubukta ve iMessage ile haber verir.
- VS Code ilk seferde Claude eklentisinin bağlantı açmasına izin ister. Bu senin kararın: Handry **Open** düğmesini daireye alır ve bekler, 2 dakika cevap yoksa isteğini geri çeker.

### Telefondan Claude Code

Bu klasörde `claude remote-control` çalıştır, o oturumla Claude uygulamasından konuş. Oturum Handry'nin araçlarını kullanır.

### Terminal

```bash
node cli.js do "Spotify'da lo-fi çal"
node cli.js read
node cli.js desk read --app=Notes
node cli.js stop
node cli.js secret add github --site=github.com
node cli.js doctor
node cli.js app package
node appstore/privacy-scan.js <kod-klasörü>   # App Store gizlilik anketi için taslak
```

Beyin değiştirilebilir: Claude Code, Codex, Claude API, OpenAI uyumlu API'ler, Ollama.

---

Handry · Berat Olekli ([purplefox](https://github.com/purplefox21)) · [GitHub](https://github.com/purplefox21/handry) · [LinkedIn](https://www.linkedin.com/in/berat-olekli/)
