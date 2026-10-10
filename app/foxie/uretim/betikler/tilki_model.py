"""Foxie tilkisi: Blender'da parametrik 3D model, FK poz ve ham katmanlar (sınıf, parça, derinlik, ışık).

Çalıştırma (Blender içinde):
  Blender -b --factory-startup --python tilki_model.py -- '<json>'
json: {"stil": "A", "cikti": "/yol/ham", "kareler": [{"ad": "otur_0", "poz": "otur", "t": 0.0}], "kamera": {...}}

Eksenler: tilki +X'e bakar, Z yukarı. Kamera -Y'den bakar (tilkinin sağ yanı kameraya yakın). Yerel eklemler Euler 'ZYX'
(önce yaw Z, sonra pitch Y): pozlar dünya pitch açısıyla yazılır, yerel açı üst eklemin açısından çıkarılır.
Pitch (Y dönüşü) + yönü = ekranda saat yönü: aşağı sarkan uç geriye, +X ekseni aşağıya gider.
"""
import json
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from stiller import SINIFLAR, STILLER  # noqa: E402

R = math.radians
KARE_W = 160            # son kare genişliği (piksel)
KARE_H = 128            # son kare yüksekliği
SS = 6                  # her piksel için 6x6 örnek
MERKEZ_YUKSEK = 6.0     # kamera uzaklığı (ortografik, önemsiz)


def _lerp(a, b, t):
    return a + (b - a) * t


MB_KATSAYI = 0.57       # metaball (stiffness 2, eşik 0.6): yüzey yarıçapı = 0.57 x radius x size


class Cilt:
    """Metaball birleşimiyle tek pürüzsüz yüzey; eklemlere zincir boyunca şapka ağırlıklarıyla (LBS) bağlı."""

    def __init__(self, tilki, ad, zincir, elemanlar, cozunurluk=0.006, kucul=0.93):
        self.t = tilki
        self.ad = ad
        self.zincir = zincir
        mb = bpy.data.metaballs.new(ad)
        mb.resolution = cozunurluk
        mb.render_resolution = cozunurluk
        mb.threshold = 0.6
        for (m, yar, sinif, grup, onc) in elemanlar:
            e = mb.elements.new(type="ELLIPSOID")
            rmax = max(yar) * kucul
            e.co = tuple(m)
            e.radius = rmax / MB_KATSAYI
            e.stiffness = 2.0
            e.size_x, e.size_y, e.size_z = (y * kucul / rmax for y in yar)
        ob = bpy.data.objects.new(ad, mb)
        bpy.context.scene.collection.objects.link(ob)
        for o in bpy.context.view_layer.objects:
            o.select_set(False)
        bpy.context.view_layer.objects.active = ob
        ob.select_set(True)
        bpy.ops.object.convert(target="MESH")
        ob = bpy.context.view_layer.objects.active
        me = ob.data
        n = len(me.vertices)
        v = np.empty(n * 3)
        me.vertices.foreach_get("co", v)
        self.rest = v.reshape(n, 3).copy()
        # yüz sınıfları: en yakın eleman (normalleştirilmiş uzaklık, öncelikle)
        nf = len(me.polygons)
        mer = np.empty(nf * 3)
        me.polygons.foreach_get("center", mer)
        mer = mer.reshape(nf, 3)
        d = np.empty((nf, len(elemanlar)))
        for i, (m, yar, sinif, grup, onc) in enumerate(elemanlar):
            q = (mer - np.array(m)) / np.array(yar)
            d[:, i] = np.sqrt((q ** 2).sum(axis=1)) * onc
        en = d.argmin(axis=1)
        slotlar = []
        anahtar = []
        for (m, yar, sinif, grup, onc) in elemanlar:
            k = (sinif, grup)
            if k not in slotlar:
                slotlar.append(k)
            anahtar.append(slotlar.index(k))
        mi = np.array(anahtar)[en].astype(np.int32)
        me.polygons.foreach_set("material_index", mi)
        for p in me.polygons:
            p.use_smooth = True
        self.ob = ob
        self.me = me
        self.slotlar = slotlar
        ob.name = ad
        # ağırlıklar: eklem konumlarının çoklu çizgisine izdüşüm
        P = np.array([tilki.rest_konum[j] for j in zincir])
        n_seg = len(zincir) - 1
        en_d = np.full(n, 1e9)
        u = np.zeros(n)
        for k in range(n_seg):
            dv = P[k + 1] - P[k]
            ll = max(dv @ dv, 1e-12)
            tt = np.clip(((self.rest - P[k]) @ dv) / ll, 0, 1)
            yak = P[k] + tt[:, None] * dv
            dist = np.linalg.norm(self.rest - yak, axis=1)
            iyi = dist < en_d
            en_d[iyi] = dist[iyi]
            u[iyi] = k + tt[iyi]
        if n_seg == 0:
            u[:] = 0
        i0 = np.minimum(np.floor(u).astype(int), max(n_seg - 1, 0))
        self.i0 = i0
        self.w1 = (u - i0) if n_seg > 0 else np.zeros(n)
        self.dunya = self.rest.copy()

    def poz(self):
        t = self.t
        T = [t.eklem_mat(j) @ t.rest_ters[j] for j in self.zincir]
        n = len(self.rest)
        h = np.hstack([self.rest, np.ones((n, 1))])
        cikis = np.zeros((n, 3))
        for k in range(len(self.zincir)):
            m0 = (self.i0 == k)
            m1 = (self.i0 + 1 == k) & (self.w1 > 0)
            if not (m0.any() or m1.any()):
                continue
            tk = (T[k] @ h.T).T[:, :3]
            if m0.any():
                w0 = (1.0 - self.w1[m0])[:, None]
                cikis[m0] += w0 * tk[m0]
            if m1.any():
                cikis[m1] += self.w1[m1][:, None] * tk[m1]
        # zincirin son eklemi (i0 son segmentin başı): son eklem için w1'e düşen kısım yukarıda m1'de
        if len(self.zincir) == 1:
            cikis = (T[0] @ h.T).T[:, :3]
        self.dunya = cikis

    def yaz(self, kaydir_z=0.0):
        v = self.dunya.copy()
        v[:, 2] += kaydir_z
        self.dunya = v
        self.me.vertices.foreach_set("co", v.reshape(-1))
        self.me.update()


