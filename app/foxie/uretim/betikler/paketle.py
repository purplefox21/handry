"""Teslim paketini kurar: piksel sprite'lar (animasyon/T3_piksel) -> teslim/foxie_pet/sprites, GIF önizlemeler, index.html, zip.
UYGULAMA_TARIFI.md elle yazılır ve korunur. Kullanım: /usr/bin/python3 paketle.py"""
import glob
import json
import os
import shutil
import subprocess

KOK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # foxie/
SIRA = ["idle", "walk", "run", "stop", "turn", "ears_up", "listen", "desk", "petted", "happy", "sad", "bored", "lie_down", "sleep", "wake_up",
        "jump", "fall", "land", "held_tail", "held_scruff", "edge_hang"]


def main():
    src = f"{KOK}/animasyon/T3_piksel"
    dst = f"{KOK}/teslim/foxie_pet"
    for d in ("sprites", "onizleme"):
        shutil.rmtree(f"{dst}/{d}", ignore_errors=True)
        os.makedirs(f"{dst}/{d}")
    m = json.load(open(f"{src}/manifest.json"))
    assert set(SIRA) == set(m["animations"]), set(m["animations"]) ^ set(SIRA)
    m["animations"] = {k: m["animations"][k] for k in SIRA}
    for a in SIRA:
        shutil.copytree(f"{src}/{a}", f"{dst}/sprites/{a}")
        shutil.copy(f"{src}/onizleme/{a}.gif", f"{dst}/onizleme/{a}.gif")
        assert len(glob.glob(f"{dst}/sprites/{a}/*.png")) == m["animations"][a]["frames"], a
    m["scale_note"] = "Tüm değerler 1x içindir (piksel). Ekranda N kat büyütülürse speed, anchor ve ground da N ile çarpılır."
    json.dump(m, open(f"{dst}/sprites/manifest.json", "w"), indent=2, ensure_ascii=False)
    W, H = m["frame"]
    kart = []
    for a in SIRA:
        b = m["animations"][a]
        fw = b.get("frame", [W, H])[0]
        ek = ("döngü" if b["loop"] else "bir kez" + (f" → {b['next']}" if b.get("next") else "")) + \
            (f" · {b['speed']} px/sn" if "speed" in b else "") + (f" · çapa {b['anchor']}" if "anchor" in b else "")
        kart.append(f'<figure><img src="{a}.gif" width="{fw * 3}" style="image-rendering:pixelated"><figcaption><b>{a}</b> · {b["frames"]} kare · {ek}'
                    '</figcaption></figure>')
    html = ("<!doctype html><meta charset=utf-8><title>Foxie pet animasyonları</title><style>body{font:14px -apple-system,sans-serif;"
            "background:#f6f2ec;margin:24px;color:#2a1a1e}main{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start}figure{margin:0;"
            "background:#fff;border-radius:10px;padding:8px}img{display:block;border-radius:6px}figcaption{padding:6px 2px 0;max-width:540px}</style>"
            f"<h1>Foxie pet · {len(SIRA)} animasyon ({W}×{H} piksel, burada 3 kat)</h1><main>" + "".join(kart) + "</main>")
    open(f"{dst}/onizleme/index.html", "w").write(html)
    z = f"{KOK}/teslim/foxie_pet.zip"
    if os.path.exists(z):
        os.remove(z)
    subprocess.run(["zip", "-qr", "foxie_pet.zip", "foxie_pet", "-x", "*.DS_Store"], cwd=f"{KOK}/teslim", check=True)
    print("paket", dst, "ve", z)


if __name__ == "__main__":
    main()
