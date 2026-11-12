# Handry: büyük fikirler

Şimdilik yapılmayacak, unutulmasın diye burada. Sıra ve kararlar [PLAN.md](../PLAN.md)'de.

## Kamerayla kullanmak: göz, el, ses

Bilgisayara dokunmadan: kamera gözü ve eli izler, ses ne yapılacağını söyler.

- **Göz:** Ekranın neresine bakıldığını tahmin eder (önce kalibrasyon). Okurken kaydırma: göz sayfanın altına inince yavaşça aşağı. "Şunu aç": baktığım bölgedeki adayları ekranda gösterir, "bunu mu?" diye sorar, evet deyince tıklar.
- **Parmak:** Ekrana uzatılan parmağın neye denk geldiğini gözle birlikte tahmin eder (parmağın açısı + gözün baktığı yer). Tek kamera derinliği bilmediği için ikisi birlikte daha iyi sonuç verir.
- **Ses:** "Bu ne?", "dur", "şunu aç", "biraz döndür", "360 derece döndür".

## Bağlama göre hareketler

Belli başlı el hareketleri var, ama her biri ekrandaki programa ve duruma göre başka iş yapar. Ne yapacağını kullanıcı söyler, Handry tasarlar ve o uygulama için hatırlar.

- Çimdikle tutup çekmek: bir yerde sürükleme, video oynatıcıda ileri sarma.
- Elini küre gibi tutup çevirmek: Blender'da görünümü döndürme.
- Spotify açıkken bir hareket: çal/durdur.
- Safari'de parmakla yukarı aşağı: kaydırma; açık avuç: dur.
- Bir gün yeni bir ekranda "bunu yapınca şu olsun" denir, Handry ona göre ekler.

## AR ayna

Ekranda kendimizi görürüz. Yanımıza bir toz küresi (parçacıklardan bir küre) konur; elimizi oraya götürünce bir şey olur. Bir şeyi 3B nesne olarak "atarız", elimizle tutup döndürürüz, onun üzerinden bir şey anlatırız.

## Sıra (kullanıcının önerisi, 2026-11-08)

1. Göz kalibrasyonu ve ekranda baktığın yerin saydam izi: gerçekten anlıyor mu, görerek denenir. (2026-11-08: MediaPipe ile denendi, iyi çalışmadı. 2026-11-09: karar Beam Eye Tracker, ücretli olduğu için sonra. 2026-11-12: kendi sürümümüz koddan kaldırıldı; eski hali git geçmişinde.)
2. Ses ile birleştirmek.
3. El hareketleri. (2026-11-09: ilk hali yapıldı, menü › El Hareketleri; MediaPipe Gesture Recognizer: ☝️ imleç, 🤏 tıklama/sürükleme, ✌️ kaydırma.)
4. Bağlama göre hareket öğretme.
5. AR ayna.

## Teknik notlar

- Sıfırdan yazılmaz, hazır parçalar kullanılır:
  - **MediaPipe** (Google, Apache-2.0): yüz ağı ve iris noktaları, el iskeleti (21 nokta). Tarayıcıda (WebAssembly) ve Python'da çalışır, internete bir şey göndermez.
  - **Apple Vision:** el pozu (21 eklem), yüz noktaları ve göz bebekleri; Mac'in kendisinde, ek paket yok.
  - **Beam Eye Tracker** (Eyeware, ücretli, tek seferlik): yayıncıların kullandığı web kamerası göz takibi, 2026'dan beri macOS'ta, SDK'sı var.
  - **WebGazer.js** ve **EyeGestures:** GPL-3.0 lisanslı; Handry'nin lisansıyla (PolyForm Shield) birlikte dağıtılamaz.
- Web kamerasıyla gerçekçi hedef: kalibrasyonla yaklaşık 1-1,5 derece (ekranda 1-2 cm kadar); kenarlarda daha kötü, baş oynadıkça bozulur. Düğme seçmeye yeter, menü maddesine yetmez; bu yüzden "bunu mu?" diye sormak.
- Gizlilik: kamera görüntüsü Mac'te kalır, kaydedilmez. Claude'a sadece "bu ne?" denince ekran görüntüsü gider (kalemdeki gibi). Kamera açıkken yeşil ışık yanar; aç/kapa tek düğme.
