"""Animasyon önizlemesi ve manifest: GIF (zeminli), MP4, kare şeridi; manifest.json'a animasyonu ekler.
Kullanım: /usr/bin/python3 anim_onizleme.py <cikti_dizini> <anim>"""
import glob
import json
import math
import os
import subprocess
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from hareketler import ANIMLAR  # noqa: E402

ZEMIN = (239, 232, 222)


def main(cikti, anim):
    kareler = sorted(glob.glob(os.path.join(cikti, anim, "*.png")))
    A = ANIMLAR[anim]
    k = json.load(open(os.path.join(cikti, "kamera.json")))
    kw, kh = Image.open(kareler[0]).size
    ims = []
    for p in kareler:
        im = Image.open(p).convert("RGBA")
        bg = Image.new("RGBA", im.size, ZEMIN + (255,))
        bg.alpha_composite(im)
        ims.append(bg.convert("RGB"))
    onz = os.path.join(cikti, "onizleme")
    os.makedirs(onz, exist_ok=True)
    sure = int(round(1000 / A["fps"]))
    ims[0].save(os.path.join(onz, f"{anim}.gif"), save_all=True, append_images=ims[1:], duration=sure, loop=0, optimize=False, disposal=1)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(A["fps"]), "-i", os.path.join(cikti, anim, "%04d.png"),
                    "-vf", f"color=c=0x{ZEMIN[0]:02x}{ZEMIN[1]:02x}{ZEMIN[2]:02x}:s={kw}x{kh}[b];[b][0:v]overlay=shortest=1,format=yuv420p",
                    "-c:v", "libx264", "-crf", "16", os.path.join(onz, f"{anim}.mp4")], check=False)
    # kare şeridi: 8 kare
    secim = [ims[int(i * len(ims) / 8)] for i in range(8)]
    w, h = secim[0].size
    s = 0.5
    sh = Image.new("RGB", (int(w * s) * 4, int(h * s) * 2), ZEMIN)
    for i, im in enumerate(secim):
        sh.paste(im.resize((int(w * s), int(h * s)), Image.LANCZOS), ((i % 4) * int(w * s), (i // 4) * int(h * s)))
    sh.save(os.path.join(onz, f"{anim}_kareler.png"))
    # manifest
    myol = os.path.join(cikti, "manifest.json")
    m = json.load(open(myol)) if os.path.exists(myol) else {}
    m.update({"frame": [k["genislik"], k["yukseklik"]], "ground": k["zemin_satir"], "facing": "right"})
    kayit = {"fps": A["fps"], "loop": A["dongu"], "frames": len(kareler)}
    if "hiz" in A:   # ekranda saniyede kaç piksel (render çözünürlüğünde): ayak kaymasın
        kayit["speed"] = round(A["hiz"] * math.cos(math.radians(k["yuz"])) * k["ppu"], 1)
    if A.get("sonra"):
        kayit["next"] = A["sonra"]
    ek_meta(kayit, A, anim, cikti, kw, kh, k["genislik"], k["yukseklik"])
    if kayit.get("ground", 0) is None:
        kayit.pop("ground")
    m.setdefault("animations", {})[anim] = kayit
    json.dump(m, open(myol, "w"), indent=2)
    print("onizleme", onz, len(kareler), "kare", k["genislik"], "x", k["yukseklik"])


def ek_meta(kayit, A, anim, kaynak, kw, kh, W, H):
    """Kare boyutu farklıysa frame; çapa (tutma noktası / köşe) piksel olarak; kalkış karesi; dönüşten sonra aynala."""
    if (kw, kh) != (W, H):
        kayit["frame"] = [kw, kh]
        kayit["ground"] = None
    capa_yol = os.path.join(kaynak, "capa.json")
    if A.get("capa") and os.path.exists(capa_yol):
        c = json.load(open(capa_yol)).get(anim)
        if c:
            kayit["anchor"] = [round(c[0] * kw), round(c[1] * kh)]
            kayit["anchor_type"] = {"tutma": "grab", "kose": "edge_corner"}[A["capa"]]
    if A.get("kalkis"):
        kayit["liftoff_frame"] = A["kalkis"]
    if A.get("aynala"):
        kayit["mirror_after"] = True


def sayfa(cikti):
    """Bütün animasyonların GIF'lerini oynatan basit sayfa."""
    k = json.load(open(os.path.join(cikti, "kamera.json")))
    m = json.load(open(os.path.join(cikti, "manifest.json")))
    kart = []
    for ad, A in ANIMLAR.items():
        if ad not in m.get("animations", {}):
            continue
        bilgi = m["animations"][ad]
        ek = ("döngü" if bilgi["loop"] else "bir kez" + (f" → {bilgi['next']}" if bilgi.get("next") else "")) + \
            (f" · {bilgi['speed']} px/sn" if "speed" in bilgi else "")
        kart.append(f'<figure><img src="{ad}.gif" width="{k["genislik"] // 2}"><figcaption><b>{ad}</b> · {bilgi["frames"]} kare · {ek}</figcaption></figure>')
    html = ("<!doctype html><meta charset=utf-8><title>Foxie animasyonları</title><style>body{font:14px -apple-system,sans-serif;background:#f6f2ec;"
            "margin:24px;color:#2a1a1e}main{display:flex;flex-wrap:wrap;gap:16px}figure{margin:0;background:#fff;border-radius:10px;padding:8px}"
            "img{display:block;border-radius:6px}figcaption{padding:6px 2px 0}</style><h1>Foxie · kızıl tilki animasyonları</h1><main>"
            + "".join(kart) + "</main>")
    open(os.path.join(cikti, "onizleme", "index.html"), "w").write(html)


if __name__ == "__main__":
    if len(sys.argv) > 2:
        for a_ in sys.argv[2].split(","):
            main(sys.argv[1], a_)
    else:
        for a_ in ANIMLAR:
            if os.path.isdir(os.path.join(sys.argv[1], a_)):
                main(sys.argv[1], a_)
    sayfa(sys.argv[1])
