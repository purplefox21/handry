"""Foxie animasyonları: her biri fn(t, tilki) -> poz. Döngüde t 0..1 (son kare ilk kareye akar), bir kez oynayanlarda t 0..1 dahil.
Bir kez oynayanlar temel oturuşla (idle'ın ilk karesi) başlar ve biter; ears_up listen'a, lie_down sleep'e bağlanır.
Pozlar `tilki.coz` ile çözülüp (ters kinematik, zemin) `karistir` ile harmanlanır. Yürüyüş ve koşu patileri ters kinematikle yere basar
(duruşta pati kökün yerelinde sabit hızla geri gider: kaymaz); hızları ANIMLAR[...]["hiz"] (m/sn, modelin biriminde)."""
import math

from tilki_poz import otur, sikil, uyu, yuru


# ------------------------------------------------------------------ yardımcılar
def _s(x):
    return math.sin(2 * math.pi * x)


def _c(x):
    return math.cos(2 * math.pi * x)


def tepe(t, merkez, gen):
    """merkez çevresinde 0 -> 1 -> 0 yumuşak tümsek (yarı genişlik gen); döngü kenarından sarar."""
    d = abs(((t - merkez + 0.5) % 1.0) - 0.5)
    if d >= gen:
        return 0.0
    return 0.5 * (1 + math.cos(math.pi * d / gen))


def yum(x):
    x = min(max(x, 0.0), 1.0)
    return x * x * (3 - 2 * x)


def yum2(x):
    x = min(max(x, 0.0), 1.0)
    return x * x * x * (x * (x * 6 - 15) + 10)


def aralik(t, a, b):
    return yum2((t - a) / (b - a))


def lerp(a, b, w):
    return a + (b - a) * w


def karistir(p, q, w):
    """Çözülmüş iki pozun harmanı."""
    r = {}
    for k in ("a", "yaw", "roll"):
        pk, qk = p.get(k, {}), q.get(k, {})
        r[k] = {j: lerp(pk.get(j, 0.0), qk.get(j, 0.0), w) for j in set(pk) | set(qk)}
    for k, d in (("goz", 1.0), ("kapak", 0.0)):
        r[k] = lerp(p.get(k, d), q.get(k, d), w)
    pk, qk = p.get("kay", {}), q.get("kay", {})
    r["kay"] = {j: tuple(lerp(a_, b_, w) for a_, b_ in zip(pk.get(j, (0, 0, 0)), qk.get(j, (0, 0, 0)))) for j in set(pk) | set(qk)}
    r["esya"] = list(p.get("esya", []) if w < 0.5 else q.get("esya", []))
    r["yer"] = None
    return r


def ekle(p, a=None, yaw=None, roll=None, kay=None, **diger):
    """Pozun kopyasına ekler (açılar toplanır, kay toplanır, diğerleri yazılır)."""
    r = dict(p)
    for k, d in (("a", a), ("yaw", yaw), ("roll", roll)):
        if d:
            r[k] = dict(r.get(k, {}))
            for j, v in d.items():
                r[k][j] = r[k].get(j, 0.0) + v
    if kay:
        r["kay"] = dict(r.get("kay", {}))
        for j, v in kay.items():
            o = r["kay"].get(j, (0.0, 0.0, 0.0))
            r["kay"][j] = tuple(x + y for x, y in zip(o, v))
    r.update(diger)
    return r


def _onb(tilki, ad, fn):
    d = tilki.__dict__.setdefault("_onbellek", {})
    if ad not in d:
        d[ad] = fn()
    return d[ad]


def nefes(t, tur=2, g=1.0):
    n = _s(tur * t) * g
    return {"gogus": 1.4 * n, "bel": 0.7 * n, "boyun": 1.0 * n}


def kuyruk_dalga(t, yaw_g=6.0, pitch_g=2.0, tur=1, gecik=0.07):
    yaw, a = {}, {}
    for i in range(10):
        f = i / 9.0
        yaw[f"kuyruk_{i}"] = yaw_g * f * _s(tur * t - gecik * i)
        a[f"kuyruk_{i}"] = pitch_g * f * _s(tur * t + 0.2 - gecik * i)
    return yaw, a


