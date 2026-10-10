"""Foxie pozları: eklem açıları dünya pitch'i olarak (derece, + = ekranda saat yönü), yaw/roll yerel.
poz_ver(ad, t, tilki) -> sözlük (tilki_model.Tilki.poz_uygula'ya)."""
import math


def _sin(x):
    return math.sin(2 * math.pi * x)


def _cos(x):
    return math.cos(2 * math.pi * x)


def kuyruk_egrisi(a, yaw, ilk_pitch, bitis_pitch, yaw_toplam, n=10):
    """Kuyruk zinciri: pitch ilk'ten bitis'e, toplam yaw dağıtılır."""
    for i in range(n):
        f = i / (n - 1)
        a[f"kuyruk_{i}"] = ilk_pitch + (bitis_pitch - ilk_pitch) * f
        yaw[f"kuyruk_{i}"] = yaw_toplam / n


def otur(t, tilki):
    o = tilki.o
    a = {"kalca": -54, "bel": -62, "gogus": -70, "boyun": -36, "kafa": 4,
         "on_sag_om": 2, "on_sol_om": 2, "on_sag_dirsek": 0, "on_sol_dirsek": 0, "on_sag_bilek": 0, "on_sol_bilek": 0,
         "arka_sag_kalca": -68, "arka_sol_kalca": -66, "arka_sag_diz": 38, "arka_sol_diz": 40,
         "arka_sag_topuk": -86, "arka_sol_topuk": -86, "arka_sag_pati": -86, "arka_sol_pati": -86,
         "kulak_sag": -4, "kulak_sol": -4, "cene": 4}
    yaw = {"kafa": -10}
    roll = {"kulak_sag": 5, "kulak_sol": -5}
    # kuyruk: arkaya uzanır, ucu yukarı kıvrılır (S)
    for i in range(10):
        f = i / 9.0
        a[f"kuyruk_{i}"] = 2 + 58 * f ** 1.5 + (6 if i == 0 else 0)
        yaw[f"kuyruk_{i}"] = 4 if i < 6 else 2
    return {"a": a, "yaw": yaw, "roll": roll, "yer": "tum", "ik_on": {"sag": 0.035, "sol": 0.015}, "ik_govde": True}


def kos(t, ttilki=None):
    raise NotImplementedError


def kos_uzanis(t, tilki):
    """Dörtnala uzanış anı (havada): ön bacaklar ileri, arka bacaklar geri, kuyruk geride akar."""
    a = {"kalca": -8, "bel": -4, "gogus": -2, "boyun": -10, "kafa": 8,
         "on_sag_om": -64, "on_sag_dirsek": -36, "on_sag_bilek": -12,
         "on_sol_om": -52, "on_sol_dirsek": -26, "on_sol_bilek": -4,
         "arka_sag_kalca": 52, "arka_sag_diz": 74, "arka_sag_topuk": 52, "arka_sag_pati": 36,
         "arka_sol_kalca": 40, "arka_sol_diz": 64, "arka_sol_topuk": 44, "arka_sol_pati": 28,
         "kulak_sag": -58, "kulak_sol": -58, "cene": 10}
    yaw = {"kafa": -6}
    roll = {"kulak_sag": 4, "kulak_sol": -4}
    for i in range(10):
        a[f"kuyruk_{i}"] = 10 + 3.0 * i
        yaw[f"kuyruk_{i}"] = 2.0 * math.sin(i * 0.7)
    return {"a": a, "yaw": yaw, "roll": roll, "yer": "pati", "yukselt": 0.03}


def _kuyruk_akar(a, yaw, taban, artis, dalga=0.0, faz=0.0):
    for i in range(10):
        a[f"kuyruk_{i}"] = taban + artis * i
        yaw[f"kuyruk_{i}"] = dalga * math.sin(i * 0.7 + faz)