class Tilki:
    """Eklemler (Empty), sürekli deri parçaları (Cilt) ve rijit parçalar; her parça bir sınıf ve grup taşır."""

    def __init__(self, stil):
        self.stil = STILLER[stil]
        c = self.stil["c"]
        self.o = dict(hs=_lerp(1.22, 1.6, c), es=_lerp(1.1, 1.3, c), ls=_lerp(1.12, 0.96, c), bl=_lerp(0.86, 0.76, c),
                      bt=_lerp(1.08, 1.18, c), sl=_lerp(1.0, 0.85, c), goz=_lerp(1.5, 1.9, c) * self.stil["goz"],
                      kuyruk=_lerp(1.0, 1.15, c), ince=1.0, kuyruk_boy=1.0, pati_boy=1.0)
        self.o.update(self.stil.get("o", {}))
        self.eklem = {}       # ad -> Empty
        self.ust = {}         # ad -> üst eklem adı
        self.dinlenme = {}    # ad -> dinlenme konumu (üstüne göre)
        self.parcalar = []    # (obj, ad, sinif, grup) rijit parçalar
        self.ciltler = []
        self.cok_sinif = {}    # parça adı -> [sınıf adları] (yüz başına malzeme)
        self.esya_adlari = {}  # parça adı -> eşya grubu (laptop, masa, dosya, dil): poza göre görünür
        self.yerel_koseler = {}
        self.kok = self._eklem("kok", None, (0, 0, 0))
        self._kur()

    # ---------------------------------------------------------------- yapı taşları
    def _eklem(self, ad, ust, konum):
        e = bpy.data.objects.new(ad, None)
        bpy.context.scene.collection.objects.link(e)
        e.rotation_mode = "XYZ" if ad.startswith("on_") and ad.endswith("_om") else "ZYX"
        if ust:
            e.parent = self.eklem[ust]
        e.location = konum
        self.eklem[ad] = e
        self.ust[ad] = ust
        self.dinlenme[ad] = Vector(konum)
        return e

    def eklem_mat(self, ad):
        return np.array(self.eklem[ad].matrix_world)

    def _parca(self, eklem, ad, sinif, grup, bm, duz=False):
        me = bpy.data.meshes.new(ad)
        bm.to_mesh(me)
        bm.free()
        for p in me.polygons:
            p.use_smooth = not duz
        ob = bpy.data.objects.new(ad, me)
        bpy.context.scene.collection.objects.link(ob)
        ob.parent = self.eklem[eklem]
        self.parcalar.append((ob, ad, sinif, grup))
        self.yerel_koseler[ad] = np.array([v.co[:] for v in me.vertices], dtype=np.float64)
        return ob

    @staticmethod
    def _elips_bm(bm, merkez, yaricap, dondur=(0, 0, 0)):
        r = bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=14, radius=1.0)
        s = Matrix.Diagonal((yaricap[0], yaricap[1], yaricap[2], 1.0))
        rot = Matrix.Rotation(R(dondur[2]), 4, "Z") @ Matrix.Rotation(R(dondur[1]), 4, "Y") @ Matrix.Rotation(R(dondur[0]), 4, "X")
        m = Matrix.Translation(merkez) @ rot @ s
        bmesh.ops.transform(bm, matrix=m, verts=r["verts"])

    def elips(self, eklem, ad, merkez, yaricap, sinif, grup, dondur=(0, 0, 0)):
        bm = bmesh.new()
        self._elips_bm(bm, Vector(merkez), yaricap, dondur)
        return self._parca(eklem, ad, SINIFLAR[sinif], grup, bm)

    def elips_m(self, eklem, ad, merkez, yaricap, sinif, grup, dondur=(0, 0, 0), ust_nesne=None):
        """Merkezi nesnenin kökünde olan elipsoit (ölçek merkezden olur); ust_nesne verilirse ona bağlanır."""
        bm = bmesh.new()
        self._elips_bm(bm, Vector((0, 0, 0)), yaricap, dondur)
        ob = self._parca(eklem, ad, SINIFLAR[sinif], grup, bm)
        if ust_nesne is not None:
            ob.parent = ust_nesne
        ob.location = merkez
        return ob

    def kapsul(self, eklem, ad, p0, p1, r0, r1, sinif, grup):
        """Kesik koni ve iki uç küresi; p0'dan p1'e (eklemin yerelinde)."""
        bm = bmesh.new()
        p0, p1 = Vector(p0), Vector(p1)
        d = p1 - p0
        q = Vector((0, 0, 1)).rotation_difference(d.normalized())
        r = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=14, radius1=r0, radius2=r1, depth=d.length)
        bmesh.ops.transform(bm, matrix=Matrix.Translation(p0 + d * 0.5) @ q.to_matrix().to_4x4(), verts=r["verts"])
        for uc, rr in ((p0, r0), (p1, r1)):
            u = bmesh.ops.create_uvsphere(bm, u_segments=14, v_segments=9, radius=rr)
            bmesh.ops.transform(bm, matrix=Matrix.Translation(uc), verts=u["verts"])
        return self._parca(eklem, ad, SINIFLAR[sinif], grup, bm)

    def tutam(self, eklem, ad, taban, yon, boy, yaricap, sinif, grup):
        """Kürk topağı: yuvarlak uçlu sivrilen kapsül (kâğıt gibi diken değil)."""
        taban = np.array(taban, dtype=float)
        yon = np.array(yon, dtype=float)
        yon = yon / np.linalg.norm(yon)
        return self.kapsul(eklem, ad, tuple(taban), tuple(taban + yon * boy), yaricap, yaricap * 0.3, sinif, grup)

    def koni(self, eklem, ad, taban, yon, boy, yaricap, sinif, grup, yassi=1.0):
        """Taban noktasından yön boyunca sivrilen koni (kürk tutamı, kulak). yassi: ikinci eksende basıklık."""
        bm = bmesh.new()
        taban = Vector(taban)
        yon = Vector(yon).normalized()
        r = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=12, radius1=yaricap, radius2=0.0, depth=boy)
        bmesh.ops.transform(bm, matrix=Matrix.Diagonal((1.0, yassi, 1.0, 1.0)), verts=r["verts"])
        q = Vector((0, 0, 1)).rotation_difference(yon)
        m = Matrix.Translation(taban + yon * (boy * 0.5)) @ q.to_matrix().to_4x4()
        bmesh.ops.transform(bm, matrix=m, verts=r["verts"])
        return self._parca(eklem, ad, SINIFLAR[sinif], grup, bm)

    def agizlik(self, ad_on, taban, uc, r0, r1, sy, kafa_hs):
        """Kama biçimli burun: taban (r0) -> uç (r1); tek kapalı örgü, ekseninin altındaki yüzler krem."""
        bm = bmesh.new()
        p0, p1 = Vector(taban), Vector(uc)
        d = p1 - p0
        q = Vector((0, 0, 1)).rotation_difference(d.normalized())
        r = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=20, radius1=r0, radius2=r1, depth=d.length)
        bmesh.ops.transform(bm, matrix=Matrix.Translation(p0 + d * 0.5) @ q.to_matrix().to_4x4(), verts=r["verts"])
        for uc_, rr in ((p1, r1), (p0, r0)):
            u = bmesh.ops.create_uvsphere(bm, u_segments=20, v_segments=12, radius=rr)
            bmesh.ops.transform(bm, matrix=Matrix.Translation(uc_), verts=u["verts"])
        bmesh.ops.transform(bm, matrix=Matrix.Translation(p0) @ Matrix.Diagonal((1.0, 1.0, sy, 1.0)) @ Matrix.Translation(-p0), verts=bm.verts[:])
        for f in bm.faces:
            c = f.calc_center_median()
            ek_z = p0.z + (p1.z - p0.z) * ((c.x - p0.x) / max(d.x, 1e-6))
            f.material_index = 1 if (c.z - ek_z) < 0.06 * r0 * sy else 0
        ad = ad_on
        self._parca("kafa", ad, SINIFLAR["kurk"], "kafa", bm)
        self.cok_sinif[ad] = ["kurk", "krem"]

    def kutu(self, esya, ad, boyut, sinif, eklem="kok", merkez=(0, 0, 0)):
        """Eşya parçası: düz gölgeli kutu; poza göre görünür (esya grubu)."""
        bm = bmesh.new()
        r = bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.transform(bm, matrix=Matrix.Translation(merkez) @ Matrix.Diagonal((boyut[0], boyut[1], boyut[2], 1.0)), verts=r["verts"])
        ob = self._parca(eklem, ad, SINIFLAR[sinif], "esya_" + esya, bm, duz=True)
        ob.hide_render = True
        self.esya_adlari[ad] = esya
        return ob

    def esya_yerlestir(self, poz):
        gor = set(poz.get("esya", []))
        inv = self.kok.matrix_world.inverted()

        def yerel(ad):
            return np.array(inv @ self.eklem[ad].matrix_world.translation)

        pb = (yerel("on_sag_bilek") + yerel("on_sol_bilek")) / 2.0
        if poz.get("esya_ref") == "hedef" and getattr(self, "_son_hedef", None):
            hs_ = list(self._son_hedef.values())
            pb = np.array([sum(h_[0] for h_ in hs_) / len(hs_), pb[1], sum(h_[1] for h_ in hs_) / len(hs_)])
        yer_z = -self.kok.location.z   # kök yerel uzayında zemin
        ob = {a: o_ for o_, a, _, _ in self.parcalar}
        for ad, e in self.esya_adlari.items():
            ob[ad].hide_render = e not in gor
        if "laptop" in gor:
            tab = pb[2] - 0.03
            bx_ = pb[0] + 0.045
            ob["laptop_taban"].location = (bx_, 0, tab - 0.007)
            ob["laptop_ekran"].location = (bx_ + 0.125, 0, tab + 0.078)
            ob["laptop_ekran"].rotation_euler = (0, R(10), 0)
            ob["laptop_logo"].location = (bx_ + 0.134, 0, tab + 0.08)
            ob["laptop_logo"].rotation_euler = (0, R(10), 0)
        if "masa" in gor:
            tab = pb[2] - 0.03 - 0.014
            bx_ = pb[0] + 0.045
            ob["masa_ust"].location = (bx_, 0, tab - 0.013)
            h = (tab - 0.02) - yer_z
            for ad in ("masa_bacak_a", "masa_bacak_b", "masa_bacak_c", "masa_bacak_d"):   # tek orta ayak
                ob[ad].location = (bx_, 0, yer_z + h / 2.0)
                ob[ad].scale = (2.4, 2.4, h / 0.1)
        if "dosya" in gor:
            ob["dosya_a"].location = (pb[0] + 0.07, 0, pb[2] + 0.025)
            ob["dosya_b"].location = (pb[0] + 0.072, 0.004, pb[2] + 0.031)
            ob["dosya_a"].rotation_euler = (0, R(-8), 0)
            ob["dosya_b"].rotation_euler = (0, R(-8), R(3))

    # ---------------------------------------------------------------- model
    def _kur(self):
        o = self.o
        st = self.stil
        corap = st["corap"]
        hs, es, ls, bl, bt, sl, gz, kt = o["hs"], o["es"], o["ls"], o["bl"], o["bt"], o["sl"], o["goz"], o["kuyruk"]
        bx = bt ** 0.5
        ik, kb, pb_ = o["ince"], o["kuyruk_boy"], o["pati_boy"]
        paw_s = corap if corap in ("krem", "koyu", "kurk") else "koyu"
        H0 = 0.40 * ls

        # --- eklemler (dinlenme pozu: omurga +X, bacaklar aşağı, kuyruk -X)
        self._eklem("kalca", "kok", (0, 0, H0))
        self._eklem("bel", "kalca", (0.16 * bl, 0, 0.0))
        self._eklem("gogus", "bel", (0.16 * bl, 0, 0.0))
        self._eklem("boyun", "gogus", (0.095 * bl, 0, 0.05))
        self._eklem("kafa", "boyun", (0.07, 0, 0.04))
        self._eklem("cene", "kafa", (0.06 * hs, 0, -0.04 * hs))
        for ad, sg in (("sag", -1), ("sol", 1)):
            self._eklem(f"kulak_{ad}", "kafa", (0.02 * hs, sg * 0.056 * hs, 0.042 * hs))
        seg = 0.042 * kb
        ns = int(o.get("kuyruk_sayi", 1))
        sira = [0.0, -0.25, 0.25, -0.5, 0.5, -0.75, 0.75, -1.0, 1.0]
        self.kuyruklar = []    # (önek, yelpaze konumu u: -1..1; ilki ortada)
        for k in range(ns):
            on = "kuyruk" if k == 0 else f"kuyruk{k}"
            u = sira[k] if ns > 1 else 0.0
            self._eklem(f"{on}_0", "kalca", (-0.10, u * 0.035, 0.035))
            for i in range(1, 10):
                self._eklem(f"{on}_{i}", f"{on}_{i-1}", (-seg, 0, 0))
            self.kuyruklar.append((on, u))
        for ad, sg in (("sag", -1), ("sol", 1)):
            self._eklem(f"on_{ad}_om", "gogus", (0.016, sg * 0.068 * bt, -0.064 * bt))
            self._eklem(f"on_{ad}_dirsek", f"on_{ad}_om", (0, 0, -0.14 * ls))
            self._eklem(f"on_{ad}_bilek", f"on_{ad}_dirsek", (0, 0, -0.12 * ls))
            self._eklem(f"arka_{ad}_kalca", "kalca", (0.0, sg * 0.074 * bt, -0.03))
            self._eklem(f"arka_{ad}_diz", f"arka_{ad}_kalca", (0, 0, -0.12 * ls))
            self._eklem(f"arka_{ad}_topuk", f"arka_{ad}_diz", (0, 0, -0.12 * ls))
            self._eklem(f"arka_{ad}_pati", f"arka_{ad}_topuk", (0, 0, -0.10 * ls))
        bpy.context.view_layer.update()
        self.rest_konum = {j: np.array(e.matrix_world.translation) for j, e in self.eklem.items()}
        self.rest_ters = {j: np.linalg.inv(np.array(e.matrix_world)) for j, e in self.eklem.items()}
        P = self.rest_konum

        def at(j, dx=0.0, dy=0.0, dz=0.0):
            return P[j] + np.array([dx, dy, dz])

        # --- gövde + boyun + kafa (tek yüzey)
        e = []
        e.append((at("kalca", -0.01), (0.125 * bx, 0.095 * bt, 0.108 * bt), "kurk", "govde", 1.0))
        e.append((at("bel", 0, 0, -0.008), (0.118 * bx, 0.088 * bt, 0.09 * bt), "kurk", "govde", 1.0))
        e.append((at("gogus", 0.022), (0.125 * bx, 0.1 * bt, 0.112 * bt), "kurk", "govde", 1.0))
        e.append((at("bel", 0, 0, -0.058 * bt), (0.14, 0.05 * bt, 0.036 * bt), "krem", "govde", 0.9))
        e.append((at("gogus", 0.074, 0, -0.026), (0.058 * bx, 0.052 * bt, 0.078 * bt), "krem", "govde", 0.9))
        e.append((at("boyun", 0.02), (0.092 * (0.6 + 0.4 * ik), 0.074 * bt * (0.6 + 0.4 * ik), 0.088 * (0.6 + 0.4 * ik)), "kurk", "kafa", 1.0))
        e.append((at("boyun", 0.05, 0, -0.028), (0.058 * (0.6 + 0.4 * ik), 0.062 * (0.6 + 0.4 * ik), 0.066 * (0.6 + 0.4 * ik)), "krem", "kafa", 0.9))
        nose_x = 0.072 * hs + 0.10 * sl + 0.05
        e.append((at("kafa", 0.052 * hs), (0.096 * hs, 0.09 * hs, 0.076 * hs), "kurk", "kafa", 1.0))
        e.append((at("kafa", 0.094 * hs, 0, -0.006 * hs), (0.05 * hs, 0.042 * hs, 0.04 * hs), "kurk", "kafa", 1.0))
        for sg in (-1, 1):       # yanak tüyü dolgusu (krem)
            e.append((at("kafa", 0.078 * hs, sg * 0.052 * hs, -0.036 * hs), (0.062 * hs, 0.03 * hs, 0.036 * hs), "krem", "kafa", 0.84))
            e.append((at("kafa", 0.03 * hs, sg * 0.062 * hs, -0.046 * hs), (0.05 * hs, 0.026 * hs, 0.034 * hs), "krem", "kafa", 0.9))
        self.ciltler.append(Cilt(self, "govde", ["kalca", "bel", "gogus", "boyun", "kafa"], e))

        # --- kuyruk
        yar = [0.040, 0.054, 0.070, 0.084, 0.092, 0.092, 0.082, 0.062, 0.038, 0.014]
        for on, u in self.kuyruklar:
            e = []
            for i in range(10):
                r = yar[i] * kt * (1 + o.get("tuy", 0.5) * 0.09 * (1 if i % 2 else -1) * (1 if 1 < i < 9 else 0))
                e.append((at(f"{on}_{i}", -seg * 0.5), (seg * 1.55, r, r), st.get("kuyruk_uc", "krem") if i >= st.get("uc_bas", 7) else "kurk", "kuyruk", 1.0))
            self.ciltler.append(Cilt(self, on, [f"{on}_{i}" for i in range(10)], e, kucul=0.95))

        # --- bacaklar
        for ad, sg in (("sag", -1), ("sol", 1)):
            g = f"on_{ad}"
            e = [(at(f"on_{ad}_om", 0, 0, -0.025), (0.042 * ik, 0.036 * ik, 0.062), "kurk", g, 1.0),
                 (at(f"on_{ad}_om", 0, 0, -0.09 * ls), (0.034 * ik, 0.03 * ik, 0.07 * ls), "kurk", g, 1.0),
                 (at(f"on_{ad}_dirsek", 0, 0, 0), (0.032 * ik, 0.028 * ik, 0.032 * ik), "kurk", g, 1.0),
                 (at(f"on_{ad}_dirsek", 0, 0, -0.06 * ls), (0.027 * ik, 0.024 * ik, 0.065 * ls), paw_s, g, 1.0),
                 (at(f"on_{ad}_bilek", 0.018, 0, -0.011), (0.04 * (0.7 + 0.3 * ik), 0.028 * ik ** 0.5, 0.024 * ik ** 0.5), paw_s, g, 1.0)]
            self.ciltler.append(Cilt(self, f"on_{ad}", [f"on_{ad}_om", f"on_{ad}_dirsek", f"on_{ad}_bilek"], e, cozunurluk=0.005))
            g = f"arka_{ad}"
            e = [(at(f"arka_{ad}_kalca", 0, 0, -0.05 * ls), (0.092 * ik ** 0.5, 0.058 * ik ** 0.7, 0.108 * ls), "kurk", g, 1.0),
                 (at(f"arka_{ad}_kalca", 0, 0, -0.11 * ls), (0.05 * ik, 0.04 * ik, 0.06 * ls), "kurk", g, 1.0),
                 (at(f"arka_{ad}_diz", 0, 0, 0), (0.04 * ik, 0.034 * ik, 0.04 * ik), "kurk", g, 1.0),
                 (at(f"arka_{ad}_diz", 0, 0, -0.06 * ls), (0.032 * ik, 0.026 * ik, 0.07 * ls), "kurk", g, 1.0),
                 (at(f"arka_{ad}_topuk", 0, 0, 0), (0.028 * ik, 0.026 * ik, 0.03 * ik), "kurk", g, 1.0),
                 (at(f"arka_{ad}_topuk", 0, 0, -0.05 * ls), (0.022 * ik, 0.02 * ik, 0.055 * ls), paw_s, g, 1.0),
                 (at(f"arka_{ad}_pati", 0.022 * pb_, 0, -0.012), (0.04 * pb_, 0.026 * ik ** 0.5, 0.022 * ik ** 0.5), paw_s, g, 1.0)]
            self.ciltler.append(Cilt(self, f"arka_{ad}", [f"arka_{ad}_kalca", f"arka_{ad}_diz", f"arka_{ad}_topuk", f"arka_{ad}_pati"], e,
                                     cozunurluk=0.005))

        # --- kulaklar: tek eklemli pürüzsüz yüzey (kürk taban, koyu uç, ön yüzde pembe iç)
        for ad, sg in (("sag", -1), ("sol", 1)):
            ek_ = es * hs ** 0.4 * o.get("kulak_en", 1.0)
            d = np.array([-0.12, sg * 0.34, 1.0])
            d = d / np.linalg.norm(d)
            h_ = 0.19 * es
            taban = at(f"kulak_{ad}", 0, 0, -0.03)
            e = []
            for i in range(5):
                tt = i / 4.0
                m = taban + d * h_ * tt * 0.92
                rx = 0.062 * ek_ * (1 - 0.82 * tt)
                ry = 0.03 * ek_ * (1 - 0.72 * tt)
                e.append((m, (rx, ry, h_ * 0.2), "koyu" if tt >= 0.55 else "kurk", "kulak_" + ad, 1.0))
            for tt in (0.18, 0.4, 0.62):
                m = taban + d * h_ * tt * 0.92 + np.array([0.02 * hs * (1 - tt * 0.5), -sg * 0.004, 0])
                e.append((m, (0.04 * ek_ * (1 - 0.8 * tt), 0.022 * ek_, h_ * 0.18), "kulak_ic", "kulak_" + ad, 0.7))
            self.ciltler.append(Cilt(self, f"kulak_{ad}", [f"kulak_{ad}"], e, cozunurluk=0.0045, kucul=0.95))

        # --- rijit parçalar: burun, çene, gözler, kulaklar, tüyler
        if st.get("alin_tasi"):
            self.elips("kafa", "alin_tasi", (0.075 * hs, 0, 0.07 * hs), (0.024 * hs, 0.011 * hs, 0.009 * hs), "isaret", "kafa", dondur=(0, -30, 0))
        if st.get("tilki_atesi"):   # tilki ateşi: üç üst üste daralan elipsoitten alev
            for k, (x, y, z, r) in enumerate(((-0.30, 0.24, 0.40, 0.030), (0.04, -0.30, 0.58, 0.025), (-0.16, -0.04, 0.82, 0.021))):
                for j, (f, dz, dx) in enumerate(((1.0, 0.0, 0.0), (0.72, 0.95, 0.15), (0.42, 1.75, 0.38))):
                    ad_ = f"ates_{k}_{j}"
                    ob_ = self.elips_m("kok", ad_, (x + dx * r, y, z + dz * r), (r * f, r * f, r * f * 1.15), "isaret", "esya_ates")
                    ob_.hide_render = True
                    self.esya_adlari[ad_] = "ates"
        burun_x = 0.072 * hs + 0.10 * sl + 0.05
        self.agizlik("agizlik", (0.1 * hs, 0, -0.012 * hs), (burun_x - 0.012, 0, -0.024 * hs), 0.05 * hs, 0.024 * hs, 0.82, hs)
        self.elips("kafa", "burun_ucu", (burun_x + 0.006, 0, -0.019 * hs), (0.019 * hs, 0.023 * hs, 0.017 * hs), "burun", "kafa")
        self.elips("cene", "cene_g", (0.03 * hs + 0.02 * sl, 0, -0.004), (0.045 * hs + 0.012 * sl, 0.026 * hs, 0.014 * hs), "krem", "kafa")
        self.elips("kafa", "agiz_ici", (0.092 * hs, 0, -0.036 * hs), (0.042 * hs, 0.02 * hs, 0.008 * hs), "agiz", "kafa")
        tuy = o.get("tuy", 0.5)
        gt = st.get("goz_tip", "parlak")
        self.gozler = []
        self.kapaklar = []
        for ad, sg in (("sag", -1), ("sol", 1)):
            # göz: kafatasının yüzeyinde, öne-yana bakar; bebek, parlama ve kapak göze bağlı
            yuvarlak = st.get("bebek") == "yuvarlak"
            g_yar = (0.0125 * gz, 0.0065 * gz, 0.0168 * gz) if yuvarlak else (0.012 * gz, 0.0065 * gz, 0.019 * gz)
            g_ob = self.elips_m("kafa", f"goz_{ad}", (0.113 * hs, sg * 0.053 * hs, 0.024 * hs), g_yar, "goz", "kafa")
            g_ob.rotation_euler = (0, 0, R(sg * -43))
            if gt == "iris":
                if yuvarlak:   # dost bakış: büyük yuvarlak bebek
                    self.elips_m("kafa", f"goz_bebek_{ad}", (0.0015 * gz, sg * 0.0042 * gz, -0.0006 * gz), (0.0083 * gz, 0.0037 * gz, 0.0108 * gz), "goz_bebek",
                                 "kafa", ust_nesne=g_ob)
                else:          # yarık bebek
                    self.elips_m("kafa", f"goz_bebek_{ad}", (0.0015 * gz, sg * 0.0044 * gz, 0.0), (0.0034 * gz, 0.0036 * gz, 0.0145 * gz), "goz_bebek",
                                 "kafa", ust_nesne=g_ob)
            io = st.get("isik_olcek", 1.0)
            h_ob = self.elips_m("kafa", f"goz_isik_{ad}", (0.0035 * gz, sg * 0.0064 * gz, 0.0068 * gz), (0.0034 * gz * io, 0.0022 * gz, 0.0045 * gz * io),
                                "goz_isik", "kafa", ust_nesne=g_ob)
            k_ob = self.elips_m("kafa", f"goz_kapak_{ad}", (0, sg * 0.0006 * gz, 0.04 * gz), (0.0142 * gz, 0.0074 * gz, 0.021 * gz), "kurk", "kafa",
                                ust_nesne=g_ob)
            k_ob.hide_render = True
            self.kapaklar.append((k_ob, 0.019 * gz))
            self.gozler.append((g_ob, h_ob))
            k_ = 0.6 + 0.8 * tuy
            self.tutam("kafa", f"yanak_tuy_{ad}_0", (0.04 * hs, sg * 0.062 * hs, -0.036 * hs), (-0.9, sg * 0.4, -0.45), 0.06 * hs * k_, 0.024 * hs * k_, "krem", "kafa")
            if tuy > 0.6:
                self.tutam("kafa", f"yanak_tuy_{ad}_1", (0.02 * hs, sg * 0.058 * hs, -0.056 * hs), (-0.7, sg * 0.35, -0.8), 0.05 * hs * k_, 0.02 * hs * k_, "krem", "kafa")
        if tuy > 0.6:   # göğüs yakası: aşağı sarkan tutamlar
            for k, sg in enumerate((-1, 0, 1)):
                self.tutam("gogus", f"yaka_{k}", (0.1 * bx, sg * 0.03 * bt, -0.085 * bt), (0.2, sg * 0.25, -1.0), 0.05 * tuy, 0.022 * (0.6 + tuy), "krem", "govde")
        for k, (yy, zz, dy, dz) in enumerate(((0, 0.0, 0.0, 0.0), (0.012, 0.016, 0.25, 0.55), (-0.012, -0.012, -0.25, -0.5)) if st.get("kuyruk_tuy", True) else ()):
            self.tutam("kuyruk_9", f"kuyruk_tuy{k}", (-seg * 0.3, yy, zz), (-1.0, dy, dz), 0.045 * kt, 0.024 * kt, st.get("kuyruk_uc", "krem"), "kuyruk")
        # --- eşyalar (poza göre görünür)
        d_ = self.elips("cene", "dil_g", (0.07 * hs, 0, -0.012 * hs), (0.045 * hs, 0.02 * hs, 0.009 * hs), "dil", "kafa", dondur=(0, 18, 0))
        d_.hide_render = True
        self.esya_adlari["dil_g"] = "dil"
        self.kutu("laptop", "laptop_taban", (0.24, 0.18, 0.014), "esya_orta")
        self.kutu("laptop", "laptop_ekran", (0.014, 0.23, 0.155), "esya_orta")
        self.kutu("laptop", "laptop_logo", (0.004, 0.04, 0.04), "esya_isik")
        self.kutu("masa", "masa_ust", (0.36, 0.24, 0.026), "esya_ahsap")
        for k in "abcd":
            self.kutu("masa", f"masa_bacak_{k}", (0.022, 0.022, 0.1), "esya_ahsap")
        self.kutu("dosya", "dosya_a", (0.12, 0.09, 0.006), "esya_acik")
        self.kutu("dosya", "dosya_b", (0.12, 0.09, 0.006), "esya_acik")
        bpy.context.view_layer.update()

    # ---------------------------------------------------------------- poz
    def sirala(self):
        sira = []
        gorulen = set()

        def ekle(a):
            if a in gorulen:
                return
            u = self.ust[a]
            if u:
                ekle(u)
            gorulen.add(a)
            sira.append(a)

        for a in self.eklem:
            ekle(a)
        return sira

    def _eklemleri_kur(self, poz, ek_pitch=0.0):
        a = dict(poz.get("a", {}))
        yaw0 = dict(poz.get("yaw", {}))
        if len(getattr(self, "kuyruklar", [])) > 1:
            ys, ps = poz.get("kuyruk_yelpaze", (35.0, 20.0))
            for on, u in self.kuyruklar[1:]:
                for i in range(10):
                    if f"kuyruk_{i}" in a:
                        a[f"{on}_{i}"] = a[f"kuyruk_{i}"] + ps * abs(u)
                    yaw0[f"{on}_{i}"] = yaw0.get(f"kuyruk_{i}", 0.0) * (1.0 + 0.08 * u) + (ys * u if i == 0 else 0.0)
        if ek_pitch:
            a = {k: v + ek_pitch for k, v in a.items()}
            a.setdefault("kalca", ek_pitch)
        yaw = yaw0
        roll = poz.get("roll", {})
        kay = poz.get("kay", {})
        dunya = {}
        for ad in self.sirala():
            e = self.eklem[ad]
            u = self.ust[ad]
            ust_a = dunya.get(u, 0.0) if u else 0.0
            w = a.get(ad, ust_a)
            dunya[ad] = w
            e.rotation_euler = (R(roll.get(ad, 0.0)), R(w - ust_a), R(yaw.get(ad, 0.0)))
            d = kay.get(ad, (0, 0, 0))
            e.location = self.dinlenme[ad] + Vector(d)
        self.kok.rotation_euler = (0, 0, R(-self.stil["yaw"] + poz.get("govde_yaw", 0.0)))
        self.kok.location = (0, 0, 0)
        bpy.context.view_layer.update()
        for c in self.ciltler:
            c.poz()

    def _pati_tabani(self, on):
        """Ön ya da arka patilerin en alçak noktası, kökün yerel uzayında (x, z)."""
        inv = np.linalg.inv(np.array(self.kok.matrix_world))
        en = None
        for c in self.ciltler:
            if not c.ad.startswith("on_" if on else "arka_"):
                continue
            v = c.dunya @ inv[:3, :3].T + inv[:3, 3]
            i = v[:, 2].argmin()
            if en is None or v[i, 2] < en[1]:
                en = (v[i, 0], v[i, 2])
        return en

    def _on_ik(self, poz):
        """Ön patileri yere koyar (iki kemikli ters kinematik, yan düzlemde; dirsek geriye bükülür).
        poz["ik_on"] = {"sag": dx, "sol": dx}: pati hedefi omzun dx önünde, zeminde. ik_govde: yetmezse gövde öne eğilir."""
        ik = poz.get("ik_on")
        if not ik:
            return poz
        poz = dict(poz)
        poz["a"] = dict(poz.get("a", {}))
        L1 = self.dinlenme["on_sag_dirsek"].length
        L2 = self.dinlenme["on_sag_bilek"].length
        h = 0.034 * self.o.get("ince", 1.0) ** 0.5   # bilekten pati tabanına
        for _ in range(10):
            self._eklemleri_kur(poz)
            inv = np.linalg.inv(np.array(self.kok.matrix_world))
            g = 1e9
            for c in self.ciltler:
                if not c.ad.startswith("on_"):
                    v = c.dunya @ inv[:3, :3].T + inv[:3, 3]
                    g = min(g, v[:, 2].min())
            cozum = {}
            eksik = 0.0
            for s_, dx in ik.items():
                S = inv @ np.append(np.array(self.eklem[f"on_{s_}_om"].matrix_world.translation), 1.0)
                Sx, Sz = S[0], S[2]
                Tx, Tz = Sx + dx, g + h
                d = math.hypot(Tx - Sx, Tz - Sz)
                eksik = max(eksik, d - (L1 + L2) * 0.995)
                cozum[s_] = (Sx, Sz, Tx, Tz)
            if eksik <= 0 or not poz.get("ik_govde"):
                break
            for j in ("kalca", "bel", "gogus"):
                poz["a"][j] = poz["a"].get(j, 0.0) + 3.0
        for s_, (Sx, Sz, Tx, Tz) in cozum.items():
            d = min(max(math.hypot(Tx - Sx, Tz - Sz), abs(L1 - L2) + 1e-4), (L1 + L2) * 0.995)
            th = math.atan2(Tz - Sz, Tx - Sx)
            al = math.acos(max(-1.0, min(1.0, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d))))
            Ex, Ez = Sx + L1 * math.cos(th - al), Sz + L1 * math.sin(th - al)
            ux, uz = Ex - Sx, Ez - Sz
            wx, wz = Tx - Ex, Tz - Ez
            poz["a"][f"on_{s_}_om"] = math.degrees(math.atan2(-ux, -uz))
            poz["a"][f"on_{s_}_dirsek"] = math.degrees(math.atan2(-wx, -wz))
            poz["a"][f"on_{s_}_bilek"] = poz["a"].get(f"on_{s_}_bilek_hedef", 0.0)
        return poz

    def _ayak_ik(self, poz):
        """poz["ayak"] = {"on_sag": {"x" | "dx", "z", "p"}, "arka_sol": {"x" | "dx", "z", "m", "p"}}: pati tabanı hedefi (kökün yerelinde;
        dx: omuz/kalça eklemine göre). Ön bacak iki kemik (dirsek geride), arka bacak üç kemik: tarak açısı m verilir, diz önde."""
        hed = poz.get("ayak")
        if not hed:
            return poz
        poz = dict(poz)
        poz["a"] = dict(poz.get("a", {}))
        self._eklemleri_kur(poz)
        inv = np.linalg.inv(np.array(self.kok.matrix_world))
        h = 0.034 * self.o.get("ince", 1.0) ** 0.5
        self._son_hedef = {}

        def yerel(j):
            v = inv @ np.append(np.array(self.eklem[j].matrix_world.translation), 1.0)
            return v[0], v[2]

        def iki_kemik(Sx, Sz, Tx, Tz, L1, L2, diz_onde):
            d = min(max(math.hypot(Tx - Sx, Tz - Sz), abs(L1 - L2) + 1e-4), (L1 + L2) * 0.998)
            th = math.atan2(Tz - Sz, Tx - Sx)
            al = math.acos(max(-1.0, min(1.0, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d))))
            ex = th + al if diz_onde else th - al
            Ex, Ez = Sx + L1 * math.cos(ex), Sz + L1 * math.sin(ex)
            return Ex, Ez

        def aci(vx, vz):
            return math.degrees(math.atan2(-vx, -vz))

        for bacak, hd in hed.items():
            on = bacak.startswith("on_")
            s_ = bacak.split("_")[1]
            if on:
                Sx, Sz = yerel(f"on_{s_}_om")
                Tx = Sx + hd["dx"] if "dx" in hd else hd["x"]
                Tz = hd["z"] + h
                self._son_hedef[s_] = (Tx, hd.get("z0", hd["z"]) + h)
                L1 = self.dinlenme[f"on_{s_}_dirsek"].length
                L2 = self.dinlenme[f"on_{s_}_bilek"].length
                Ex, Ez = iki_kemik(Sx, Sz, Tx, Tz, L1, L2, False)
                poz["a"][f"on_{s_}_om"] = aci(Ex - Sx, Ez - Sz)
                poz["a"][f"on_{s_}_dirsek"] = aci(Tx - Ex, Tz - Ez)
                poz["a"][f"on_{s_}_bilek"] = hd.get("p", 0.0)
            else:
                Sx, Sz = yerel(f"arka_{s_}_kalca")
                Px = Sx + hd["dx"] if "dx" in hd else hd["x"]
                Pz = hd["z"] + h
                m = hd.get("m", -12.0)
                L1 = self.dinlenme[f"arka_{s_}_diz"].length
                L2 = self.dinlenme[f"arka_{s_}_topuk"].length
                L3 = self.dinlenme[f"arka_{s_}_pati"].length
                vx, vz = -math.sin(math.radians(m)), -math.cos(math.radians(m))
                Hx, Hz = Px - L3 * vx, Pz - L3 * vz
                Ex, Ez = iki_kemik(Sx, Sz, Hx, Hz, L1, L2, True)
                poz["a"][f"arka_{s_}_kalca"] = aci(Ex - Sx, Ez - Sz)
                poz["a"][f"arka_{s_}_diz"] = aci(Hx - Ex, Hz - Ez)
                poz["a"][f"arka_{s_}_topuk"] = m
                poz["a"][f"arka_{s_}_pati"] = hd.get("p", 0.0)
        return poz

    def coz(self, poz):
        """Pozu çözümler: ters kinematik, dengeleme ve zemine oturtma sabitlenir; her eklemin dünya pitch'i, yaw ve roll'u açık yazılır.
        Dönen pozda yer None (zemin kalçanın kaymasına gömülü); pozlar arası karıştırmaya uygun."""
        poz = self._on_ik(poz)
        poz = self._ayak_ik(poz)
        ek = 0.0
        self._eklemleri_kur(poz, ek)
        if poz.get("dengele"):
            for _ in range(4):
                xf, zf = self._pati_tabani(True)
                xh, zh = self._pati_tabani(False)
                ek += math.degrees(math.atan2(zf - zh, xf - xh))
                self._eklemleri_kur(poz, ek)
        a = poz.get("a", {})
        tam = {}
        for ad in self.sirala():
            u = self.ust[ad]
            if u is None:
                continue
            tam[ad] = a.get(ad, tam.get(u, 0.0)) + (ek if ad in a or u == "kok" else 0.0)
        # (miras alanlar üst eklemin değerini zaten ek dahil alır)
        yaw = {j: poz.get("yaw", {}).get(j, 0.0) for j in tam}
        roll = {j: poz.get("roll", {}).get(j, 0.0) for j in tam}
        cikti = dict(poz)
        cikti.update(a=tam, yaw=yaw, roll=roll, dengele=False)
        cikti.pop("ik_on", None)
        cikti.pop("ayak", None)
        kay = {k: tuple(v) for k, v in poz.get("kay", {}).items()}
        yer = poz.get("yer", "tum")
        if yer:
            self._eklemleri_kur(cikti)
            kz = -self.en_alcak(yer) + poz.get("yukselt", 0.0)
            k0 = kay.get("kalca", (0.0, 0.0, 0.0))
            kay["kalca"] = (k0[0], k0[1], k0[2] + kz)
        cikti["kay"] = kay
        cikti["yer"] = None
        cikti["yukselt"] = 0.0
        return cikti

    def poz_uygula(self, poz):
        """poz: {"a": {eklem: dünya pitch derece}, "yaw": {eklem: derece}, "roll": {...}, "kay": {eklem: (dx,dy,dz)},
                 "yer": 'tum'|'pati'|None, "yukselt": m, "govde_yaw": derece (kök), "dengele": ön ve arka patiyi yere eşitle,
                 "goz": göz dikey ölçeği, "kapak": göz kapağı 0-1, "ik_on": ön patileri yere koy}"""
        poz = self._on_ik(poz)
        poz = self._ayak_ik(poz)
        ek = 0.0
        self._eklemleri_kur(poz, ek)
        if poz.get("dengele"):
            for _ in range(4):
                xf, zf = self._pati_tabani(True)
                xh, zh = self._pati_tabani(False)
                ek += math.degrees(math.atan2(zf - zh, xf - xh))
                self._eklemleri_kur(poz, ek)
        gs = poz.get("goz", 1.0)
        kp = poz.get("kapak", 0.0)
        for g_ob, h_ob in getattr(self, "gozler", []):
            g_ob.scale = (1, 1, gs)
            h_ob.hide_render = gs < 0.4 or kp > 0.3
        for k_ob, rz in getattr(self, "kapaklar", []):
            k_ob.hide_render = kp <= 0.0
            k_ob.location.z = rz * (1 - 2 * kp) + 0.021 / 0.019 * rz * 1.0
        bpy.context.view_layer.update()
        yer = poz.get("yer", "tum")
        yuk = poz.get("yukselt", 0.0)
        kz = 0.0
        if yer:
            kz = -self.en_alcak(yer) + yuk
            self.kok.location.z = kz
            bpy.context.view_layer.update()
        for c in self.ciltler:
            c.yaz(kz)
        self.esya_yerlestir(poz)
        # çapa: belli bir nokta (eklem ya da omuzun önündeki kenar köşesi) karede sabit bir yere iğnelenir
        if poz.get("capa") and poz.get("capa_hedef") and getattr(self, "kamera_k", None) and not poz.get("_capa_tamam"):
            hedef = self.kare_noktasi(*poz["capa_hedef"])
            simdiki = self.capa_noktasi(poz["capa"])
            d = hedef - simdiki
            Rk = np.array(self.kok.matrix_world)[:3, :3]
            dl = Rk.T @ d
            p2 = dict(poz)
            p2["kay"] = dict(poz.get("kay", {}))
            k0 = p2["kay"].get("kalca", (0.0, 0.0, 0.0))
            p2["kay"]["kalca"] = (k0[0] + dl[0], k0[1] + dl[1], k0[2] + dl[2])
            p2["yer"] = None
            p2["_capa_tamam"] = True
            self.poz_uygula(p2)

    def capa_noktasi(self, capa):
        """Çapanın dünyadaki yeri: eklemin kendisi ya da (kenar_dx verilirse) eklemin kök-yerel x'inin dx önünde, zeminde (z = 0) nokta."""
        e = self.eklem[capa["eklem"]]
        if "ofs" in capa:   # eklemden kökün yerel eksenlerinde kaydırılmış nokta (ör. boynun arkası: ense)
            Rk = np.array(self.kok.matrix_world)[:3, :3]
            return np.array(e.matrix_world.translation) + Rk @ np.array(capa["ofs"])
        if "kenar_dx" not in capa:
            return np.array(e.matrix_world.translation)
        M = np.array(self.kok.matrix_world)
        yerel = np.linalg.inv(M) @ np.append(np.array(e.matrix_world.translation), 1.0)
        return (M @ np.array([yerel[0] + capa["kenar_dx"], 0.0, 0.0, 1.0]))[:3]

    def kare_noktasi(self, fx, fy):
        """Karede (fx, fy) oranındaki noktanın y = 0 düzlemindeki dünya yeri (ortografik kamera, kamera_k sözlüğü)."""
        k = self.kamera_k
        p = math.radians(k["egim"])
        sx = k["cx"] + (fx - 0.5) * k["genislik"] / k["ppu"]
        sy = k["cy"] - (fy - 0.5) * k["yukseklik"] / k["ppu"]
        return np.array([sx, 0.0, sy / math.cos(p)])

    def capa_orani(self, capa):
        """Çapanın karedeki yeri (oran)."""
        k = self.kamera_k
        p = math.radians(k["egim"])
        w = self.capa_noktasi(capa)
        sy = w[1] * math.sin(p) + w[2] * math.cos(p)
        return (0.5 + (w[0] - k["cx"]) * k["ppu"] / k["genislik"], 0.5 - (sy - k["cy"]) * k["ppu"] / k["yukseklik"])

    def en_alcak(self, mod):
        z = 1e9
        for c in self.ciltler:
            if mod == "pati" and not c.ad.startswith(("on_", "arka_")):
                continue
            z = min(z, c.dunya[:, 2].min())
        for ob, ad, sinif, grup in self.parcalar:
            if mod == "pati" or ad in self.esya_adlari:
                continue
            m = np.array(ob.matrix_world)
            v = self.yerel_koseler[ad]
            zz = (v @ m[:3, :3].T + m[:3, 3])[:, 2]
            z = min(z, zz.min())
        return z

    def dunya_koseler(self):
        tum = []
        for c in self.ciltler:
            tum.append(c.dunya)
        for ob, ad, sinif, grup in self.parcalar:
            if ob.hide_render:
                continue
            m = np.array(ob.matrix_world)
            v = self.yerel_koseler[ad]
            tum.append(v @ m[:3, :3].T + m[:3, 3])
        return np.concatenate(tum)