# ------------------------------------------------------------------ temel pozlar
def idle(t, tilki):
    """Oturur, nefes alır (döngüde 2 nefes), başı yavaşça bakınır, bir kez göz kırpar, sağ kulak seğirir, kuyruk dalgalanır."""
    p = otur(0, tilki)
    a, yaw, roll = p["a"], p["yaw"], p["roll"]
    for j, v in nefes(t).items():
        a[j] += v
    yaw["kafa"] = -8 - 8 * (0.5 - 0.5 * math.cos(2 * math.pi * t))
    a["kafa"] += 2.5 * _s(t + 0.25) + 0.6 * _s(2 * t)
    roll["kafa"] = roll.get("kafa", 0) + 3 * _s(t + 0.1)
    k = tepe(t, 0.62, 0.03)
    a["kulak_sag"] -= 24 * k
    roll["kulak_sag"] += 10 * k
    a["kulak_sol"] -= 9 * tepe(t, 0.655, 0.025)
    ky, ka = kuyruk_dalga(t, 7.0, 3.0)
    for j in ky:
        yaw[j] = yaw.get(j, 0) + ky[j]
        a[j] += ka[j]
    p["goz"] = 1.0 - 0.9 * tepe(t, 0.30, 0.03)
    return p


def taban(tilki):
    """Temel oturuş (idle'ın ilk karesi), çözülmüş."""
    return _onb(tilki, "taban", lambda: tilki.coz(idle(0.0, tilki)))


def _sfenks(tilki):
    """Yere uzanmış, başı dik (yatışa geçişin ortası)."""
    def yap():
        p = sikil(0, tilki)
        p["a"].update({"boyun": -14, "kafa": 2, "kulak_sag": 4, "kulak_sol": 4})
        p["roll"].update({"kulak_sag": 6, "kulak_sol": -6, "kafa": 0})
        p["yaw"]["kafa"] = -8
        p["kapak"] = 0.0
        for i in range(10):
            p["a"][f"kuyruk_{i}"] = 2 + (10 if i >= 8 else 0)
        return tilki.coz(p)
    return _onb(tilki, "sfenks", yap)


def _uyku0(tilki):
    def yap():
        p = uyu(0, tilki)
        p["kapak"] = 0.0
        p["goz"] = 0.1
        return tilki.coz(p)
    return _onb(tilki, "uyku0", yap)


# ------------------------------------------------------------------ yürüyüş ve koşu (ters kinematik)
YURU_D = 0.30     # bir döngüde gövdenin aldığı yol (yürüyüş, döngü 1 sn)
KOS_D = 1.00      # koşu (döngü 0.5 sn)


def _ayak_yolu(phi, beta, E, kaldir):
    """phi: bacağın evresi (0 = yere basış). Duruşta pati önden arkaya sabit hızla, salınımda yay çizerek öne."""
    if phi < beta:
        s = phi / beta
        return E / 2 - E * s, 0.0, True, s
    u = (phi - beta) / (1 - beta)
    return -E / 2 + E * yum2(u), kaldir * math.sin(math.pi * u) ** 0.9, False, u


def _bacaklar(t, tilki, beta, D, ofs, on_ileri, arka_geri, kal_on, kal_arka, on_p, arka_m, arka_p):
    E = beta * D
    fx = tilki.rest_konum["on_sag_om"][0] + on_ileri
    hx = tilki.rest_konum["arka_sag_kalca"][0] - arka_geri
    ayak = {}
    for b, o_ in ofs.items():
        phi = (t - o_) % 1.0
        on = b.startswith("on")
        x, z, durus, s = _ayak_yolu(phi, beta, E, kal_on if on else kal_arka)
        if on:
            ayak[b] = {"x": fx + x, "z": z, "p": on_p(durus, s)}
        else:
            ayak[b] = {"x": hx + x, "z": z, "m": arka_m(durus, s), "p": arka_p(durus, s)}
    return ayak


def walk(t, tilki):
    """Sakin yürüyüş (yan sıralı: sol arka, sol ön, sağ arka, sağ ön), yerinde."""
    p = yuru(0, tilki)
    a = {k: v for k, v in p["a"].items() if not k.startswith(("on_", "arka_"))}
    yaw, roll = dict(p["yaw"]), dict(p["roll"])
    H0 = tilki.dinlenme["kalca"].z
    ayak = _bacaklar(
        t, tilki, 0.62, YURU_D, {"arka_sol": 0.0, "on_sol": 0.25, "arka_sag": 0.5, "on_sag": 0.75}, 0.03, 0.015, 0.055, 0.05,
        on_p=lambda d, s: 40 * yum((s - 0.7) / 0.3) if d else lerp(40, 0, yum(s)) + 70 * math.sin(math.pi * s),
        arka_m=lambda d, s: lerp(-16, 24, s) if d else lerp(24, -16, yum(s)),
        arka_p=lambda d, s: 35 * yum((s - 0.7) / 0.3) if d else lerp(35, 0, yum(s)) + 25 * math.sin(math.pi * s))
    a["kalca"] = 0.8 * _s(2 * t + 0.1)
    a["bel"] = 0.4 * _s(2 * t + 0.15)
    a["gogus"] = -0.6 * _s(2 * t + 0.2)
    a["boyun"] = -36 + 1.2 * _s(2 * t + 0.35)
    a["kafa"] = 6 + 1.5 * _s(2 * t + 0.4)
    yaw["kafa"] = -6 + 2 * _s(t)
    ky, ka = kuyruk_dalga(t, 6.0, 2.5)
    for i in range(10):
        j = f"kuyruk_{i}"
        a[j] = -8 + 3.2 * i + ka[j]
        yaw[j] = yaw.get(j, 0) + ky[j]
    kay = {"kalca": (0.0, 0.0, 0.37 - H0 + 0.006 * _c(2 * t))}
    return {"a": a, "yaw": yaw, "roll": roll, "kay": kay, "yer": None, "ayak": ayak}


