# App Store bilgi kartı

JEVIS bu dosyadaki bilgilerle App Store Connect formlarını doldurur. Sadece bildiğin kısımları doldur; boş kalanları JEVIS sana sorar.
**Şifre yazma.** Şifreler `node cli.js secret add <isim>` ile Anahtar Zinciri'ne kaydedilir.

## Uygulama

- Uygulama adı:
- Uygulamanın kod klasörü (gizlilik taraması için):
- Alt başlık (en fazla 30 karakter):
- Ana kategori:
- İkincil kategori (isteğe bağlı):

## Fiyat ve bulunabilirlik

- Fiyat (ücretsiz / $ tutarı):
- Hangi ülkelerde satılsın (hepsi / liste):
- Uygulama içi satın alma ya da abonelik var mı?

## Yaş sınırı anketi (düz cümlelerle cevapla, JEVIS forma çevirir)

- Şiddet var mı? (yok / çizgi film tarzı / gerçekçi)
- Kan, korku veya korkutucu içerik?
- Küfür veya kaba mizah?
- Cinsellik veya çıplaklık?
- Alkol, sigara, uyuşturucu?
- Kumar ya da kumar benzeri oyun (sanal para dahil)?
- Kullanıcılar birbirine mesaj atabiliyor ya da içerik paylaşabiliyor mu?
- Uygulamanın içinde serbest web tarayıcısı var mı?
- Reklam gösteriliyor mu?
- Sağlık, tıbbi bilgi veya sağlıklı yaşam konuları?
- Yarışma, çekiliş?

## Gizlilik (App Privacy)

- Kullanıcı hesabı / giriş var mı? (e-posta, Google, Apple ile giriş…)
- Sunucuya hangi veriler gidiyor? (kod taraması bunu göremez)
- Gizlilik politikası adresi (URL):

> Koddaki SDK'lardan çıkan taslak için: `node appstore/privacy-scan.js <kod-klasörü>`

## Sürüm bilgileri

- Açıklama:
- Anahtar kelimeler (virgülle, en fazla 100 karakter):
- Destek adresi (URL):
- Pazarlama adresi (URL, isteğe bağlı):
- Telif (ör. 2026 Adın Soyadın):
- Ekran görüntüleri klasörü:
- Bu sürümde yenilikler:

## İnceleme ekibi için

- İnceleme için giriş gerekli mi? (gerekiyorsa demo hesabı Anahtar Zinciri'ne: `node cli.js secret add appstore-demo`)
- İletişim adı, telefon, e-posta:
- İnceleme notu:
- Yayınlama: elle mi, onaylanınca otomatik mi?
