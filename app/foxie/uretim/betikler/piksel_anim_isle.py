"""piksel_anim.py'nin ham katmanlarını piksel art karelerine çevirir; GIF (3 kat), manifest, karşılaştırma sayfası.
Kullanım: /usr/bin/python3 piksel_anim_isle.py <ham> <cikti> [anim1,anim2]"""
import glob
import json
import math
import os
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tasarimlar  # noqa: E402,F401
import piksel  # noqa: E402
from anim_onizleme import ek_meta  # noqa: E402
from hareketler import ANIMLAR  # noqa: E402

ZEMIN = (239, 232, 222)
BUYUT = 3


def isle(ham, cikti, anim, grup, kare):
    A = ANIMLAR[anim]
    d = os.path.join(cikti, anim)
    os.makedirs(d, exist_ok=True)
    for eski in glob.glob(os.path.join(d, "*.png")):
        os.remove(eski)
    ims = []
    for i, npz in enumerate(sorted(glob.glob(os.path.join(ham, anim, "*.npz")))):
        img = piksel.kare(npz, "T3", grup)
        im = Image.fromarray(img, "RGBA")
        im.save(os.path.join(d, f"{i + 1:04d}.png"), optimize=True)
        ims.append(im)
    onz = os.path.join(cikti, "onizleme")
    os.makedirs(onz, exist_ok=True)
    buyuk = []
    for im in ims:
        b = Image.new("RGBA", im.size, ZEMIN + (255,))
        b.alpha_composite(im)
        buyuk.append(b.resize((im.width * BUYUT, im.height * BUYUT), Image.NEAREST).convert("RGB"))
    buyuk[0].save(os.path.join(onz, f"{anim}.gif"), save_all=True, append_images=buyuk[1:], duration=int(round(1000 / A["fps"])), loop=0)
    return ims


def main(ham, cikti, animler):
    grup = {int(k): v for k, v in json.load(open(os.path.join(ham, "parcalar.json"))).items()}
    kare = json.load(open(os.path.join(ham, "kare.json")))
    kaynak_k = json.load(open(os.path.join(os.path.dirname(cikti.rstrip("/")), "T3", "kamera.json")))
    myol = os.path.join(cikti, "manifest.json")
    m = json.load(open(myol)) if os.path.exists(myol) else {}
    m.update({"frame": [kare["genislik"], kare["yukseklik"]], "ground": round(kare["zemin_satir"]), "facing": "right"})
    for anim in animler:
        ims = isle(ham, cikti, anim, grup, kare)
        A = ANIMLAR[anim]
        k = {"fps": A["fps"], "loop": A["dongu"], "frames": len(ims)}
        if "hiz" in A:
            k["speed"] = round(A["hiz"] * math.cos(math.radians(kaynak_k["yuz"])) * kaynak_k["ppu"] * kare["genislik"] / kaynak_k["genislik"], 1)
        if A.get("sonra"):
            k["next"] = A["sonra"]
        ek_meta(k, A, anim, os.path.join(os.path.dirname(cikti.rstrip("/")), "T3"), ims[0].width, ims[0].height, kare["genislik"], kare["yukseklik"])
        if k.get("ground", 0) is None:
            k.pop("ground")
        m.setdefault("animations", {})[anim] = k
        print("piksel", anim, len(ims))
    json.dump(m, open(myol, "w"), indent=2)


if __name__ == "__main__":
    ham, cikti = sys.argv[1], sys.argv[2]
    animler = sys.argv[3].split(",") if len(sys.argv) > 3 else [a for a in ANIMLAR if os.path.isdir(os.path.join(ham, a))]
    main(ham, cikti, animler)
