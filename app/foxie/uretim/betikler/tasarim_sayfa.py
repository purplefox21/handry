"""Tasarım sayfası: 5 tilki x 4 poz, etiketli. Kullanım: /usr/bin/python3 tasarim_sayfa.py (render'lar ornekler/tasarim/ içinde)."""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tasarimlar import TASARIMLAR

KOK = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "ornekler")
POZLAR = [("yuru", "Yandan yürüyor"), ("otur_bak", "Oturmuş, bize bakıyor"), ("uyu", "Kıvrılmış uyuyor"), ("sikil", "Sıkılmış")]
CW, CH, PAD, UST, SATIR_UST = 480, 380, 16, 70, 30


def yazi(boy):
    for yol in ("/System/Library/Fonts/Supplemental/Arial Unicode.ttf", "/System/Library/Fonts/Helvetica.ttc"):
        if os.path.exists(yol):
            return ImageFont.truetype(yol, boy)
    return ImageFont.load_default()


def main():
    adlar = list(TASARIMLAR)
    gen = PAD + len(POZLAR) * (CW + PAD)
    yuk = UST + len(adlar) * (SATIR_UST + CH + PAD) + PAD
    sh = Image.new("RGB", (gen, yuk), (247, 243, 238))
    d = ImageDraw.Draw(sh)
    f1, f2, f3 = yazi(28), yazi(20), yazi(16)
    d.text((PAD, 14), f"Foxie · {len(adlar)} tilki tasarımı", font=f1, fill=(40, 26, 30))
    for j, (_, baslik) in enumerate(POZLAR):
        d.text((PAD + j * (CW + PAD) + 6, 48), baslik, font=f3, fill=(120, 100, 96))
    for i, ad in enumerate(adlar):
        y = UST + i * (SATIR_UST + CH + PAD)
        d.text((PAD, y + 4), TASARIMLAR[ad]["ad"], font=f2, fill=(160, 70, 40))
        for j, (pz, _) in enumerate(POZLAR):
            im = Image.open(f"{KOK}/tasarim/{ad}_{pz}.png").resize((CW, CH), Image.LANCZOS)
            kart = Image.new("RGBA", (CW, CH), (238, 231, 222, 255))
            kart.alpha_composite(im)
            sh.paste(kart.convert("RGB"), (PAD + j * (CW + PAD), y + SATIR_UST))
    sh.save(f"{KOK}/tilki_tasarimlari.png")
    print("yazildi", sh.size)


if __name__ == "__main__":
    main()
