"""Vygeneruje PNG ikony aplikácie (PWA aj Android). Spusti: python tools/make_icons.py
Ak chceš vlastnú ikonu, nahraď public/assets/icons/*.png a mobile/assets/icon.png vlastnými obrázkami."""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
A, B = (139, 92, 246), (34, 211, 238)


def grad(size):
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * size - 2)
            px[x, y] = tuple(int(A[i] + (B[i] - A[i]) * t) for i in range(3))
    return img


def logo(size, pad_ratio, rounded=True):
    s = 4 * size  # supersampling
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    bg = Image.new("L", (s, s), 0)
    ImageDraw.Draw(bg).rounded_rectangle((0, 0, s - 1, s - 1), radius=int(s * .235) if rounded else 0, fill=255)
    img.paste((11, 11, 20, 255), (0, 0), bg)
    g = grad(s).convert("RGBA")
    pad = s * pad_ratio
    cell = (s - 2 * pad) * 0.4375
    gap = (s - 2 * pad) - 2 * cell
    for i, (cx, cy, full, circle) in enumerate([(0, 0, 1, 0), (1, 0, .55, 0), (0, 1, .55, 0), (1, 1, 1, 1)]):
        x0 = pad + cx * (cell + gap)
        y0 = pad + cy * (cell + gap)
        m = Image.new("L", (s, s), 0)
        ImageDraw.Draw(m).rounded_rectangle((x0, y0, x0 + cell, y0 + cell), radius=cell / 2 if circle else cell * .26, fill=int(255 * full))
        img.paste(g, (0, 0), m)
    return img.resize((size, size), Image.LANCZOS)


out = ROOT / "public/assets/icons"
logo(192, .1875).save(out / "icon-192.png")
logo(512, .1875).save(out / "icon-512.png")
logo(512, .28, rounded=False).save(out / "maskable-512.png")
mob = ROOT / "mobile/assets"
mob.mkdir(parents=True, exist_ok=True)
logo(1024, .28, rounded=False).save(mob / "icon-only.png")
logo(1024, .28, rounded=False).save(mob / "icon-foreground.png")
Image.new("RGB", (1024, 1024), (11, 11, 20)).save(mob / "icon-background.png")
sp = Image.new("RGB", (2732, 2732), (7, 7, 13))
sp.paste(logo(600, .1875), (1066, 1066), logo(600, .1875))
sp.save(mob / "splash.png")
sp.save(mob / "splash-dark.png")
print("Ikony vygenerované")
