"""Vygeneruje ikony a úvodnú obrazovku pre samostatnú aplikáciu Elektro (elektro-app/assets).
Spusti: python tools/make_elektro_icons.py"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "elektro-app/assets"
A, B, C = (245, 158, 11), (244, 63, 94), (139, 92, 246)  # oranžová → červená → fialová


def grad(size):
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * size - 2)
            if t < .55:
                k = t / .55
                c = tuple(int(A[i] + (B[i] - A[i]) * k) for i in range(3))
            else:
                k = (t - .55) / .45
                c = tuple(int(B[i] + (C[i] - B[i]) * k) for i in range(3))
            px[x, y] = c
    return img


def bolt(draw, s, scale=1.0, fill=(255, 255, 255, 255)):
    # blesk v štvorci s×s (súradnice v pomere 0..1)
    pts = [(.58, .10), (.24, .56), (.47, .56), (.40, .90), (.76, .42), (.53, .42), (.62, .10)]
    c = s / 2
    draw.polygon([(c + (x - .5) * s * scale, c + (y - .5) * s * scale) for x, y in pts], fill=fill)


def icon(size, rounded=True, with_bg=True, scale=.62):
    s = size * 4
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    if with_bg:
        m = Image.new("L", (s, s), 0)
        ImageDraw.Draw(m).rounded_rectangle((0, 0, s - 1, s - 1), radius=int(s * .235) if rounded else 0, fill=255)
        img.paste(grad(s).convert("RGBA"), (0, 0), m)
    bolt(ImageDraw.Draw(img), s, scale)
    return img.resize((size, size), Image.LANCZOS)


OUT.mkdir(parents=True, exist_ok=True)
icon(1024, rounded=False).save(OUT / "icon-only.png")
icon(1024, with_bg=False, scale=.42).save(OUT / "icon-foreground.png")
grad(256).resize((1024, 1024)).save(OUT / "icon-background.png")
for name, bg in (("splash.png", (7, 7, 13)), ("splash-dark.png", (7, 7, 13))):
    sp = Image.new("RGB", (2732, 2732), bg)
    sp.paste(icon(640), (1046, 1046), icon(640))
    sp.save(OUT / name)
print("hotovo:", sorted(p.name for p in OUT.iterdir()))
