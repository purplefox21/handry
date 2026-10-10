"""Ham render katmanlarından (npz) 64x64 piksel kare: blok indirme, palete oturtma, bantlı gölge, iç çizgiler, kontur.
Sistem Python'u (numpy + PIL). Kullanım: piksel.kare(npz_yolu, "B") -> (64, 64, 4) uint8."""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from stiller import ESYA_RAMPALARI, SINIFLAR, STILLER  # noqa: E402

ADLAR = {v: k for k, v in SINIFLAR.items()}
BAYER4 = (np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]) + 0.5) / 16.0


def hexrgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.uint8)


def indir(d, f=6):
    """Blok başına: opak mı, sınıf, parça, derinlik, ışık."""
    sinif, parca, derin, isik, alfa = d["sinif"], d["parca"], d["derin"], d["isik"], d["alfa"]
    h = sinif.shape[0] // f
    w = sinif.shape[1] // f

    def bloklar(a):
        return a.reshape(h, f, w, f).transpose(0, 2, 1, 3).reshape(h, w, f * f)

    A = bloklar(alfa)
    S = bloklar(sinif)
    P = bloklar(parca)
    D = bloklar(derin).astype(np.float32)
    L = bloklar(isik).astype(np.float32) / 100.0
    kapsama = A.mean(axis=2)
    opak = kapsama >= 0.40
    # sınıf: opak örnekler arasında çoğunluk
    sinif_out = np.zeros((h, w), np.uint8)
    en = np.zeros((h, w), np.int32)
    for k in np.unique(S[A]):
        c = ((S == k) & A).sum(axis=2)
        yeni = c > en
        sinif_out[yeni] = k
        en[yeni] = c[yeni]
    # parça: seçilen sınıf içinde çoğunluk
    parca_out = np.zeros((h, w), np.uint8)
    en = np.zeros((h, w), np.int32)
    for k in np.unique(P[A]):
        c = ((P == k) & A & (S == sinif_out[:, :, None])).sum(axis=2)
        yeni = c > en
        parca_out[yeni] = k
        en[yeni] = c[yeni]
    uyum = A & (P == parca_out[:, :, None])
    sayi = np.maximum(uyum.sum(axis=2), 1)
    derin_out = (D * uyum).sum(axis=2) / sayi
    isik_out = (L * uyum).sum(axis=2) / sayi
    sinif_out[~opak] = 0
    parca_out[~opak] = 0
    return opak, sinif_out, parca_out, derin_out, isik_out


def komsu(a, dy, dx, dolgu):
    """a[y+dy, x+dx] (kenar dışı = dolgu)."""
    h, w = a.shape[:2]
    cikti = np.full_like(a, dolgu)
    y0, y1 = max(0, -dy), min(h, h - dy)
    x0, x1 = max(0, -dx), min(w, w - dx)
    cikti[y0:y1, x0:x1] = a[y0 + dy:y1 + dy, x0 + dx:x1 + dx]
    return cikti


def bantla(t, n, titrek):
    t = np.clip(t, 0, 0.999)
    if titrek > 0:
        yy, xx = np.mgrid[0:t.shape[0], 0:t.shape[1]]
        t = t + (BAYER4[yy % 4, xx % 4] - 0.5) * titrek
    return np.clip((t * n).astype(int), 0, n - 1)


def kare(npz_yolu, stil, grup_tablosu=None, f=6, ayar=None):
    st = STILLER[stil]
    ayar = ayar or {}
    d = np.load(npz_yolu)
    opak, sinif, parca, derin, isik = indir(d, f)
    h, w = opak.shape
    img = np.zeros((h, w, 4), np.uint8)
    ramp = {k: [hexrgb(x) for x in v] for k, v in {**ESYA_RAMPALARI, **st["rampalar"]}.items()}
    lo, hi = ayar.get("lo", 0.18), ayar.get("hi", 1.10)
    t = (isik - lo) / (hi - lo)
    t = np.clip(t, 0, 1) ** ayar.get("gama", 1.15)
    titrek = st["titrek"]
    for k, ad in ADLAR.items():
        m = sinif == k
        if not m.any() or ad not in ramp:
            continue
        r = ramp[ad]
        idx = bantla(t, len(r), titrek if ad in ("kurk", "krem") else 0.0)
        for i, c in enumerate(r):
            mm = m & (idx == i)
            img[mm, :3] = c
    img[opak, 3] = 255

    # iç çizgiler: komşu başka gruptan ve daha yakınsa bu piksel koyulaşır
    grup = grup_tablosu
    if grup is not None and st["ic_cizgi"] > 0:
        g = np.zeros_like(parca)
        for p, gi in grup.items():
            g[parca == p] = gi
        cizgi = np.zeros((h, w), bool)
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            ng = komsu(g, dy, dx, 0)
            nd = komsu(derin, dy, dx, 255.0)
            no = komsu(opak, dy, dx, False)
            cizgi |= opak & no & (ng != g) & (nd < derin - 2.5)
        for k, ad in ADLAR.items():
            if ad in ("goz", "burun", "agiz", "dil") or ad not in ramp:
                continue
            mm = cizgi & (sinif == k)
            img[mm, :3] = ramp[ad][0]

    # göz parlaması
    if "goz" in ramp and st.get("oto_goz_isik", True):
        gm = (sinif == SINIFLAR["goz"])
        goz_isik = hexrgb(st["goz_isik"])
        gorulen = np.zeros_like(gm)
        for y in range(h):
            for x in range(w):
                if gm[y, x] and not gorulen[y, x]:
                    yigin, blob = [(y, x)], []
                    gorulen[y, x] = True
                    while yigin:
                        cy, cx = yigin.pop()
                        blob.append((cy, cx))
                        for ny, nx in ((cy + 1, cx), (cy - 1, cx), (cy, cx + 1), (cy, cx - 1)):
                            if 0 <= ny < h and 0 <= nx < w and gm[ny, nx] and not gorulen[ny, nx]:
                                gorulen[ny, nx] = True
                                yigin.append((ny, nx))
                    if len(blob) >= 4:
                        ys_ = [q[0] for q in blob]
                        xs_ = [q[1] for q in blob]
                        ust = min(ys_)
                        by = ust
                        bx = min(q[1] for q in blob if q[0] == ust)
                        img[by, bx, :3] = goz_isik

    # kenar ışığı (kenar_isik): sağ kenarlar
    if st["kenar_isik"]:
        sag_bos = ~komsu(opak, 0, 1, False)
        rim = opak & sag_bos & np.isin(sinif, [SINIFLAR["kurk"], SINIFLAR["krem"]])
        img[rim, :3] = hexrgb(st["kenar_isik"])

    # kontur
    kontur = np.zeros((h, w), bool)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dy == 0 and dx == 0:
                continue
            if (dy != 0 and dx != 0) and not ayar.get("kontur8", False):
                continue
            kontur |= komsu(opak, dy, dx, False)
    kontur &= ~opak
    img[kontur, :3] = hexrgb(st["kontur"])
    img[kontur, 3] = 255
    return img


def sinirlar(img):
    ys, xs = np.where(img[..., 3] > 0)
    return ys.min(), ys.max(), xs.min(), xs.max()
