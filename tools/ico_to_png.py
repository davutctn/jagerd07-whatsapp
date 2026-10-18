#!/usr/bin/env python3
"""ICO -> PNG dönüştürücü (yalnızca 32bpp BMP ikonlar), bağımlılık gerektirmez.

WhatsApp'ın kendi logosunu (web.whatsapp.com/favicon.ico) çıkarır:

    python3 tools/ico_to_png.py assets/whatsapp.ico assets/tray.png
    python3 tools/ico_to_png.py assets/whatsapp.ico assets/icon.png 512

İkinci kullanımda küçük ikon Catmull-Rom bicubic ile büyütülür (AppImage ve
pencere ikonu için 512x512 gerekir).
"""
import struct
import sys
import zlib
from pathlib import Path


# ------------------------------------------------------------------ PNG cikisi
def png_bytes(width, height, rgba):
    raw = bytearray()
    stride = width * 4
    for y in range(height):
        raw.append(0)
        raw += rgba[y * stride:(y + 1) * stride]

    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
            + chunk(b"IEND", b""))


# ------------------------------------------------------------------ ICO okuma
def largest_icon(path):
    """(width, height, rgba) - ICO icindeki en buyuk 32bpp ikonu dondurur."""
    data = Path(path).read_bytes()
    _res, _typ, count = struct.unpack("<HHH", data[:6])

    best = None
    off = 6
    for _ in range(count):
        w, h, _cc, _r, _planes, bpp, size, ofs = struct.unpack("<BBBBHHII", data[off:off + 16])
        off += 16
        blob = data[ofs:ofs + size]

        if bpp != 32:
            continue

        header_size = struct.unpack("<I", blob[:4])[0]
        width, height = struct.unpack("<ii", blob[4:12])
        height = abs(height) // 2            # ICO'da yukseklik 2 kati yazilir
        pixels = blob[header_size:header_size + width * height * 4]

        rows = []
        for y in range(height):
            src = pixels[y * width * 4:(y + 1) * width * 4]
            row = bytearray()
            for x in range(width):
                b, g, r, a = src[x * 4:x * 4 + 4]
                row += bytes((r, g, b, a))
            rows.append(bytes(row))

        rgba = bytearray()
        for row in reversed(rows):            # BMP yukaridan asagi, PNG asagidan yukari
            rgba += row

        if best is None or width > best[0]:
            best = (width, height, bytes(rgba))

    if not best:
        raise SystemExit("32bpp ikon bulunamadi")
    return best


# ------------------------------------------------------------------ olcekleme
def _catmull_rom(t):
    t = min(max(t, 0.0), 1.0)
    return (
        -0.5 * t ** 3 + t ** 2 - 0.5 * t,
        1.5 * t ** 3 - 2.5 * t ** 2 + 1.0,
        -1.5 * t ** 3 + 2.0 * t ** 2 + 0.5 * t,
        0.5 * t ** 3 - 0.5 * t ** 2,
    )


def upscale(rgba, sw, sh, dw, dh):
    out = bytearray(dw * dh * 4)

    def at(x, y, c):
        x = min(max(x, 0), sw - 1)
        y = min(max(y, 0), sh - 1)
        return rgba[(y * sw + x) * 4 + c]

    for y in range(dh):
        fy = (y + 0.5) * sh / dh - 0.5
        iy = int(fy // 1)
        wy = _catmull_rom(fy - iy)
        for x in range(dw):
            fx = (x + 0.5) * sw / dw - 0.5
            ix = int(fx // 1)
            wx = _catmull_rom(fx - ix)

            acc = [0.0, 0.0, 0.0, 0.0]
            for j in range(4):
                for i in range(4):
                    w = wy[j] * wx[i]
                    if w == 0:
                        continue
                    for c in range(4):
                        acc[c] += w * at(ix + i - 1, iy + j - 1, c)
            o = (y * dw + x) * 4
            for c in range(3):
                out[o + c] = min(255, max(0, int(round(acc[c]))))
            out[o + 3] = min(255, max(0, int(round(acc[3]))))
    return out


def main():
    if len(sys.argv) not in (3, 4):
        raise SystemExit(
            "kullanim: python3 tools/ico_to_png.py <dosya.ico> <cikti.png> [boyut]")
    src, out_path = sys.argv[1], sys.argv[2]
    width, height, rgba = largest_icon(src)

    if len(sys.argv) == 4:
        size = int(sys.argv[3])
        rgba = upscale(bytearray(rgba), width, height, size, size)
        width = height = size

    Path(out_path).write_bytes(png_bytes(width, height, rgba))
    print(f"{out_path}: {width}x{height}")


if __name__ == "__main__":
    main()