def run(t, tilki):
    """Dörtnala (çapraz): arka patiler, sonra ön patiler, sonra havada toplanır; omurga bükülüp açılır."""
    H0 = tilki.dinlenme["kalca"].z
    b = -7 * _c(t - 0.2)          # gövde eğimi: arka itişte burun yukarı, ön basışta aşağı
    f = 11 * _c(t - 0.9)          # omurga: havada toplanır (kambur), uzanışta açılır
    a = {"kalca": b - f, "bel": b, "gogus": b + f, "boyun": -18 - 0.5 * b, "kafa": 6 - 0.8 * (b + f),
         "kulak_sag": -34, "kulak_sol": -34, "cene": 6}
    yaw = {"kafa": -4}
    roll = {"kulak_sag": 6, "kulak_sol": -6}
    ayak = _bacaklar(
        t, tilki, 0.3, KOS_D, {"arka_sol": 0.0, "arka_sag": 0.09, "on_sol": 0.38, "on_sag": 0.47}, 0.09, 0.05, 0.12, 0.1,
        on_p=lambda d, s: 50 * yum((s - 0.6) / 0.4) if d else lerp(50, 0, yum(s)) + 90 * math.sin(math.pi * s),
        arka_m=lambda d, s: lerp(-25, 35, s) if d else lerp(35, -25, yum(s)),
        arka_p=lambda d, s: 45 * yum((s - 0.6) / 0.4) if d else lerp(45, 0, yum(s)) + 40 * math.sin(math.pi * s))
    for i in range(10):
        a[f"kuyruk_{i}"] = 4 + 2.6 * i + 0.4 * f * (i / 9.0) + 4 * (i / 9.0) * _s(t - 0.06 * i)
        yaw[f"kuyruk_{i}"] = 2.5 * (i / 9.0) * _s(t - 0.05 * i + 0.3)
    kay = {"kalca": (0.0, 0.0, 0.345 - H0 + 0.028 * _c(t - 0.88))}
    return {"a": a, "yaw": yaw, "roll": roll, "kay": kay, "yer": None, "ayak": ayak}


def stop(t, tilki):
    """Koşudan fren yapıp oturur: koşu yavaşlar, ön patiler ileri kilitlenir, arka patiler altına girer, oturuşa çöker."""
    if t <= 0.3:
        u = t / 0.3
        return tilki.coz(run(0.55 * (1 - (1 - u) ** 2), tilki))
    H0 = tilki.dinlenme["kalca"].z

    def fren():
        a = {"kalca": -14, "bel": -10, "gogus": -6, "boyun": -30, "kafa": 2, "kulak_sag": -18, "kulak_sol": -18, "cene": 4}
        for i in range(10):
            a[f"kuyruk_{i}"] = 10 + 4 * i
        ayak = {"on_sag": {"dx": 0.11, "z": 0.0, "p": 0}, "on_sol": {"dx": 0.09, "z": 0.0, "p": 0},
                "arka_sag": {"dx": 0.12, "z": 0.0, "m": -40, "p": 0}, "arka_sol": {"dx": 0.10, "z": 0.0, "m": -40, "p": 0}}
        return tilki.coz({"a": a, "yaw": {"kafa": -6}, "roll": {"kulak_sag": 6, "kulak_sol": -6}, "ayak": ayak,
                          "kay": {"kalca": (0, 0, 0.29 - H0)}, "yer": None})

    fr = _onb(tilki, "fren", fren)
    if t <= 0.55:
        r = karistir(tilki.coz(run(0.55, tilki)), fr, yum2((t - 0.3) / 0.25))
    else:
        r = karistir(fr, taban(tilki), yum2((t - 0.55) / 0.45))
        r = ekle(r, a={"kafa": 5 * tepe(t, 0.9, 0.08), "boyun": 3 * tepe(t, 0.88, 0.08)})
    r["yer"] = "tum"
    return r


