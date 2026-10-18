#!/usr/bin/env bash
#
# make-flatpak-icons.sh - Flatpak ikon boyutlarını üretir
#
# Freedesktop SDK içinde ImageMagick/Pillow bulunmadığı için ikon boyutları
# build ÖNCESİNDE burada üretilir ve repoya yazılır. flatpak-builder build
# sırasında yalnızca kopyalar.
#
# Kullanım:  tools/make-flatpak-icons.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SOURCE="$REPO_DIR/assets/icon.png"
OUT_DIR="$REPO_DIR/packaging/flatpak/icons"
SIZES=(16 24 32 48 64 128 256 512)

[ -f "$SOURCE" ] || { echo "hata: $SOURCE bulunamadı" >&2; exit 1; }
mkdir -p "$OUT_DIR"

resize() {
  if command -v magick >/dev/null 2>&1; then
    magick "$SOURCE" -resize "${1}x${1}" -background none "$2"
  elif command -v convert >/dev/null 2>&1; then
    convert "$SOURCE" -resize "${1}x${1}" -background none "$2" 2>/dev/null
  else
    echo "hata: ImageMagick (magick/convert) gerekli" >&2
    exit 1
  fi
}

for size in "${SIZES[@]}"; do
  resize "$size" "$OUT_DIR/com.jagerd07.WhatsApp-${size}.png"
  echo "üretildi: $(basename "$OUT_DIR/com.jagerd07.WhatsApp-${size}.png")"
done

echo "tamam: $OUT_DIR"