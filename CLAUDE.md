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

## Çalıştırma

- `npm start` → http://localhost:3000 (Karar Laboratuvarı + macOS Kontrol Merkezi)
- `node demo.js` → destek bileti yönlendirme örneği
- `node macos-cli.js "komut"` → terminalden macOS komutu