# ------------------------------------------------------------------ dinleme
def _dinle0(tilki):
    def yap():
        p = ekle(taban(tilki), a={"kafa": -3, "boyun": -4, "kulak_sag": 10, "kulak_sol": 10},
                 yaw={"kafa": -30}, roll={"kafa": 7, "kulak_sag": -3, "kulak_sol": 3})
        return p
    return _onb(tilki, "dinle0", yap)


def ears_up(t, tilki):
    """'Hey Foxie': kulaklar önce azıcık iner, sonra dikilir; baş bize döner. Sonra listen."""
    r = karistir(taban(tilki), _dinle0(tilki), yum2(t))
    k = -9 * tepe(t, 0.15, 0.15) + 7 * tepe(t, 0.72, 0.2)
    r = ekle(r, a={"kulak_sag": k, "kulak_sol": k, "kafa": -2 * tepe(t, 0.6, 0.3)})
    r["goz"] = 1.0 - 0.9 * tepe(t, 0.1, 0.07)
    r["yer"] = "tum"
    return r


def listen(t, tilki):
    """Kulaklar dik, bize bakar; merakla başını iki yana eğer, kulak oynar, göz kırpar."""
    r = ekle(_dinle0(tilki),
             a={**nefes(t), "kulak_sag": -14 * tepe(t, 0.42, 0.04), "kafa": 1.5 * _s(t)},
             yaw={"kafa": 4 * _s(t)},
             roll={"kafa": 9 * (_c(t) - 1), "kulak_sag": 8 * tepe(t, 0.42, 0.04)})
    r["goz"] = 1.0 - 0.9 * tepe(t, 0.72, 0.035)
    r["yer"] = "tum"
    return r


# ------------------------------------------------------------------ masa
def desk(t, tilki):
    """Küçük masada dizüstünde yazar: patiler sırayla tuşlara basar, başı ekrana eğik."""
    Z = 0.17
    l_sag = 0.016 * max(0.0, _s(6 * t))
    l_sol = 0.016 * max(0.0, _s(6 * t + 0.5))
    r = ekle(taban(tilki), a={"gogus": 6, "bel": 3, "boyun": 4, "kafa": 14 + 1.2 * _s(2 * t), "kulak_sag": -8 * tepe(t, 0.25, 0.04)},
             yaw={"kafa": 6})
    r["ayak"] = {"on_sag": {"dx": 0.15, "z": Z + l_sag, "z0": Z, "p": 12}, "on_sol": {"dx": 0.13, "z": Z + l_sol, "z0": Z, "p": 12}}
    r["esya"] = ["laptop", "masa"]
    r["esya_ref"] = "hedef"
    r["goz"] = 1.0 - 0.9 * tepe(t, 0.55, 0.04)
    ky, ka = kuyruk_dalga(t, 4.0, 1.5)
    r = ekle(r, yaw=ky, a=ka)
    r["yer"] = None
    return r


# ------------------------------------------------------------------ yatış, uyku, uyanış
def lie_down(t, tilki):
    """Oturuştan yere uzanır, sonra kıvrılır; gözler kapanır. Sonra sleep."""
    if t <= 0.5:
        r = karistir(taban(tilki), _sfenks(tilki), yum2(t / 0.5))
    else:
        r = karistir(_sfenks(tilki), _uyku0(tilki), yum2((t - 0.5) / 0.5))
    r["goz"] = lerp(1.0, 0.1, aralik(t, 0.72, 0.95))
    r["yer"] = "tum"
    return r


def sleep(t, tilki):
    """Kıvrılmış uyur: yavaş nefes (döngüde 2), kulak bir kez seğirir, kuyruk ucu kıpırdar."""
    r = ekle(_uyku0(tilki), a={**nefes(t, 2, 1.2), "kulak_sag": -16 * tepe(t, 0.55, 0.035)},
             roll={"kulak_sag": 10 * tepe(t, 0.55, 0.035)},
             yaw={f"kuyruk_{i}": 9 * tepe(t, 0.8, 0.05) * max(0, i - 6) / 3.0 for i in range(10)})
    r["goz"] = 0.1
    r["yer"] = "tum"
    return r


