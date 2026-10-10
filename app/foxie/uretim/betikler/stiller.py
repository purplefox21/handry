"""Foxie tilkisinin stilleri: oranlar (Blender tarafı) ve palet / gölge ayarları (piksel tarafı).
Hem Blender hem sistem Python'u bunu içeri alır; sadece sözlük ve sayı içerir.

c: 0 = gerçekçi oran, 1 = sevimli (iri kafa, kısa bacak, yuvarlak kuyruk).
Palet: her sınıfın rampası koyudan açığa; piksel tarafı ışık değerini bantlara böler.
"""

# Sınıf numaraları (render katmanında kırmızı kanal = sınıf / 255)
SINIFLAR = {"kurk": 1, "krem": 2, "koyu": 3, "kulak_ic": 4, "burun": 5, "goz": 6, "agiz": 7, "dil": 8, "isaret": 9,
            "esya_koyu": 10, "esya_orta": 11, "esya_acik": 12, "esya_isik": 13, "esya_ahsap": 14, "goz_bebek": 15, "goz_isik": 16}

ESYA_RAMPALARI = dict(
    esya_koyu=["20243a", "343a58", "4c5478"], esya_orta=["68708c", "98a0bc", "c8d0e4"],
    esya_acik=["b4acc8", "e8e2f2", "ffffff"], esya_isik=["bff4ff", "ffffff"], esya_ahsap=["4a2c34", "7a4a3c", "a8724e"],
)

STILLER = {
    "A": dict(
        ad="Tatlı", c=1.0, yaw=26, egim=14, corap="krem", goz=1.0,
        rampalar=dict(
            kurk=["3f2a8c", "6b3fd6", "8f62f5", "b18bff", "d6bfff"],
            krem=["a58cc4", "d8c1dc", "fff0e2", "ffffff"],
            koyu=["24123f", "3a2266", "523391"],
            kulak_ic=["b8548f", "ee86bc", "ffb8d6"],
            burun=["150b26", "2a1747"],
            goz=["1a0f33"], agiz=["3a0f2a"], dil=["d95a7a", "ff8aa0"],
            isaret=["8ff0ff"],
        ),
        kontur="2a1747", ic_cizgi=0.5, titrek=0.0, kenar_isik=None, goz_isik="ffffff",
    ),
    "B": dict(
        ad="Gerçekçi", c=0.0, yaw=14, egim=12, corap="koyu", goz=1.0, kadraj=["otur", "kos", "otur_on"],
        rampalar=dict(
            kurk=["2a1757", "4f2c96", "7345d0", "9566ee", "bb9cff"],
            krem=["8d7aa5", "c2b0c4", "efe0d6", "fff7ee"],
            koyu=["140a2a", "241545", "38235f"],
            kulak_ic=["8a4a7e", "c97aa6", "f0b0c8"],
            burun=["120a22", "241440"],
            goz=["1a0f33"], agiz=["3a0f2a"], dil=["d95a7a", "ff8aa0"],
            isaret=["8ff0ff"],
        ),
        kontur="1f1238", ic_cizgi=0.5, titrek=0.07, kenar_isik=None, goz_isik="f4eaff",
    ),
    "C": dict(
        ad="Mistik", c=0.5, yaw=22, egim=14, corap="koyu", goz=1.2, kadraj=["otur", "kos", "otur_on"],
        rampalar=dict(
            kurk=["251d5c", "433497", "6552d0", "8878ee", "b6abff"],
            krem=["8a7fb0", "bdb2d2", "ece2ee", "fffaf5"],
            koyu=["120d2b", "1f1847", "2f2766"],
            kulak_ic=["5a3a8a", "9a68c0", "d7a8e8"],
            burun=["0f0a22", "1f1642"],
            goz=["ffc24d"], agiz=["3a0f2a"], dil=["d95a7a", "ff8aa0"],
            isaret=["36a8d6", "8ff0ff", "e6ffff"],
        ),
        kontur="1a1238", ic_cizgi=0.5, titrek=0.0, kenar_isik=None, goz_isik="fff6d6",
        kuyruk_uc="isaret", alin_tasi=True,
    ),
}

TURUNCU = dict(
    kurk=["4a1a3a", "8c2f2a", "d9531e", "f98a2f", "ffc060"],
    krem=["a8828c", "dcc0b0", "fff0dc", "ffffff"],
    koyu=["170d1c", "2a1426", "40201f"],
    kulak_ic=["9a3f4f", "dd7a80", "ffb8aa"],
    burun=["120a14", "2a141c"],
    goz=["24101c"], agiz=["3a0f2a"], dil=["d95a7a", "ff8aa0"],
    isaret=["36a8d6", "8ff0ff", "e6ffff"],
)

STILLER["CT"] = dict(
    ad="C · Turuncu", c=0.5, yaw=22, egim=14, corap="koyu", goz=1.2,
    rampalar=TURUNCU, kontur="2a1020", ic_cizgi=0.5, titrek=0.0, kenar_isik=None, goz_isik="ffffff",
    kuyruk_uc="isaret", alin_tasi=True, kadraj=["otur", "kos", "otur_on"], kuyruk_tuy=False,
)

STILLER["D"] = dict(
    ad="D · Sıska komik", c=0.5, yaw=22, egim=14, corap="koyu", goz=1.0,
    o=dict(hs=1.6, es=1.5, ls=1.4, bl=0.95, bt=0.74, sl=1.1, goz=2.6, kuyruk=0.82, ince=0.8, kuyruk_boy=0.9, pati_boy=1.7),
    rampalar=TURUNCU, kontur="2a1020", ic_cizgi=0.5, titrek=0.0, kenar_isik=None, goz_isik="ffffff",
    kuyruk_uc="krem", alin_tasi=False, kadraj=["iki_ayak", "yaz", "kos2"], boy=0.72, kuyruk_tuy=False,
)