# -------------------------------------------------------------------- sahne, malzeme, kamera
def sahne_kur():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x = KARE_W * SS
    sc.render.resolution_y = KARE_H * SS
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = True
    sc.render.filter_size = 0.0
    sc.view_settings.view_transform = "Raw"
    sc.view_settings.look = "None"
    sc.display_settings.display_device = "sRGB"
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.render.image_settings.color_depth = "16"
    sc.render.dither_intensity = 0.0
    try:
        sc.eevee.taa_render_samples = 1
    except Exception:
        pass
    return sc


def _id_malzeme(ad, sinif, parca_no, kamera_uzak, derin):
    m = bpy.data.materials.new(f"id_{ad}")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    cikis = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    cb = nt.nodes.new("ShaderNodeCombineColor")
    cb.mode = "RGB"
    cam = nt.nodes.new("ShaderNodeCameraData")
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = kamera_uzak - derin
    mr.inputs["From Max"].default_value = kamera_uzak + derin
    mr.inputs["To Min"].default_value = 0.0
    mr.inputs["To Max"].default_value = 1.0
    cb.inputs["Red"].default_value = sinif / 255.0
    cb.inputs["Green"].default_value = parca_no / 255.0
    nt.links.new(cam.outputs["View Z Depth"], mr.inputs["Value"])
    nt.links.new(mr.outputs["Result"], cb.inputs["Blue"])
    nt.links.new(cb.outputs["Color"], em.inputs["Color"])
    nt.links.new(em.outputs["Emission"], cikis.inputs["Surface"])
    return m


