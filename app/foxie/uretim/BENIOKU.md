# Foxie

> Bu klasör (2026-10-10): `foxie.zip`'ten (1 Ekim'de alınmış kopya) çıkarıldı; hattın bir kısmı (`tilki_model.py`, `tilki_poz.py`, `hareketler.py`, `tasarimlar.py`, `stiller.py`) ayrıca `~/Desktop/kaptan-oyunu/blender/betikler/tilki/` altında da var. `teslim/foxie_pet.zip` buraya alınmadı: içindeki sprite'lar ve tarif `app/foxie/sprites` ve `app/foxie/TARIF.md` ile aynı. Yollar (`<foxie>/…`) eski klasöre göre yazılı.

Masaüstü pet'i ve asistan için kızıl tilki: Blender'da koddan kurulan 3D model, animasyonlar ve piksel art sprite'lar.

- `teslim/foxie_pet.zip`: uygulamayı yazacak olana verilen paket (21 animasyon, piksel art 180×146, manifest, `UYGULAMA_TARIFI.md`, önizlemeler).
- `ornekler/tilki_tasarimlari.png`: 6 tasarım (seçilen: 3 · Gerçekçi kızıl tilki, `T3`).
- `Foxie Sprite Brief.html`: ilk brief.
- `betikler/`: üretim hattı. Blender: `/Applications/Blender.app/Contents/MacOS/Blender`; diğerleri `/usr/bin/python3` (numpy + PIL).
  - `tilki_model.py` model ve iskelet, `tasarimlar.py` tasarımlar, `tilki_poz.py` pozlar, `hareketler.py` animasyonlar.
  - Düz render: `Blender -b --factory-startup --python animasyon.py -- '{"tasarim": "T3", "cikti": "<foxie>/animasyon/T3"}'` (+ `"animler": [...]`)
  - Piksel: `Blender -b --factory-startup --python piksel_anim.py -- '{"tasarim": "T3", "kaynak": "<foxie>/animasyon/T3", "ham": "<gecici>"}'`,
    sonra `python3 piksel_anim_isle.py <gecici> <foxie>/animasyon/T3_piksel`, sonra `python3 paketle.py` (zip'i yeniler; önce `teslim/foxie_pet.zip`'i aç, `UYGULAMA_TARIFI.md` oradan korunur).
  - `animasyon/T3/kamera.json` ve `capa.json` sabit kamera ve tutma noktaları: silme, yoksa yeni animasyonlar eskileriyle aynı boyda çıkmaz.
  - Tasarım sayfası: `sh tas_serit.sh T1 T2 T3 T4 T5 T6`, render'ları `ornekler/tasarim/`'e kopyala, `python3 tasarim_sayfa.py`.
