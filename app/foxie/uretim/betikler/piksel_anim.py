"""Animasyonların piksel art sürümü için ham katmanlar (sınıf, parça, derinlik, ışık) -> npz. Düz sürümün kamerasıyla, K kat küçük.
Blender: Blender -b --factory-startup --python piksel_anim.py -- '{"tasarim": "T3", "kaynak": ".../animasyon/T3", "ham": "/scratch/pham", "bolen": 4}'
"""
import json
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tasarimlar  # noqa: E402,F401
import tilki_model as tm  # noqa: E402
from animasyon import _t, kamera_kur, kamera_uzat  # noqa: E402
from hareketler import ANIMLAR  # noqa: E402
from stiller import STILLER  # noqa: E402


def ana():
    arg = json.loads(sys.argv[sys.argv.index("--") + 1])
    ad, ham, bolen = arg["tasarim"], arg["ham"], arg.get("bolen", 4)
    animler = arg.get("animler") or list(ANIMLAR)
    k = json.load(open(os.path.join(arg["kaynak"], "kamera.json")))
    W, H = k["genislik"] // bolen, k["yukseklik"] // bolen
    SS = tm.SS
    tm.sahne_kur()
    tas = STILLER[ad]
    t = tm.Tilki(ad)
    tm.isik_kur()
    k2 = dict(k, genislik=W * SS, yukseklik=H * SS, ppu=k["ppu"] / bolen * SS)
    kamera_kur(k2)
    t.kamera_k = k2
    beyaz, parca_grup = tm.malzemeler(t, 8.0)
    gruplar = sorted(set(parca_grup.values()))
    os.makedirs(ham, exist_ok=True)
    json.dump({str(k_): gruplar.index(g) + 1 for k_, g in parca_grup.items()}, open(os.path.join(ham, "parcalar.json"), "w"))
    json.dump({"genislik": W, "yukseklik": H, "zemin_satir": k["zemin_satir"] / bolen}, open(os.path.join(ham, "kare.json"), "w"))
    for anim in animler:
        A = ANIMLAR[anim]
        ka = kamera_uzat(k2, A.get("ust_ek", 0) // bolen * SS)
        kamera_kur(ka)
        t.kamera_k = ka
        os.makedirs(os.path.join(ham, anim), exist_ok=True)
        for f in range(A["kare"]):
            p = A["fn"](_t(A, f), t)
            p["govde_yaw"] = tas["yaw"] - k["yuz"] + p.get("ek_yaw", 0.0)
            t.poz_uygula(p)
            tm.kare_render(t, os.path.join(ham, anim), f"{f + 1:04d}", beyaz)
        print("bitti", anim, flush=True)


if __name__ == "__main__":
    ana()