def malzemeler(tilki, kamera_uzak, derin=1.5):
    """Kimlik malzemeleri: R = sınıf/255, G = parça/255, B = derinlik (0-1). Döner: (beyaz malzeme, parça->grup adı)."""
    no = 0
    parca_grup = {}
    for ob, ad, sinif, grup in tilki.parcalar:
        for sn in tilki.cok_sinif.get(ad, [None]):
            no += 1
            ob.data.materials.append(_id_malzeme(f"{ad}_{sn}", SINIFLAR[sn] if sn else sinif, no, kamera_uzak, derin))
            parca_grup[no] = grup
    for c in tilki.ciltler:
        for (sn, grup) in c.slotlar:
            no += 1
            c.ob.data.materials.append(_id_malzeme(f"{c.ad}_{sn}_{grup}", SINIFLAR[sn], no, kamera_uzak, derin))
            parca_grup[no] = grup
    m = bpy.data.materials.new("isik_beyaz")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    cikis = nt.nodes.new("ShaderNodeOutputMaterial")
    df = nt.nodes.new("ShaderNodeBsdfDiffuse")
    df.inputs["Color"].default_value = (1, 1, 1, 1)
    nt.links.new(df.outputs["BSDF"], cikis.inputs["Surface"])
    return m, parca_grup


