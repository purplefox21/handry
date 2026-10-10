"""Tilki tasarımlarının düz (piksel olmayan) render'ı: çizgi film gölgesi (3 bant), dış çizgi (ters kabuk), yerde gölge.
Blender: Blender -b --factory-startup --python tasarim_render.py -- '{"tasarim": "T1", "cikti": "/yol", "pozlar": ["yuru", ...]}'
"""
import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tasarimlar  # noqa: E402,F401  (STILLER'e T1..T5 ekler)
from stiller import SINIFLAR, STILLER  # noqa: E402
from tilki_model import Tilki  # noqa: E402
from tilki_poz import poz_ver  # noqa: E402

R = math.radians
W, H = 960, 760
ADLAR = {v: k for k, v in SINIFLAR.items()}
# poz -> (bize dönüklük derecesi, kamera eğimi)
POZ_KAMERA = {"yuru": (8, 8), "otur_bak": (80, 8), "uyu": (40, 40), "sikil": (60, 16)}


def lin(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c) + (1.0,)


def sahne():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x, sc.render.resolution_y = W, H
    sc.render.film_transparent = True
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    try:
        sc.eevee.taa_render_samples = 24
    except Exception:
        pass
    return sc


def toon(ad, renk):
    g, o, i = (lin(x) for x in renk)
    m = bpy.data.materials.new(ad)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    df = nt.nodes.new("ShaderNodeBsdfDiffuse")
    df.inputs["Color"].default_value = (1, 1, 1, 1)
    s2r = nt.nodes.new("ShaderNodeShaderToRGB")
    cr = nt.nodes.new("ShaderNodeValToRGB")
    em = nt.nodes.new("ShaderNodeEmission")
    rmp = cr.color_ramp
    rmp.interpolation = "LINEAR"
    duraklar = [(0.0, g), (0.27, g), (0.33, o), (0.80, o), (0.86, i), (1.0, i)]
    rmp.elements[0].position, rmp.elements[0].color = duraklar[0]
    rmp.elements[1].position, rmp.elements[1].color = duraklar[-1]
    for pos, col in duraklar[1:-1]:
        e = rmp.elements.new(pos)
        e.color = col
    nt.links.new(df.outputs["BSDF"], s2r.inputs["Shader"])
    nt.links.new(s2r.outputs["Color"], cr.inputs["Fac"])
    nt.links.new(cr.outputs["Color"], em.inputs["Color"])
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    return m


def duz(ad, hexrenk):
    m = bpy.data.materials.new(ad)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = lin(hexrenk)
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    return m


def kontur_malzeme(hexrenk):
    m = duz("kontur", hexrenk)
    m.use_backface_culling = True
    return m


def zemin_golgesi():
    """z=0'da gölge yakalayan düzlem: aydınlıkta saydam, gölgede yarı saydam koyu."""
    bpy.ops.mesh.primitive_plane_add(size=6.0, location=(0, 0, 0))
    pl = bpy.context.active_object
    m = bpy.data.materials.new("zemin")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    df = nt.nodes.new("ShaderNodeBsdfDiffuse")
    s2r = nt.nodes.new("ShaderNodeShaderToRGB")
    bw = nt.nodes.new("ShaderNodeRGBToBW")
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = 0.62
    mr.inputs["From Max"].default_value = 0.25
    mr.inputs["To Min"].default_value = 0.0
    mr.inputs["To Max"].default_value = 0.42
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = lin("4a3a40")
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(df.outputs["BSDF"], s2r.inputs["Shader"])
    nt.links.new(s2r.outputs["Color"], bw.inputs["Color"])
    nt.links.new(bw.outputs["Val"], mr.inputs["Value"])
    nt.links.new(mr.outputs["Result"], mix.inputs["Fac"])
    nt.links.new(tr.outputs["BSDF"], mix.inputs[1])
    nt.links.new(em.outputs["Emission"], mix.inputs[2])
    nt.links.new(mix.outputs["Shader"], out.inputs["Surface"])
    try:
        m.surface_render_method = "BLENDED"
    except Exception:
        m.blend_method = "BLEND"
    pl.data.materials.append(m)
    pl.visible_shadow = False
    return pl


def isiklar():
    sc = bpy.context.scene
    ana = Vector((-0.45, -0.62, 0.64)).normalized()
    g = bpy.data.lights.new("ana", "SUN")
    g.energy = 3.0
    g.angle = R(4)
    ob = bpy.data.objects.new("ana", g)
    sc.collection.objects.link(ob)
    ob.rotation_euler = (-ana).to_track_quat("-Z", "Y").to_euler()
    d = Vector((0.7, 0.45, 0.35)).normalized()
    g2 = bpy.data.lights.new("dolgu", "SUN")
    g2.energy = 0.45
    g2.use_shadow = False
    ob2 = bpy.data.objects.new("dolgu", g2)
    sc.collection.objects.link(ob2)
    ob2.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    w = bpy.data.worlds.new("dunya")
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (1, 1, 1, 1)
    bg.inputs["Strength"].default_value = 0.3
    sc.world = w


