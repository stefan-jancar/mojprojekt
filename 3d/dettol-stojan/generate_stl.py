"""Vygeneruje dettol_stojan.stl – rovnaká geometria ako dettol_stojan.scad.

Použitie: pip install manifold3d trimesh && python generate_stl.py
(Ak máte OpenSCAD, stačí otvoriť .scad a dať F6 / Export STL.)
"""
import math
from pathlib import Path

import numpy as np
import trimesh
from manifold3d import CrossSection, Manifold, set_circular_segments

set_circular_segments(64)

flasa_sirka, flasa_hlbka, flasa_radius, vola = 85, 40, 18, 1.5
stena, dno, vyska_kosik = 2.8, 3, 45
vyrez_sirka, vyrez_od_dna, odtok_d = 44, 15, 6
doska_hrubka, doska_vyska = 4, 100
skrutka_d, hlava_d, skrutky_rozostup, skrutky_od_vrchu = 4.5, 9, 56, 15

in_w = flasa_sirka + 2 * vola
in_d = flasa_hlbka + 2 * vola
in_r = flasa_radius + vola
out_w = in_w + 2 * stena
out_d = in_d + stena + doska_hrubka


def cyl(r, h, r2=None):
    return Manifold.cylinder(h, r, r if r2 is None else r2)


def rrect(w, d, r, h):
    pts = [Manifold.cylinder(h, r).translate([x, y, 0])
           for x in (-w / 2 + r, w / 2 - r) for y in (r, d - r)]
    return Manifold.batch_hull(pts)


def box(x, y, z, sx, sy, sz):
    return Manifold.cube([sx, sy, sz]).translate([x, y, z])


def kosik():
    outer = Manifold.batch_hull([
        box(-out_w / 2, 0, 0, out_w, 1, vyska_kosik),
        rrect(out_w, out_d, in_r + stena, vyska_kosik),
    ])
    cut = rrect(in_w, in_d, in_r, vyska_kosik).translate([0, doska_hrubka, dno])
    c = cyl(vyrez_sirka / 2, stena + 2)
    slot = Manifold.batch_hull([c, c.translate([0, -vyska_kosik, 0])])
    slot = slot.rotate([-90, 0, 0]).translate(
        [0, out_d - stena - 1, vyrez_od_dna + vyrez_sirka / 2])
    cut = cut + slot
    for x in (-1, 0, 1):
        for y in (-1, 1):
            cut = cut + cyl(odtok_d / 2, dno + 2).translate(
                [x * 22, doska_hrubka + in_d / 2 + y * 12, -1])
    return outer - cut


def doska():
    r = 8
    parts = [box(-out_w / 2, 0, 0, out_w, doska_hrubka, 1)]
    for x in (-out_w / 2 + r, out_w / 2 - r):
        parts.append(cyl(r, doska_hrubka).rotate([-90, 0, 0])
                     .translate([x, 0, doska_vyska - r]))
    plate = Manifold.batch_hull(parts)
    ch = (hlava_d - skrutka_d) / 2
    for x in (-skrutky_rozostup / 2, skrutky_rozostup / 2):
        z = doska_vyska - skrutky_od_vrchu
        shaft = cyl(skrutka_d / 2, doska_hrubka + 2).translate([0, 0, -1]) \
            .rotate([-90, 0, 0])
        head = cyl(skrutka_d / 2, ch, hlava_d / 2).rotate([-90, 0, 0]) \
            .translate([0, doska_hrubka - ch + 0.01, 0])
        plate = plate - (shaft + head).translate([x, 0, z])
    return plate


def vystuhy():
    v = doska_vyska - vyska_kosik - 28
    tri = CrossSection([[(0, 0), (out_d * 0.45, 0), (0, v)]])
    rib = Manifold.extrude(tri, stena).rotate([90, 0, 90])
    return sum((rib.translate([x, 0, vyska_kosik - 0.01])
                for x in (-out_w / 2, out_w / 2 - stena)), Manifold())


model = kosik() + doska() + vystuhy()
m = model.to_mesh()
mesh = trimesh.Trimesh(vertices=m.vert_properties[:, :3], faces=m.tri_verts)
out = Path(__file__).with_name("dettol_stojan.stl")
mesh.export(out)
print(f"{out.name}: {mesh.extents.round(1)} mm, watertight={mesh.is_watertight}, "
      f"objem={mesh.volume / 1000:.1f} cm3")
