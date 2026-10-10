"""Beş tilki tasarımı (düz render için; piksel yok). STILLER'e T1..T5 olarak eklenir.
renk: sınıf -> (gölge, orta, ışık) sRGB hex. o: oranlar (tilki_model.Tilki.o'yu ezer)."""
from stiller import STILLER

KOYU_KONTUR = "2a1a1e"

TASARIMLAR = {
    "T1": dict(
        ad="1 · Pofuduk", c=1.0, yaw=0, egim=8, corap="koyu", goz=1.0, goz_tip="parlak", kuyruk_uc="krem",
        kuyruk_tuy=False, alin_tasi=False,
        o=dict(hs=1.55, es=1.12, ls=0.86, bl=0.8, bt=1.32, sl=0.74, goz=2.3, kuyruk=1.5, ince=1.15, tuy=1.0, kulak_en=1.1),
        renk=dict(kurk=("c4512b", "f0873a", "ffb36a"), krem=("d9c2b8", "fff3e6", "ffffff"), koyu=("2a1a1e", "3e2629", "5a3a3a"),
                  kulak_ic=("c46a72", "f4a3a3", "ffc8c0"), burun=("150c10", "2a1a1e", "4a3236"), goz=("100a0c", "1c1216", "2c2024"),
                  goz_bebek=("000000", "000000", "000000"), goz_isik=("ffffff", "ffffff", "ffffff"), agiz=("4a1a24", "6a2a34", "8a3a44"),
                  dil=("c4506a", "f07890", "ff9cb0")),
        kontur="3a1e1a",
    ),
    "T2": dict(
        ad="2 · Sıska komik", c=0.4, yaw=0, egim=8, corap="koyu", goz=1.0, goz_tip="parlak", kuyruk_uc="krem",
        kuyruk_tuy=False, alin_tasi=False,
        o=dict(hs=1.45, es=1.65, ls=1.5, bl=1.0, bt=0.72, sl=1.28, goz=2.0, kuyruk=0.8, ince=0.72, tuy=0.3, pati_boy=1.4, kulak_en=1.05),
        renk=dict(kurk=("c95e22", "f59a3e", "ffc274"), krem=("d6c6b6", "fff4e4", "ffffff"), koyu=("261a1a", "3a2828", "56403a"),
                  kulak_ic=("c46a72", "f4a3a3", "ffc8c0"), burun=("150c10", "2a1a1e", "4a3236"), goz=("100a0c", "1c1216", "2c2024"),
                  goz_bebek=("000000", "000000", "000000"), goz_isik=("ffffff", "ffffff", "ffffff"), agiz=("4a1a24", "6a2a34", "8a3a44"),
                  dil=("c4506a", "f07890", "ff9cb0")),
        kontur="3a1e1a",
    ),
    "T3": dict(
        ad="3 · Gerçekçi kızıl tilki", c=0.0, yaw=0, egim=8, corap="koyu", goz=1.0, goz_tip="iris", kuyruk_uc="krem", bebek="yuvarlak", isik_olcek=1.35,
        kuyruk_tuy=False, alin_tasi=False,
        o=dict(hs=1.12, es=1.05, ls=1.14, bl=0.98, bt=1.0, sl=1.12, goz=1.45, kuyruk=1.18, ince=0.92, tuy=0.6),
        renk=dict(kurk=("8e3420", "d6622a", "f39556"), krem=("cdbdb4", "f6efe8", "ffffff"), koyu=("1c1414", "2c2020", "443232"),
                  kulak_ic=("6a4440", "a87a70", "d4aa9a"), burun=("100a0a", "201616", "3a2c2c"), goz=("4a2410", "7a3e1a", "a8622e"),
                  goz_bebek=("0a0606", "0a0606", "0a0606"), goz_isik=("ffffff", "ffffff", "ffffff"), agiz=("3a1418", "5a2228", "7a3238"),
                  dil=("b4485e", "e07088", "ff98ac")),
        kontur="24140f",
        # piksel art sürümü (piksel.py)
        rampalar=dict(kurk=["4e1a12", "7e2c1c", "b04420", "d25e28", "ec8442"], krem=["9a8c8a", "cdbdb4", "f2eae2", "ffffff"],
                      koyu=["0c0808", "1c1414", "2e2222"], kulak_ic=["3a2422", "6a4440", "9a7068"], burun=["0a0606", "241818"],
                      goz=["2e160a", "4a2410", "7a3e1a"], goz_bebek=["0a0606"], goz_isik=["ffffff"], agiz=["3a1418", "5a2228"],
                      dil=["b4485e", "e07088"]),
        titrek=0.0, ic_cizgi=0.5, kenar_isik=None, goz_isik="ffffff", oto_goz_isik=False,
    ),
    "T4": dict(
        ad="4 · Fennek (çöl tilkisi)", c=0.8, yaw=0, egim=8, corap="kurk", goz=1.0, goz_tip="parlak", kuyruk_uc="koyu",
        kuyruk_tuy=False, alin_tasi=False,
        o=dict(hs=1.5, es=2.05, ls=0.98, bl=0.84, bt=1.02, sl=0.84, goz=2.1, kuyruk=1.02, ince=0.95, tuy=0.45, kulak_en=1.55),
        renk=dict(kurk=("b88a5a", "e8c38e", "fbe2b8"), krem=("dccdbb", "fff8ee", "ffffff"), koyu=("3a2a22", "5a4232", "7a5c46"),
                  kulak_ic=("d08a86", "f6b8ae", "ffd8cc"), burun=("150c10", "2a1a1e", "4a3236"), goz=("100a0c", "1c1216", "2c2024"),
                  goz_bebek=("000000", "000000", "000000"), goz_isik=("ffffff", "ffffff", "ffffff"), agiz=("4a1a24", "6a2a34", "8a3a44"),
                  dil=("c4506a", "f07890", "ff9cb0")),
        kontur="3a2a1e",
    ),
    "T5": dict(
        ad="5 · Mor Foxie", c=0.7, yaw=0, egim=8, corap="koyu", goz=1.0, goz_tip="parlak", kuyruk_uc="krem",
        kuyruk_tuy=False, alin_tasi=False,
        o=dict(hs=1.42, es=1.3, ls=1.0, bl=0.86, bt=1.1, sl=0.86, goz=2.0, kuyruk=1.25, ince=1.0, tuy=0.7),
        renk=dict(kurk=("5b3aa8", "8a5cf0", "b693ff"), krem=("cfc0dc", "fbf3ff", "ffffff"), koyu=("1e1438", "2c1d4f", "433070"),
                  kulak_ic=("b06aa8", "ec9ccc", "ffc4e0"), burun=("120a20", "1e1438", "3a2a5a"), goz=("0c0814", "16101e", "28203a"),
                  goz_bebek=("000000", "000000", "000000"), goz_isik=("ffffff", "ffffff", "ffffff"), agiz=("3a1430", "5a2248", "7a3260"),
                  dil=("c4506a", "f07890", "ff9cb0")),
        kontur="1e1438",
    ),
}