def iki_ayak(t, tilki):
    """Şaşkın iki ayaklı duruş: dik gövde, bir kol selam verir, dil dışarıda, bir kulak sarkık."""
    a = {"kalca": -78, "bel": -84, "gogus": -86, "boyun": -52, "kafa": 4,
         "on_sag_om": -6, "on_sag_dirsek": -20, "on_sag_bilek": -10,
         "on_sol_om": -12, "on_sol_dirsek": -12, "on_sol_bilek": -12,
         "arka_sag_kalca": 8, "arka_sag_diz": -16, "arka_sag_topuk": 8, "arka_sag_pati": 0,
         "arka_sol_kalca": 6, "arka_sol_diz": -12, "arka_sol_topuk": 6, "arka_sol_pati": 0,
         "kulak_sag": -4, "kulak_sol": 14, "cene": 24}
    yaw = {"kafa": -6}
    roll = {"kulak_sag": 6, "kulak_sol": -52, "kafa": 8}
    yaw["on_sol_om"] = -145
    _kuyruk_akar(a, yaw, 6, 4.5, 3.0)
    return {"a": a, "yaw": yaw, "roll": roll, "yer": "tum", "esya": ["dil"]}


def yaz(t, tilki):
    """Ayakta, masadaki dizüstü bilgisayarda yazar."""
    a = {"kalca": -74, "bel": -80, "gogus": -78, "boyun": -46, "kafa": 8,
         "on_sag_om": -66, "on_sag_dirsek": -88, "on_sag_bilek": -2,
         "on_sol_om": -60, "on_sol_dirsek": -86, "on_sol_bilek": -4,
         "arka_sag_kalca": 6, "arka_sag_diz": -12, "arka_sag_topuk": 6, "arka_sag_pati": 0,
         "arka_sol_kalca": 4, "arka_sol_diz": -10, "arka_sol_topuk": 5, "arka_sol_pati": 0,
         "kulak_sag": 4, "kulak_sol": 4, "cene": 6}
    yaw = {"kafa": -4}
    roll = {"kulak_sag": 8, "kulak_sol": -8}
    _kuyruk_akar(a, yaw, 8, 4.0, 4.0)
    return {"a": a, "yaw": yaw, "roll": roll, "yer": "tum", "esya": ["laptop", "masa"]}


def kos2(t, tilki):
    """İki ayakla koşu, kollarda dosya (uzanış anı)."""
    a = {"kalca": -62, "bel": -68, "gogus": -64, "boyun": -40, "kafa": 10,
         "on_sag_om": -42, "on_sag_dirsek": -90, "on_sag_bilek": -92,
         "on_sol_om": -36, "on_sol_dirsek": -88, "on_sol_bilek": -90,
         "arka_sag_kalca": -50, "arka_sag_diz": 2, "arka_sag_topuk": -22, "arka_sag_pati": 8,
         "arka_sol_kalca": 34, "arka_sol_diz": 82, "arka_sol_topuk": 62, "arka_sol_pati": 36,
         "kulak_sag": -46, "kulak_sol": -46, "cene": 14}
    yaw = {"kafa": -4}
    roll = {"kulak_sag": 3, "kulak_sol": -3}
    _kuyruk_akar(a, yaw, 12, 3.5, 3.0, 1.0)
    return {"a": a, "yaw": yaw, "roll": roll, "yer": "pati", "yukselt": 0.02, "esya": ["dosya", "dil"]}


KADRAJ_POZLARI = ["otur", "kos"]

POZ_FN = {"otur": otur, "otur_on": otur, "kos": None, "iki_ayak": iki_ayak, "yaz": yaz, "kos2": kos2}
POZ_YUZ = {"otur_on": 62, "iki_ayak": 58, "yaz": 40}


def poz_ver(ad, t, tilki, **kw):
    fn = kos_uzanis if ad == "kos" else POZ_FN[ad]
    p = fn(t, tilki)
    if ad in POZ_YUZ:
        p["govde_yaw"] = tilki.stil["yaw"] - POZ_YUZ[ad]
    return p