ESYA_RENK = dict(esya_orta=("6a7088", "9aa2bc", "c8d0e2"), esya_koyu=("1e2232", "2e3448", "444c66"),
                 esya_acik=("c8c0d4", "f2eef8", "ffffff"), esya_isik=("dff8ff", "ffffff", "ffffff"), esya_ahsap=("5a3424", "8a5434", "b47a4e"))


def boya(t, tas):
    renk = {**ESYA_RENK, **tas["renk"]}
    mats = {ad: toon(f"m_{ad}", r) for ad, r in renk.items()}
    mats["goz_isik"] = duz("goz_isik", "ffffff")
    if "goz_bebek" in renk:
        mats["goz_bebek"] = duz("goz_bebek", renk["goz_bebek"][1])
    kmat = kontur_malzeme(tas["kontur"])
    ates_mat = duz("ates", "a8f4ff")
    kalin = 0.0062

    def cizgi(ob, n_slot):
        for _ in range(n_slot):
            ob.data.materials.append(kmat)
        mod = ob.modifiers.new("cizgi", "SOLIDIFY")
        mod.thickness = kalin
        mod.offset = 1.0
        mod.use_flip_normals = True
        mod.use_rim = False
        mod.material_offset = n_slot

    for ob, ad, sinif, grup in t.parcalar:
        sn = ADLAR[sinif]
        if ad in t.esya_adlari and sn not in mats:
            continue
        slotlar = t.cok_sinif.get(ad, [sn])
        for s_ in slotlar:
            ob.data.materials.append(mats.get(s_, mats["kurk"]))
        if not ad.startswith(("goz_isik", "goz_bebek", "agiz_ici", "dil", "goz_kapak", "ates_", "laptop_logo")):
            cizgi(ob, len(slotlar))
        if ad.startswith("ates_"):
            ob.visible_shadow = False
            ob.data.materials.clear()
            ob.data.materials.append(ates_mat)
            cizgi(ob, 1)
    for c in t.ciltler:
        for sn, grup in c.slotlar:
            c.ob.data.materials.append(mats.get(sn, mats["kurk"]))
        cizgi(c.ob, len(c.slotlar))


def kamera(t, egim):
    cam = bpy.data.cameras.new("kamera")
    cam.type = "ORTHO"
    ob = bpy.data.objects.new("kamera", cam)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.scene.camera = ob
    p = R(egim)
    ileri = Vector((0, math.cos(p), -math.sin(p)))
    yukari = np.array([0, math.sin(p), math.cos(p)])
    v = t.dunya_koseler()
    sx, sy = v[:, 0], v @ yukari
    x0, x1, y0, y1 = sx.min(), sx.max(), sy.min(), sy.max()
    gen = max((x1 - x0), (y1 - y0) * W / H) * 1.22
    cam.ortho_scale = gen
    hedef = Vector((0.5 * (x0 + x1), 0, 0)) + Vector(yukari) * (0.5 * (y0 + y1) - 0.02 * gen)
    ob.location = hedef - ileri * 8.0
    ob.rotation_euler = ileri.to_track_quat("-Z", "Y").to_euler()
    cam.clip_end = 40
    return ob


def ana():
    arg = json.loads(sys.argv[sys.argv.index("--") + 1])
    ad = arg["tasarim"]
    cikti = arg["cikti"]
    os.makedirs(cikti, exist_ok=True)
    sc = sahne()
    tas = STILLER[ad]
    t = Tilki(ad)
    boya(t, tas)
    isiklar()
    zemin_golgesi()
    for pz in arg["pozlar"]:
        yuz, egim = POZ_KAMERA[pz]
        p = poz_ver(pz, 0.0, t)
        p["govde_yaw"] = tas["yaw"] - yuz
        if tas.get("tilki_atesi"):
            p["esya"] = list(p.get("esya", [])) + ["ates"]
        t.poz_uygula(p)
        kam = kamera(t, egim)
        sc.render.filepath = os.path.join(cikti, f"{ad}_{pz}.png")
        bpy.ops.render.render(write_still=True)
        bpy.data.objects.remove(kam)
        print("kare", ad, pz, flush=True)


if __name__ == "__main__":
    ana()