def wake_up(t, tilki):
    """Uyanır: göz açılır, esner, doğrulup oturur."""
    uy = _uyku0(tilki)
    kalk = ekle(_sfenks(tilki), a={"kafa": -6, "boyun": -4})
    if t <= 0.4:
        r = karistir(uy, kalk, yum2(t / 0.4))
    else:
        r = karistir(kalk, taban(tilki), yum2((t - 0.4) / 0.6))
    esne = tepe(t, 0.32, 0.1)
    r = ekle(r, a={"cene": 30 * esne, "kafa": -10 * esne, "kulak_sag": -10 * esne, "kulak_sol": -10 * esne})
    r["goz"] = lerp(0.1, 1.0, aralik(t, 0.1, 0.2)) * (1 - 0.75 * esne)
    r["esya"] = ["dil"] if esne > 0.35 else []
    r["yer"] = "tum"
    return r


# ------------------------------------------------------------------ duygular
def happy(t, tilki):
    """Sevinçle zıplar: çöker, havaya sıçrar (ağız açık, kuyruk havada), iner, kuyruk sallayarak oturur."""
    tb = taban(tilki)

    def cok():
        p = ekle(tb, a={"gogus": 10, "bel": 6, "boyun": 10, "kafa": 4, "kulak_sag": -8, "kulak_sol": -8})
        p["yer"] = "tum"
        return tilki.coz(p)

    def hava():
        p = ekle(tb, a={"gogus": -14, "bel": -8, "kalca": -6, "boyun": -10, "kafa": -8, "kulak_sag": 10, "kulak_sol": 10, "cene": 20},
                 yaw={"kafa": -14})
        for i in range(10):
            p["a"][f"kuyruk_{i}"] = 30 + 6 * i
        p["ayak"] = {"on_sag": {"dx": 0.12, "z": 0.12, "p": 70}, "on_sol": {"dx": 0.09, "z": 0.10, "p": 70}}
        p["yer"] = "tum"
        return tilki.coz(p)

    c = _onb(tilki, "mutlu_cok", cok)
    h = _onb(tilki, "mutlu_hava", hava)
    yuk = 0.0
    if t <= 0.18:
        r = karistir(tb, c, yum2(t / 0.18))
    elif t <= 0.52:
        u = (t - 0.18) / 0.34
        r = karistir(c, h, yum2(min(1.0, u * 2.2)) if u < 0.6 else yum2((1 - u) / 0.4))
        yuk = 0.15 * math.sin(math.pi * u)
    elif t <= 0.64:
        r = karistir(h, c, 1.0) if False else c
    else:
        r = karistir(c, tb, yum2((t - 0.64) / 0.36))
    sall = (1 - aralik(t, 0.55, 1.0)) * aralik(t, 0.5, 0.58)
    r = ekle(r, yaw={f"kuyruk_{i}": 22 * sall * (i / 9.0) * _s(3.5 * t - 0.05 * i) for i in range(10)},
             kay={"kalca": (0.0, 0.0, yuk)})
    r["esya"] = ["dil"] if 0.25 < t < 0.6 else []
    r["yer"] = None if yuk > 0 else "tum"
    return r


def _uzgun(tilki):
    def yap():
        p = ekle(taban(tilki), a={"boyun": 16, "kafa": 18, "kulak_sag": -40, "kulak_sol": -40, "gogus": 4},
                 yaw={"kafa": 10}, roll={"kulak_sag": 34, "kulak_sol": -34})
        for i in range(10):
            p["a"][f"kuyruk_{i}"] = -2 + (3 if i >= 8 else 0)
        return p
    return _onb(tilki, "uzgun", yap)


def sad(t, tilki):
    """Kulaklar düşer, başı eğilir, iç çeker, sonra toparlanıp oturur."""
    u = _uzgun(tilki)
    if t <= 0.25:
        r = karistir(taban(tilki), u, yum2(t / 0.25))
    elif t <= 0.75:
        r = dict(u)
    else:
        r = karistir(u, taban(tilki), yum2((t - 0.75) / 0.25))
    ic = tepe(t, 0.45, 0.1)
    r = ekle(r, a={"gogus": -5 * ic + 3 * tepe(t, 0.6, 0.08), "kafa": -4 * ic, "kulak_sag": -6 * ic, "kulak_sol": -6 * ic})
    r["goz"] = 1.0 - 0.3 * aralik(t, 0.1, 0.25) * (1 - aralik(t, 0.78, 0.95)) - 0.6 * tepe(t, 0.62, 0.05)
    r["yer"] = "tum"
    return r


def _sikkin0(tilki):
    def yap():
        p = sikil(0, tilki)
        p["kapak"] = 0.5
        return tilki.coz(p)
    return _onb(tilki, "sikkin0", yap)