# ------------------------------------------------------------------ tasarım sayfası pozları
def yuru(t, tilki):
    """Yandan yürüyüş, adım ortası: yakın ön ve uzak arka basıyor, öbür ikisi kalkıyor."""
    a = {"kalca": 0, "bel": 0, "gogus": 0, "boyun": -38, "kafa": 6,
         "on_sag_om": -24, "on_sag_dirsek": -20, "on_sag_bilek": -6,
         "on_sol_om": 16, "on_sol_dirsek": 28, "on_sol_bilek": 62,
         "arka_sag_kalca": 2, "arka_sag_diz": 56, "arka_sag_topuk": 24, "arka_sag_pati": 40,
         "arka_sol_kalca": -40, "arka_sol_diz": 22, "arka_sol_topuk": -12, "arka_sol_pati": 0,
         "kulak_sag": 6, "kulak_sol": 6, "cene": 4}
    yaw = {"kafa": -6}
    roll = {"kulak_sag": 4, "kulak_sol": -4}
    for i in range(10):
        a[f"kuyruk_{i}"] = -8 + 3.2 * i
        yaw[f"kuyruk_{i}"] = 1.5 * math.sin(i * 0.6)
    if tilki.o.get("kuyruk_sayi", 1) > 1:
        for i in range(10):
            a[f"kuyruk_{i}"] = 4 + 4.4 * i
        return {"a": a, "yaw": yaw, "roll": roll, "yer": "tum", "dengele": True, "kuyruk_yelpaze": (40.0, 52.0)}
    return {"a": a, "yaw": yaw, "roll": roll, "yer": "tum", "dengele": True}


def otur_bak(t, tilki):
    """Oturur, bize bakar; kuyruk ön patilerin önüne sarılı."""
    p = otur(t, tilki)
    a, yaw, roll = p["a"], p["yaw"], p["roll"]
    yaw["kafa"] = -2
    roll["kafa"] = 8
    a["kulak_sag"] = 4
    a["kulak_sol"] = 4
    for i in range(10):
        a[f"kuyruk_{i}"] = 3 + (10 if i == 0 else 0) + (10 if i >= 8 else 0)
        yaw[f"kuyruk_{i}"] = 19.5
    if tilki.o.get("kuyruk_sayi", 1) > 1:   # kuyruklar arkada yelpaze gibi açılır
        for i in range(10):
            a[f"kuyruk_{i}"] = 34 + 7 * i
            yaw[f"kuyruk_{i}"] = 0.0
        p["kuyruk_yelpaze"] = (80.0, -42.0)
    return p


def uyu(t, tilki):
    """Kıvrılmış uyur: yere uzanmış, omurga kameraya doğru C, kafa patilerin üstünde, kuyruk önden sarılı, gözler kapalı."""
    p = sikil(t, tilki)
    a, yaw, roll = p["a"], p["yaw"], p["roll"]
    a.update({"boyun": 30, "kafa": 26, "kulak_sag": -48, "kulak_sol": -48})
    yaw.update({"bel": -26, "gogus": -28, "boyun": -26, "kafa": -16})
    roll.update({"kulak_sag": 22, "kulak_sol": -22, "kafa": 14})
    for i in range(10):
        a[f"kuyruk_{i}"] = 4 + (8 if i >= 8 else 0)
        yaw[f"kuyruk_{i}"] = 21
    p["kuyruk_yelpaze"] = (16.0, 9.0)
    p["goz"] = 1.0
    p["kapak"] = 1.0
    return p


def sikil(t, tilki):
    """Yere uzanmış, çenesi patilerinde, gözler yarı kapalı, kulaklar düşük: canı sıkılmış."""
    a = {"kalca": 0, "bel": 1, "gogus": 3, "boyun": 24, "kafa": 18,
         "on_sag_om": -78, "on_sag_dirsek": -90, "on_sag_bilek": -90,
         "on_sol_om": -74, "on_sol_dirsek": -90, "on_sol_bilek": -90,
         "arka_sag_kalca": -82, "arka_sag_diz": 84, "arka_sag_topuk": -86, "arka_sag_pati": -88,
         "arka_sol_kalca": -80, "arka_sol_diz": 84, "arka_sol_topuk": -86, "arka_sol_pati": -88,
         "kulak_sag": -30, "kulak_sol": -30, "cene": 0}
    yaw = {"kafa": -12}
    a["kulak_sag"] = -18
    a["kulak_sol"] = -18
    roll = {"kulak_sag": 66, "kulak_sol": -66, "kafa": 10}
    for i in range(10):
        a[f"kuyruk_{i}"] = 2 + (22 if i >= 8 else 0)
        yaw[f"kuyruk_{i}"] = 7
    return {"a": a, "yaw": yaw, "roll": roll, "yer": "tum", "kapak": 0.52, "kuyruk_yelpaze": (48.0, 8.0)}


POZ_FN.update({"yuru": yuru, "otur_bak": otur_bak, "uyu": uyu, "sikil": sikil})
