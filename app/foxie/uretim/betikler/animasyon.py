"""Bir tasarımın bir animasyonunu kare kare render eder (şeffaf PNG, zemin ve gölge yok, sabit kamera).
Blender: Blender -b --factory-startup --python animasyon.py -- '{"tasarim": "T3", "anim": "idle", "cikti": "/.../foxie/animasyon/T3"}'
Kamera bir kez hesaplanır (oturma, yürüme, koşu, yatma pozlarının hepsi sığar) ve cikti/kamera.json'a yazılır; sonraki animasyonlar onu kullanır.
"""
import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tasarim_render as tr  # noqa: E402  (sahne, malzemeler, ışık)
from hareketler import ANIMLAR  # noqa: E402
from stiller import STILLER  # noqa: E402
from tilki_model import Tilki  # noqa: E402
from tilki_poz import poz_ver  # noqa: E402

R = math.radians
YUZ = 20          # tilki sağa bakar, 20 derece bize dönük
EGIM = 10         # kamera 10 derece yukarıdan
GENISLIK = 720    # piksel
KADRAJ = ["otur", "yuru", "kos", "sikil", "uyu", "otur_bak"]
PAY = 0.05


def _ekran(t, egim):
    p = R(egim)
    yukari = np.array([0, math.sin(p), math.cos(p)])
    v = t.dunya_koseler()
    return v[:, 0], v @ yukari


def _t(A, f):
    n = A["kare"]
    return f / n if A["dongu"] else f / max(n - 1, 1)


def kamera_hesapla(t, tas):
    """Bütün animasyonların (her 3. kare ve son kare) hepsini içine alan sabit kadraj."""
    x0 = y0 = 1e9
    x1 = y1 = -1e9
    for ad_, A in ANIMLAR.items():
        n = A["kare"]
        for f in sorted(set(list(range(0, n, 3)) + [n - 1])):
            p = A["fn"](_t(A, f), t)
            p["govde_yaw"] = tas["yaw"] - YUZ
            t.poz_uygula(p)
            sx, sy = _ekran(t, EGIM)
            x0, x1 = min(x0, sx.min()), max(x1, sx.max())
            y0, y1 = min(y0, sy.min()), max(y1, sy.max())
    ppu = GENISLIK * (1 - 2 * PAY) / (x1 - x0)
    yuk = int(math.ceil((y1 - y0) * ppu / (1 - 2 * PAY) / 8.0) * 8)
    cx, cy = 0.5 * (x0 + x1), 0.5 * (y0 + y1)
    zemin_satir = int(round(yuk / 2.0 + cy * ppu))
    return dict(yuz=YUZ, egim=EGIM, ppu=ppu, cx=cx, cy=cy, genislik=GENISLIK, yukseklik=yuk, zemin_satir=zemin_satir)


def kamera_uzat(k, ust_ek):
    """Aynı ölçek ve genişlik, kare yukarı doğru ust_ek piksel uzar (dikey asılı pozlar için)."""
    if not ust_ek:
        return k
    return dict(k, yukseklik=k["yukseklik"] + ust_ek, cy=k["cy"] + ust_ek / 2.0 / k["ppu"], zemin_satir=k["zemin_satir"] + ust_ek)


def kamera_kur(k):
    for o in [o for o in bpy.data.objects if o.type == "CAMERA"]:
        bpy.data.objects.remove(o)
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = k["genislik"], k["yukseklik"]
    cam = bpy.data.cameras.new("kamera")
    cam.type = "ORTHO"
    cam.sensor_fit = "HORIZONTAL"
    cam.ortho_scale = k["genislik"] / k["ppu"]
    cam.clip_end = 40
    ob = bpy.data.objects.new("kamera", cam)
    sc.collection.objects.link(ob)
    sc.camera = ob
    p = R(k["egim"])
    ileri = Vector((0, math.cos(p), -math.sin(p)))
    yukari = Vector((0, math.sin(p), math.cos(p)))
    hedef = Vector((k["cx"], 0, 0)) + yukari * k["cy"]
    ob.location = hedef - ileri * 8.0
    ob.rotation_euler = ileri.to_track_quat("-Z", "Y").to_euler()


def ana():
    arg = json.loads(sys.argv[sys.argv.index("--") + 1])
    ad, cikti = arg["tasarim"], arg["cikti"]
    animler = arg.get("animler") or list(ANIMLAR)
    sc = tr.sahne()
    sc.eevee.taa_render_samples = 16
    tas = STILLER[ad]
    t = Tilki(ad)
    tr.boya(t, tas)
    tr.isiklar()
    kyol = os.path.join(cikti, "kamera.json")
    os.makedirs(cikti, exist_ok=True)
    if os.path.exists(kyol) and not arg.get("kamera_yeniden"):
        k = json.load(open(kyol))
    else:
        k = kamera_hesapla(t, tas)
        json.dump(k, open(kyol, "w"), indent=1)
        print("kamera", k, flush=True)
    kamera_kur(k)
    t.kamera_k = k
    capa_yol = os.path.join(cikti, "capa.json")
    capalar = json.load(open(capa_yol)) if os.path.exists(capa_yol) else {}
    for anim in animler:
        A = ANIMLAR[anim]
        ka = kamera_uzat(k, A.get("ust_ek", 0))
        kamera_kur(ka)
        t.kamera_k = ka
        d = os.path.join(cikti, anim)
        os.makedirs(d, exist_ok=True)
        for eski in os.listdir(d):
            os.remove(os.path.join(d, eski))
        for f in range(A["kare"]):
            p = A["fn"](_t(A, f), t)
            p["govde_yaw"] = tas["yaw"] - k["yuz"] + p.get("ek_yaw", 0.0)
            t.poz_uygula(p)
            if f == 0 and p.get("capa"):
                capalar[anim] = list(p.get("capa_hedef") or t.capa_orani(p["capa"]))
                json.dump(capalar, open(capa_yol, "w"), indent=1)
            sc.render.filepath = os.path.join(d, f"{f + 1:04d}.png")
            bpy.ops.render.render(write_still=True)
        print("bitti", anim, A["kare"], flush=True)


if __name__ == "__main__":
    ana()