def bored(t, tilki):
    """Sıkılmış: çenesi patilerinde yatar, gözler yarı kapalı; iç çeker, yavaşça göz kırpar, kuyruk ucu ve kulak oynar."""
    ic = tepe(t, 0.35, 0.09)
    r = ekle(_sikkin0(tilki), a={**nefes(t, 1, 1.0), "gogus": -4 * ic, "kafa": -3 * ic, "kulak_sol": -12 * tepe(t, 0.15, 0.03)},
             roll={"kulak_sol": -8 * tepe(t, 0.15, 0.03)},
             yaw={f"kuyruk_{i}": 14 * tepe(t, 0.78, 0.06) * max(0, i - 5) / 4.0 for i in range(10)})
    r["kapak"] = 0.5 + 0.48 * tepe(t, 0.62, 0.06) - 0.15 * ic
    r["yer"] = "tum"
    return r


# ------------------------------------------------------------------ masaüstü pet'i: tutulma, düşme, zıplama, kenar, dönüş, sevilme
TUT_KUYRUK = ({"eklem": "kuyruk_3"}, (0.5, 0.2))     # fare kuyruğun ortasında (karede sabit)
TUT_ENSE = ({"eklem": "boyun", "ofs": (-0.075, 0.0, 0.03)}, (0.5, 0.31))           # fare ensede


def held_tail(t, tilki):
    """Kuyruğundan tutulmuş: baş aşağı sallanır, bacaklar çırpınır, kulaklar sarkar."""
    sw = 7 * _s(t)
    a = {"kalca": 90 + sw, "bel": 92 + sw, "gogus": 96 + sw, "boyun": 112 + sw, "kafa": 62 + 0.5 * sw,
         "kulak_sag": 172 + 6 * _s(t + 0.2), "kulak_sol": 168 + 6 * _s(t + 0.25), "cene": 12,
         "on_sag_om": -25 + 28 * _s(2 * t), "on_sag_dirsek": -40 + 30 * _s(2 * t + 0.1), "on_sag_bilek": 20,
         "on_sol_om": -25 + 28 * _s(2 * t + 0.5), "on_sol_dirsek": -40 + 30 * _s(2 * t + 0.6), "on_sol_bilek": 20,
         "arka_sag_kalca": -15 + 22 * _s(2 * t + 0.25), "arka_sag_diz": 25 + 15 * _s(2 * t + 0.3), "arka_sag_topuk": -5, "arka_sag_pati": 20,
         "arka_sol_kalca": -15 + 22 * _s(2 * t + 0.75), "arka_sol_diz": 25 + 15 * _s(2 * t + 0.8), "arka_sol_topuk": -5, "arka_sol_pati": 20}
    for i, v in enumerate((90, 90, 90, 90, 150, 185, 192, 196, 198, 200)):   # tutulan yerden sonrası elin öbür yanına sarkar
        a[f"kuyruk_{i}"] = v + (sw if i < 4 else 0)
    yaw = {"kafa": -22}
    roll = {"kulak_sag": 10, "kulak_sol": -10}
    return {"a": a, "yaw": yaw, "roll": roll, "yer": None, "capa": TUT_KUYRUK[0], "capa_hedef": TUT_KUYRUK[1]}


def held_scruff(t, tilki):
    """Ensesinden tutulmuş: gövde sarkar, bacaklar gevşek, kuyruk aşağıda sallanır, boynu bükük bakar."""
    sw = 4 * _s(t)
    a = {"kalca": -80 + sw, "bel": -82 + sw, "gogus": -84 + sw, "boyun": -40, "kafa": 4 + 2 * _s(t + 0.3),
         "kulak_sag": -32, "kulak_sol": -32, "cene": 2,
         "on_sag_om": 4 + 4 * _s(t + 0.1), "on_sag_dirsek": 6 + 4 * _s(t + 0.15), "on_sag_bilek": 35,
         "on_sol_om": 2 + 4 * _s(t + 0.6), "on_sol_dirsek": 4 + 4 * _s(t + 0.65), "on_sol_bilek": 35,
         "arka_sag_kalca": 2 + 5 * _s(t + 0.2), "arka_sag_diz": 12, "arka_sag_topuk": -4, "arka_sag_pati": 40,
         "arka_sol_kalca": 0 + 5 * _s(t + 0.7), "arka_sol_diz": 10, "arka_sol_topuk": -4, "arka_sol_pati": 40}
    for i in range(10):
        a[f"kuyruk_{i}"] = -88 + 3 * i * 0
    yaw = {"kafa": -26}
    for i in range(10):
        yaw[f"kuyruk_{i}"] = 7 * (i / 9.0) * _s(t - 0.07 * i)
    roll = {"kulak_sag": 22, "kulak_sol": -22, "kafa": 6}
    p = {"a": a, "yaw": yaw, "roll": roll, "yer": None, "capa": TUT_ENSE[0], "capa_hedef": TUT_ENSE[1]}
    p["goz"] = 0.82 - 0.7 * tepe(t, 0.6, 0.06)
    return p