def isik_kur():
    sc = bpy.context.scene
    # ana ışık: yukarıdan, kameradan bakınca sol-önden
    anadir = Vector((-0.42, -0.70, 0.60)).normalized()   # yüzeyden ışığa
    g = bpy.data.lights.new("ana", "SUN")
    g.energy = 3.0
    g.angle = R(3)
    ob = bpy.data.objects.new("ana", g)
    bpy.context.scene.collection.objects.link(ob)
    ob.rotation_euler = (-anadir).to_track_quat("-Z", "Y").to_euler()
    # dolgu: sağ-arkadan zayıf
    dolgu = Vector((0.7, 0.45, 0.35)).normalized()
    g2 = bpy.data.lights.new("dolgu", "SUN")
    g2.energy = 0.55
    g2.angle = R(30)
    g2.use_shadow = False
    ob2 = bpy.data.objects.new("dolgu", g2)
    bpy.context.scene.collection.objects.link(ob2)
    ob2.rotation_euler = (-dolgu).to_track_quat("-Z", "Y").to_euler()
    # çevre: hafif
    w = bpy.data.worlds.new("dunya")
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.5, 0.5, 0.5, 1)
    bg.inputs["Strength"].default_value = 0.35
    sc.world = w


def kamera_kur(egim, ppu, hedef):
    """Ortografik: egim derece (aşağı bakış), ppu = dünya birimi başına piksel (64'lük karede), hedef = görüntü merkezi."""
    cam = bpy.data.cameras.new("kamera")
    cam.type = "ORTHO"
    cam.ortho_scale = KARE_W / ppu
    cam.clip_start = 0.1
    cam.clip_end = 40.0
    ob = bpy.data.objects.new("kamera", cam)
    bpy.context.scene.collection.objects.link(ob)
    p = R(egim)
    ileri = Vector((0, math.cos(p), -math.sin(p)))
    ob.location = Vector(hedef) - ileri * MERKEZ_YUKSEK
    ob.rotation_euler = ileri.to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = ob
    return ob


