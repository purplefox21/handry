# Foxie · masaüstü pet'i · uygulama tarifi

Bu klasör, macOS'ta masaüstünde yaşayan piksel art bir kızıl tilki ("Foxie") uygulamasının bütün görsellerini ve davranış tarifini içerir. Görseller hazır ve sabittir. Senden istenen, bunları kullanan uygulamayı yazmak. Görselleri yeniden üretme ya da değiştirme. Bir animasyon eksikse ya da yanlışsa kullanıcıya söyle, o görsel tarafa iletir.

Kullanıcı kod yazmıyor. Uygulamayı çalıştırıp oynayarak geri bildirim verecek. Türkçe konuşur.

## 1. Kullanıcının istediği (kendi tarifinden)

- Tilki masaüstünde kendi kendine dolaşır: Dock'un üstünde (ekranın altında) yürür, oturur, sıkılır, uyur.
- Fareyle **tutup bir yere taşınabilir**: kuyruğundan ya da ensesinden (sırtından) tutulur. Bırakınca düşer, yere iner.
- Bir **pencere açılınca** (örneğin Safari'de gezerken) tilki masaüstünden o pencerenin üstüne **zıplar**, pencerenin üst kenarında gezinir, orada takılır.
- Pencere **taşınırsa** onunla gider. Pencere **kapanınca** düşer, masaüstüne geri iner.
- Pencerelerin **köşelerinde** durur: kenarda yatıp ön patilerini aşağı sarkıtır.
- **Tıklamaya tepki verir**: sevilir (gözlerini kapatıp mutlu olur) ya da sevinçle zıplar. Uyurken tıklanırsa uyanır.
- Masaüstüne zarar vermez: tilkinin olmadığı yerde tıklamalar alttaki uygulamalara geçer.
- Hafif olmalı, arka planda az işlemci yemeli.

## 2. Paket

```
foxie_pet/
  UYGULAMA_TARIFI.md        bu dosya
  sprites/
    manifest.json           her animasyonun bilgisi (aşağıda)
    idle/0001.png ...       her animasyon kendi klasöründe, numaralı, şeffaf PNG kareler
    walk/ run/ ...          (21 animasyon, 878 kare, ~3.4 MB)
  onizleme/
    index.html              bütün animasyonlar oynarken (tarayıcıda aç)
    <anim>.gif              tek tek, 3 kat büyük
```

### Kare ve koordinatlar

- Varsayılan kare **180 × 146 piksel**. Bütün kareler bu boyda; istisnalar manifest'te `frame` ile yazılı (`held_tail`, `held_scruff`: 180 × 190).
- Koordinatlar karenin **sol üstünden**, piksel cinsinden (x sağa, y aşağı), 0'dan başlar.
- **`ground`: 128.** Ayak tabanlarının bastığı satır. Tilkiyi bir zemine koyarken karenin 128. satırını zeminin hizasına getir. Yerde duran bütün animasyonlarda geçerli, `held_*` hariç.
- **Yön:** Tilki hep **sağa** bakar. Sola giderken kareyi **yatay aynala**. Aynalanınca x'ler değişir: `x' = kare_genişliği - 1 - x`. Bu, çapalar için de geçerli.
- Kareler piksel art. **Büyütürken en yakın komşu kullan**, yumuşatma yok (`magnificationFilter = .nearest`). Önerilen ekran boyu 1× ya da 2×. İstersen ayarlardan seçilsin. Ekranda N kat büyütülünce `speed`, `ground` ve `anchor` değerleri de N ile çarpılır.
- Işık sol üstten geliyor. Aynalanınca sağ üstten gelmiş olur, bu kabul edilebilir.

### manifest.json alanları

| alan | anlamı |
|---|---|
| `frame` (kökte) | varsayılan kare boyu [genişlik, yükseklik] |
| `ground` (kökte) | ayakların bastığı satır |
| `facing` | "right": çizimler sağa bakar |
| `animations.<ad>.fps` | saniyedeki kare (hepsi 24) |
| `loop` | true: döngü (son kare ilk kareye akar); false: bir kez oynar |
| `frames` | kare sayısı (dosyalar 0001.png ... ) |
| `next` | bir kez oynayan bittikten sonra geçilecek animasyon |
| `speed` | yürürken ya da koşarken tilkinin ekranda saniyede kaç piksel ilerlemesi gerektiği (1×). Bu hızla götürülürse ayaklar kaymaz. Animasyonlar **yerinde** çizildi, ilerletmek uygulamanın işi. |
| `frame` (animasyonda) | bu animasyonun kare boyu, varsayılandan farklıysa |
| `anchor` + `anchor_type` | `grab`: tutulan nokta. Tutulurken bu piksel fare imlecinin tam altında olmalı. `edge_corner`: pencere köşesi. Bu piksel pencerenin üst köşesine oturtulur. |
| `liftoff_frame` | `jump`'ta tilkinin yerden koptuğu kare (dosya numarası, 1'den). Bu kareden itibaren uygulama tilkiyi havaya kaldırır. Kareler kendi içinde yerde çizildi. |
| `mirror_after` | `turn`: bittiğinde tilki artık sola bakıyor, bundan sonra aynalı çiz |

## 3. Animasyonlar

| ad | tür | ne yapıyor | ne zaman |
|---|---|---|---|
| `idle` | döngü 4 sn | oturur, nefes alır, bakınır, göz kırpar, kulak seğirir, kuyruk oynar | boşta (temel durum) |
| `walk` | döngü 1 sn | sakin yürüyüş, 36.8 px/sn | bir yerden bir yere giderken |
| `run` | döngü 0.5 sn | dörtnala, 245 px/sn | hızlı gitmesi gerekince (uzak bir pencereye, imleci kovalarken) |
| `stop` | bir kez → idle | koşudan fren yapıp oturur | koşu bitince. İlk ~9 karede (≈0.4 sn) hızı 245'ten 0'a düşür, sonra yerinde. |
| `turn` | bir kez → idle, aynala | otururken arkasını döner (yüzü bize dönerek) | yön değiştirirken; bitince aynalı çiz |
| `ears_up` | bir kez → listen | kulaklarını dikip başını bize çevirir | dikkat çekilince (asistan uygulamasında "Hey Foxie") |
| `listen` | döngü 3 sn | bize bakar, merakla başını eğer | dinlerken |
| `desk` | döngü 2 sn | küçük masada dizüstünde yazar (masa ve laptop karede) | "çalışıyor" havası; asistan düşünürken |
| `petted` | bir kez → idle | gözlerini mutlulukla kapatır, başını kaldırıp eğer, kuyruk sallar | üstüne tıklanınca |
| `happy` | bir kez → idle | çöker, havaya zıplar (yerinde), iner, kuyruk sallar | sevinçli anlar; ara sıra tıklamada |
| `sad` | bir kez → idle | kulaklar düşer, başı eğilir, iç çeker | (isteğe bağlı) |
| `bored` | döngü 4 sn | yere uzanmış, çenesi patilerinde, gözler yarı kapalı, iç çeker | uzun süre bir şey olmayınca |
| `lie_down` | bir kez → sleep | oturuştan uzanıp kıvrılır | uykuya geçerken |
| `sleep` | döngü 4 sn | kıvrılmış uyur, nefes alır | uyurken |
| `wake_up` | bir kez → idle | uyanır, esner, oturur | uyurken tıklanınca ya da kendiliğinden |
| `jump` | bir kez → fall | çöker, yukarı sıçrar; `liftoff_frame` 11 | pencerenin üstüne çıkarken |
| `fall` | döngü 0.5 sn | düşerken: bacaklar açık, kulaklar havada | havada aşağı inerken |
| `land` | bir kez → idle | iner, çöker, toparlanıp oturur | zemine değince |
| `held_tail` | döngü 1 sn, 180×190 | kuyruğundan tutulmuş, baş aşağı sallanır, çırpınır; `anchor` [90, 38] | kuyruğundan tutulurken |
| `held_scruff` | döngü 2 sn, 180×190 | ensesinden tutulmuş, gevşek sarkar; `anchor` [90, 59] | ensesinden/sırtından tutulurken |
| `edge_hang` | döngü 2 sn | pencerenin köşesinde yatar, ön patiler kenardan aşağı sarkar; `anchor` [124, 91] köşe | pencere köşesinde dinlenirken |

Bir kez oynayanlar (`stop` hariç) **temel oturuşla başlar ve biter**. `idle`'ın ilk karesi de bu oturuştur. Böylece birinden ötekine geçerken tilki zıplamaz. Döngülerden çıkarken mevcut kareyi bitirip `idle`'a geçmek yeterli.

## 4. Davranış (durum makinesi önerisi)

Durumlar: `IDLE`, `WALK`, `RUN`, `TURN`, `SIT_SPECIAL` (petted, happy, sad), `BORED`, `SLEEP` (lie_down → sleep → wake_up), `EDGE`, `JUMP`, `FALL`, `LAND`, `HELD`.

- **Zemin.** Tilki her an bir zeminin üstündedir: ya ekranın alt zemini (Dock'un üstü) ya da bir pencerenin üst kenarı. Zemin bir yatay çizgi parçasıdır: [x1, x2], y. Tilkinin `ground` satırı bu y'ye oturur.
- **IDLE** (temel): 4-10 sn rastgele bekler, sonra ağırlıklı rastgele seçer:
  - **Yürümek:** Aynı zeminde rastgele bir hedefe `walk`. Hedef ters yöndeyse önce `turn`.
  - **Yerinde kalmak:** `idle` devam eder.
  - **Pencereye çıkmak:** Ekranda üstüne çıkılabilecek bir pencere varsa (aşağıda), oraya yürü/koş ve `jump`.
  - **Sıkılmak:** Fare 60 sn kıpırdamadıysa `bored`. Fare 3 dk kıpırdamadıysa `lie_down` → `sleep`.
- **Kenar.** Yürürken zeminin ucuna (pencere köşesine) gelince ya geri döner (`turn`), ya ara sıra `edge_hang` ile köşede yatar (20-60 sn), ya da aşağı atlayıp `fall` ile düşer. `edge_hang`'de çapa pikseli pencerenin üst köşesine oturur: sağ köşede tilki sağa bakar, sol köşede aynalanır.
- **Tıklama** (basıp sürüklemeden bırakmak, tilkinin opak bir pikselinde):
  - Uyuyorsa `wake_up`.
  - Değilse çoğunlukla `petted`, ara sıra `happy`.
- **Tutma** (tilkinin opak bir pikselinde basılı tutup sürüklemek):
  - Tutulan yer kuyruksa `held_tail`, değilse `held_scruff`. Kuyruk, sağa bakan tilkide opak sınır kutusunun **soldaki ~%35'i** (ölçüldü: %32-40). Aynalıyken sağdaki %35'i.
  - Tutulurken karenin `anchor` pikseli imlecin altında kalır. Hafif bir gecikmeyle izlerse sallanma daha canlı durur (isteğe bağlı).
  - Bırakınca `fall`, yerçekimiyle düşer.
- **Düşme:** Yerçekimi ~2000 px/sn² (1×), en çok ~1500 px/sn. Tilkinin `ground` satırı altındaki bir zemine değdiği an `land` → `idle`. Atlama sırasında yükseliyorsa `jump`'ın son karesinde kalabilir; hız aşağı dönünce `fall`.
- **Pencereye zıplama:** Yeni bir pencere öne gelince (örneğin kullanıcı Safari'yi açtı ya da öne aldı), %50 olasılıkla tilki pencerenin altına yürür/koşar ve `jump` oynar. `liftoff_frame` (11) itibarıyla ~0.5 sn'lik bir yayla pencerenin üst kenarına uçar. İnişte `fall`, değince `land`. Sonra o pencerenin üstünde dolaşır.
- **Pencere takibi:** Tilki bir pencerenin üstündeyse o pencerenin kimliğini ve pencereye göre konumunu tut. Pencere taşınınca tilki onunla gider. Pencere kapanırsa, simge durumuna küçültülürse ya da başka bir masaüstüne giderse tilki `fall` ile düşer.
- **Koşu:** Uzak hedeflere (300 px'ten uzak) `run` ile gider, varınca `stop`. `stop`'un ilk ~9 karesinde hızı sıfıra indir.

## 5. Teknik öneriler (macOS)

- **Dil:** Swift + AppKit. Hafif olur ve başka uygulamaların pencere konumlarını okuyabilir. Godot, Electron gibi motorlar bu iş için ağır kalır, pencere listesine de zor erişir.
- **Pet penceresi:** Tilkinin karesi kadar, kenarlıksız, şeffaf bir `NSPanel` ya da `NSWindow`, tilkiyle birlikte ekranda hareket eder.
  - Ayarlar: `isOpaque = false`, `backgroundColor = .clear`, `hasShadow = false`.
  - Seviye ve davranış: `level = .floating` (ya da `.statusBar`), `collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenAuxiliary]`.
  - Dock'ta ve Cmd-Tab'da görünmesin: `LSUIElement = true`. Menü çubuğunda küçük bir simgeyle çıkış ve ayarlar sunulabilir.
- **Tıklamanın alta geçmesi:** Fare konumunu izle (`NSEvent.addGlobalMonitorForEvents(.mouseMoved)` ya da 60 Hz yoklama). İmleç tilkinin opak bir pikselindeyse `ignoresMouseEvents = false`, değilse `true`.
- **Çizim:** Bütün kareleri açılışta `CGImage` olarak yükle; animasyon başına önbellek de olur. Hepsi 1×'te yaklaşık 92 MB eder (878 × 180 × 146 × 4 bayt). İstersen yalnızca kullanılan animasyonları tut. `CALayer.contents` ile göster, `magnificationFilter = .nearest`. Kare zamanlaması 24 fps, fizik ve konum 60 Hz.
- **Pencere listesi:**
  - Çağrı: `CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)`.
  - Kullanılacak pencereler: `kCGWindowLayer == 0` olanlar, kendi uygulamanın pid'i hariç, çok küçükleri (< 150 px) eleyerek.
  - Konum `kCGWindowBounds`'tan alınır, 5-10 Hz yeterli. Bu koordinatlar sol üst kökenlidir; AppKit sol alt kökenli, çevirmeyi unutma.
  - Pencere **sınırlarını** okumak için Ekran Kaydı izni büyük ihtimalle gerekmez (başlıklar için gerekir). Bunu doğrulayıp kullanıcıya söyle.
  - Bir pencere başka bir pencerenin altında kalmışsa tilki yine de üstünde görünür. İstersen yalnızca üst kenarı açıkta olan pencereleri zemin say.
- **Dock / alt zemin:** `NSScreen.visibleFrame`'in alt kenarı Dock'un üstüdür (Dock alttaysa). Birden fazla ekranda her ekranın kendi alt zemini olur.
- **Hedef:** Boşta %1-2'nin altında işlemci.

## 6. Bilinen notlar

- `run` hızlıdır (245 px/sn). Hissi kötü olursa uygulama hızı biraz düşürebilir. O zaman ayaklar az kayar, ama bu kadar küçük bir sprite'ta fark edilmez.
- `held_*` kareleri 190 piksel yüksekliğindedir (tilki dikey sarkıyor). Çapa sayesinde konumlamak sorun olmaz.
- `desk`'in masası ve laptopu karenin içindedir. Tilki masaya göre yerinde durur.
- Aynalama ışığı da çevirir (sağ üstten gelmiş gibi olur). Bilerek kabul edildi.
- Aynı animasyonların 4 kat büyük, piksel olmayan (düz çizim) sürümü de var: 720 × 584, `ground` 513. Değerler 4 katı. Görsel tarafta duruyor, gerekirse istenebilir. Varsayılan: bu piksel sürüm.