def fall(t, tilki):
    """Düşüyor: bacaklar açık, kulaklar ve kuyruk havada, gözler kocaman, ağız açık. En alçak pati zemin satırında."""
    f = _s(2 * t)
    a = {"kalca": 4, "bel": 2, "gogus": 0, "boyun": -28, "kafa": -4, "cene": 14,
         "kulak_sag": -14 + 14 * _s(2 * t), "kulak_sol": -14 + 14 * _s(2 * t + 0.1),
         "on_sag_om": -52 + 10 * f, "on_sag_dirsek": -64 + 12 * f, "on_sag_bilek": -20,
         "on_sol_om": -42 - 10 * f, "on_sol_dirsek": -54 - 12 * f, "on_sol_bilek": -20,
         "arka_sag_kalca": 42 - 10 * f, "arka_sag_diz": 72 - 8 * f, "arka_sag_topuk": 40, "arka_sag_pati": 30,
         "arka_sol_kalca": 34 + 10 * f, "arka_sol_diz": 64 + 8 * f, "arka_sol_topuk": 36, "arka_sol_pati": 30}
    yaw = {"kafa": -8}
    for i in range(10):
        a[f"kuyruk_{i}"] = 16 + 5 * i + 5 * (i / 9.0) * _s(2 * t - 0.08 * i)
        yaw[f"kuyruk_{i}"] = 4 * (i / 9.0) * _s(2 * t - 0.06 * i + 0.3)
    return {"a": a, "yaw": yaw, "roll": {"kulak_sag": 8, "kulak_sol": -8}, "yer": "pati", "goz": 1.12}


def _cok(tilki, derin=1.0):
    def yap():
        p = ekle(taban(tilki), a={"gogus": 14, "bel": 8, "boyun": 12, "kafa": 4, "kulak_sag": -22, "kulak_sol": -22})
        p["yer"] = "tum"
        return tilki.coz(p)
    return _onb(tilki, "cok_derin", yap)


def land(t, tilki):
    """Yere iner: düşüş pozundan çarpıp çöker, toparlanıp oturur."""
    f0 = _onb(tilki, "fall0", lambda: tilki.coz(fall(0.0, tilki)))
    c = _cok(tilki)
    if t <= 0.25:
        r = karistir(f0, c, yum2(t / 0.25))
    else:
        r = karistir(c, taban(tilki), yum2((t - 0.25) / 0.75))
    r["goz"] = 1.0 - 0.8 * tepe(t, 0.28, 0.12)
    r["yer"] = "tum"
    return r


def jump(t, tilki):
    """Yukarı (pencere kenarına) sıçrar: çöker, gerilip fırlar; son karesi fall'ın ilk karesi. Kalkış karesi ANIMLAR'da (liftoff)."""
    c = _cok(tilki)

    def firla():
        p = {"a": {"kalca": -22, "bel": -26, "gogus": -30, "boyun": -52, "kafa": -6, "kulak_sag": -6, "kulak_sol": -6, "cene": 4,
                   "on_sag_om": -96, "on_sag_dirsek": -104, "on_sag_bilek": -90,
                   "on_sol_om": -88, "on_sol_dirsek": -96, "on_sol_bilek": -84,
                   "arka_sag_kalca": 30, "arka_sag_diz": 52, "arka_sag_topuk": 40, "arka_sag_pati": 70,
                   "arka_sol_kalca": 24, "arka_sol_diz": 46, "arka_sol_topuk": 36, "arka_sol_pati": 64},
             "yaw": {"kafa": -6}, "roll": {}, "yer": "tum"}
        for i in range(10):
            p["a"][f"kuyruk_{i}"] = -20 + 2 * i
        return tilki.coz(p)

    fi = _onb(tilki, "firla", firla)
    f0 = _onb(tilki, "fall0", lambda: tilki.coz(fall(0.0, tilki)))
    if t <= 0.4:
        r = karistir(taban(tilki), c, yum2(t / 0.4))
    elif t <= 0.7:
        r = karistir(c, fi, yum2((t - 0.4) / 0.3))
    else:
        r = karistir(fi, f0, yum2((t - 0.7) / 0.3))
    r["yer"] = "tum"
    return r


