#!/usr/bin/env python3
"""WhatsApp'in kendi logosundan dolu (solid) uygulama ikonu uretir.

Kaynak: Wikimedia Commons'taki WhatsApp Logo green.svg (yesil kontur, 960px).
Islem:
  1. Alfa kanalindan cizim maskesi olusturulur.
  2. Balonun ic bosluklari disaridan tasma (flood fill) ile doldurulur ->
     balonun ici tamamen dolu hale gelir.
  3. Balon icinde kalan beyaz alan (ahize ile balon arasindaki bosluk) beyaz,
     cizim yesil, disi saydam olur.

Gereksinim: Pillow  (python3 -m pip install Pillow)
"""
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

SRC = Path(__file__).resolve().parent.parent / "assets" / "whatsapp-logo-source.png"
OUT_ICON = Path(__file__).resolve().parent.parent / "assets" / "icon.png"
OUT_TRAY = Path(__file__).resolve().parent.parent / "assets" / "tray.png"

GREEN = (0x25, 0xD3, 0x66)
WHITE = (0xFF, 0xFF, 0xFF)


def first_nonzero(img):
    """Maskenin sol ust kosesindeki ilk sifir-disi piksel (floodfill tohumu)."""
    bbox = img.getbbox()
    if bbox is None:
        return None
    px = img.load()
    for y in range(bbox[1], bbox[3]):
        for x in range(bbox[0], bbox[2]):
            if px[x, y]:
                return (x, y)
    return None


def connected_components(mask, max_components=16):
    """mask (0/255) uzerindeki bilesenleri dondurur: [(size, Image), ...]"""
    work = mask.copy()
    comps = []
    for _ in range(max_components):
        seed = first_nonzero(work)
        if seed is None:
            break
        tmp = work.copy()
        ImageDraw.floodfill(tmp, seed, 128)
        comp = tmp.point(lambda v: 255 if v == 128 else 0)
        size = comp.histogram()[255]
        comps.append((size, comp))
        work.paste(0, (0, 0), comp)
    return sorted(comps, key=lambda c: -c[0])


def build(src, size):
    im = Image.open(src).convert("RGBA")

    # 1) cizim maskesi
    glyph = im.getchannel("A").point(lambda v: 255 if v > 128 else 0)

    # 2) balonun ic bosluklarini doldur: kenarlardaki tüm arka plan bölgeleri
    #    tasma ile işaretlenir, geriye kalanlar balonun içidir.
    outside = Image.eval(glyph, lambda v: 0 if v else 255)
    px = outside.load()
    w, h = outside.size
    seeds = []
    for x in range(w):
        for y in (0, h - 1):
            if px[x, y]:
                seeds.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if px[x, y]:
                seeds.append((x, y))
    for seed in seeds:
        ImageDraw.floodfill(outside, seed, 0)

    filled = glyph.copy()
    filled.paste(255, (0, 0), outside)                # kalan 255'ler ic bosluklar

    # 3) balon halkasindan ayri kalan bilesen = telefon ahizesi
    comps = connected_components(glyph)
    handset = Image.new("L", im.size, 0)
    if len(comps) > 1:
        handset = comps[1][1]            # en buyuk = balon halkasi, sonraki = ahize

    # 4) yesil: dolu balon + ahize, beyaz: ahize
    green_mask = filled
    out = Image.new("RGBA", im.size, (0, 0, 0, 0))
    out.paste(Image.new("RGBA", im.size, GREEN + (255,)), (0, 0), green_mask)
    out.paste(Image.new("RGBA", im.size, WHITE + (255,)), (0, 0), handset)

    return out.resize((size, size), Image.LANCZOS)


def main():
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else SRC
    icon = build(src, 512)
    icon.save(OUT_ICON)
    print(f"{OUT_ICON.name}: 512x512")

    tray = build(src, 64)
    tray.save(OUT_TRAY)
    print(f"{OUT_TRAY.name}: 64x64")


if __name__ == "__main__":
    main()