def ekran_sinirlari(tilki, egim):
    """Dünya köşelerinin ekran koordinatları (x sağ, y yukarı), kamera hedef orijin ve ppu=1 için."""
    v = tilki.dunya_koseler()
    p = R(egim)
    yukari = np.array([0, math.sin(p), math.cos(p)])
    sx = v[:, 0]
    sy = v @ yukari
    return sx.min(), sx.max(), sy.min(), sy.max()


def _png_oku(yol):
    im = bpy.data.images.load(yol)
    im.colorspace_settings.name = "Non-Color"
    w, h = im.size
    a = np.empty(w * h * 4, dtype=np.float32)
    im.pixels.foreach_get(a)
    bpy.data.images.remove(im)
    return a.reshape(h, w, 4)[::-1]   # üst satır önce


def kare_render(tilki, ham_dizin, ad, beyaz_mat):
    sc = bpy.context.scene
    vl = bpy.context.view_layer
    gecici = os.path.join(ham_dizin, f"_{ad}")
    # kimlik katmanı
    vl.material_override = None
    sc.render.filepath = gecici + "_id.png"
    bpy.ops.render.render(write_still=True)
    # ışık katmanı
    vl.material_override = beyaz_mat
    sc.render.filepath = gecici + "_isik.png"
    bpy.ops.render.render(write_still=True)
    vl.material_override = None
    kim = _png_oku(gecici + "_id.png")
    isik = _png_oku(gecici + "_isik.png")
    os.remove(gecici + "_id.png")
    os.remove(gecici + "_isik.png")
    alfa = kim[..., 3]
    sinif = np.rint(kim[..., 0] * 255).astype(np.uint8)
    parca = np.rint(kim[..., 1] * 255).astype(np.uint8)
    # premultiplied alfa: kenarlar filtre 0 olduğundan tam; yine de böl
    derin = np.rint(np.clip(kim[..., 2], 0, 1) * 255).astype(np.uint8)
    lit = np.clip(isik[..., 0], 0, 4)
    np.savez_compressed(os.path.join(ham_dizin, ad + ".npz"), sinif=sinif, parca=parca, derin=derin,
                        isik=(lit * 100).astype(np.uint16), alfa=(alfa > 0.5))