def edge_hang(t, tilki):
    """Pencerenin köşesinde yatar: gövde kenarın üstünde, ön patiler aşağı sarkar ve sallanır, başı aşağı bakar.
    Çapa: köşe noktası (omzun hemen önü, zemin hizası); uygulama bunu pencerenin üst köşesine oturtur."""
    r = ekle(_sfenks(tilki), a={"boyun": 18, "kafa": 26 + 2 * _s(t), "kulak_sag": -6 * tepe(t, 0.3, 0.05)},
             yaw={"kafa": -12 + 4 * _s(t)})
    r["ayak"] = {"on_sag": {"dx": 0.07, "z": -0.15 + 0.014 * _s(t), "p": 70},
                 "on_sol": {"dx": 0.05, "z": -0.14 + 0.014 * _s(t + 0.5), "p": 70}}
    ky, ka = kuyruk_dalga(t, 6.0, 2.0)
    r = ekle(r, yaw=ky, a=ka)
    r["goz"] = 1.0 - 0.9 * tepe(t, 0.7, 0.04)
    r["yer"] = None
    r["capa"] = {"eklem": "on_sag_om", "kenar_dx": 0.035}
    r["capa_hedef"] = (0.69, 0.62)
    return r


def turn(t, tilki):
    """Otururken arkasını döner (sağa bakandan sola bakana, yüzü bize dönerek). Sonra uygulama idle'ı aynalı oynar."""
    r = ekle(taban(tilki), kay={"kalca": (0.0, 0.0, 0.03 * math.sin(math.pi * t))},
             a={"gogus": -4 * math.sin(math.pi * t)})
    r["ek_yaw"] = -140 * yum2(t)
    r["yer"] = None
    return r


def petted(t, tilki):
    """Sevilir: gözlerini mutlulukla kapatır, başını ele doğru kaldırıp eğer, kulaklar geride, kuyruk sallanır."""
    zarf = aralik(t, 0.0, 0.22) * (1 - aralik(t, 0.78, 1.0))
    r = ekle(taban(tilki), a={"kafa": -12 * zarf, "boyun": -6 * zarf, "kulak_sag": -26 * zarf, "kulak_sol": -26 * zarf, "gogus": -3 * zarf},
             yaw={"kafa": -14 * zarf, **{f"kuyruk_{i}": 20 * zarf * (i / 9.0) * _s(4 * t - 0.05 * i) for i in range(10)}},
             roll={"kafa": 12 * zarf * (0.7 + 0.3 * _s(2 * t))})
    r["goz"] = 1.0 - 0.88 * zarf
    r["yer"] = "tum"
    return r


ANIMLAR = {
    "idle": dict(fn=idle, kare=96, fps=24, dongu=True),
    "walk": dict(fn=walk, kare=24, fps=24, dongu=True, hiz=YURU_D / 1.0),
    "run": dict(fn=run, kare=12, fps=24, dongu=True, hiz=KOS_D / 0.5),
    "stop": dict(fn=stop, kare=30, fps=24, dongu=False, sonra="idle"),
    "ears_up": dict(fn=ears_up, kare=14, fps=24, dongu=False, sonra="listen"),
    "listen": dict(fn=listen, kare=72, fps=24, dongu=True),
    "desk": dict(fn=desk, kare=48, fps=24, dongu=True),
    "lie_down": dict(fn=lie_down, kare=40, fps=24, dongu=False, sonra="sleep"),
    "sleep": dict(fn=sleep, kare=96, fps=24, dongu=True),
    "wake_up": dict(fn=wake_up, kare=48, fps=24, dongu=False, sonra="idle"),
    "happy": dict(fn=happy, kare=32, fps=24, dongu=False, sonra="idle"),
    "sad": dict(fn=sad, kare=60, fps=24, dongu=False, sonra="idle"),
    "bored": dict(fn=bored, kare=96, fps=24, dongu=True),
    "held_tail": dict(fn=held_tail, kare=24, fps=24, dongu=True, capa="tutma", ust_ek=176),
    "held_scruff": dict(fn=held_scruff, kare=48, fps=24, dongu=True, capa="tutma", ust_ek=176),
    "fall": dict(fn=fall, kare=12, fps=24, dongu=True),
    "land": dict(fn=land, kare=14, fps=24, dongu=False, sonra="idle"),
    "jump": dict(fn=jump, kare=16, fps=24, dongu=False, sonra="fall", kalkis=11),
    "edge_hang": dict(fn=edge_hang, kare=48, fps=24, dongu=True, capa="kose"),
    "turn": dict(fn=turn, kare=12, fps=24, dongu=False, sonra="idle", aynala=True),
    "petted": dict(fn=petted, kare=36, fps=24, dongu=False, sonra="idle"),
}