TASARIMLAR["T6"] = dict(
    ad="6 · Mor Foxie, dokuz kuyruklu (kitsune)", c=0.7, yaw=0, egim=8, corap="koyu", goz=1.0, goz_tip="iris", kuyruk_uc="isaret",
    kuyruk_tuy=False, alin_tasi=True, tilki_atesi=True, uc_bas=8,
    o=dict(hs=1.4, es=1.36, ls=1.04, bl=0.9, bt=1.05, sl=0.95, goz=1.95, kuyruk=0.92, kuyruk_boy=1.45, ince=0.98, tuy=0.7, kuyruk_sayi=9),
    renk=dict(kurk=("5b3aa8", "8a5cf0", "b693ff"), krem=("cfc0dc", "fbf3ff", "ffffff"), koyu=("1e1438", "2c1d4f", "433070"),
              kulak_ic=("b06aa8", "ec9ccc", "ffc4e0"), burun=("120a20", "1e1438", "3a2a5a"), goz=("c88a1c", "f2c040", "ffe48a"),
              goz_bebek=("120a20", "120a20", "120a20"), goz_isik=("ffffff", "ffffff", "ffffff"), agiz=("3a1430", "5a2248", "7a3260"),
              dil=("c4506a", "f07890", "ff9cb0"), isaret=("7fe0ff", "bff4ff", "ffffff")),
    kontur="1e1438",
)

for _k, _v in TASARIMLAR.items():
    STILLER[_k] = _v