def ana():
    arg = json.loads(sys.argv[sys.argv.index("--") + 1])
    stil = arg["stil"]
    ham = arg["cikti"]
    os.makedirs(ham, exist_ok=True)
    from tilki_poz import poz_ver
    sc = sahne_kur()
    t = Tilki(stil)
    egim = t.stil["egim"]
    kam = arg.get("kamera")
    if kam is None:
        sinir = []
        for pz in t.stil.get("kadraj", ["otur", "kos"]):
            t.poz_uygula(poz_ver(pz, 0.0, t))
            sinir.append(ekran_sinirlari(t, egim))
        sit = sinir[0]
        x0 = min(b_[0] for b_ in sinir)
        x1 = max(b_[1] for b_ in sinir)
        yt = max(b_[3] for b_ in sinir) - min(b_[2] for b_ in sinir)
        ppu = min(t.stil.get("boy", 0.68) * KARE_H / (sit[3] - sit[2]), (KARE_W - 14) / (x1 - x0))
        kam = dict(ppu=ppu, hx=(x0 + x1) / 2.0, y0=sit[2])
        with open(os.path.join(ham, "kamera.json"), "w") as f:
            json.dump(kam, f)
    ppu = kam["ppu"]
    p = R(egim)
    yukari = np.array([0, math.sin(p), math.cos(p)])
    # görüntü merkezi = satır 64; ayak çizgisi 120. satırda -> merkez, ayaktan 56 piksel yukarıda
    hedef = np.array([kam["hx"], 0, 0]) + yukari * (kam["y0"] + 56.0 / ppu)
    kamera_kur(egim, ppu, tuple(hedef))
    isik_kur()
    beyaz, parca_grup = malzemeler(t, MERKEZ_YUKSEK)
    gruplar = sorted(set(parca_grup.values()))
    with open(os.path.join(ham, "parcalar.json"), "w") as f:
        json.dump({str(k): gruplar.index(g) + 1 for k, g in parca_grup.items()}, f)
    for k in arg["kareler"]:
        t.poz_uygula(poz_ver(k["poz"], k.get("t", 0.0), t, **k.get("arg", {})))
        kare_render(t, ham, k["ad"], beyaz)
        print("kare", k["ad"], flush=True)


if __name__ == "__main__":
    ana()
