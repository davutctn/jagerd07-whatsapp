#!/usr/bin/env bash
#
# install-desktop.sh - Uygulama kimliği (desktop entry) + ikon kaydı
#
# Neden gerekli?
#   GNOME/Wayland alt-tab (GNOME Shell) pencere ikonunu, çalışan sürecin
#   WM_CLASS'ı ile eşleşen .desktop dosyasından bulur. Paketlenmemiş
#   (npm start) çalıştırmada sistemde WhatsApp.desktop yoksa GNOME generic
#   bir ikon gösterir. Bu betik .desktop dosyasını ve "whatsapp" ikonunu
#   kullanıcı dizinine kurar; alt-tab + görev çubuğu + uygulama menüsü
#   WhatsApp logosunu gösterir.
#
# Kullanım:
#   tools/install-desktop.sh                  # otomatik algıla
#   tools/install-desktop.sh --exe /opt/WhatsApp/WhatsApp   # paketli sürüm
#   tools/install-desktop.sh --uninstall     # geri al
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

APPLICATIONS_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
ICONS_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/icons"
DESKTOP_FILE="$APPLICATIONS_DIR/WhatsApp.desktop"
TEMPLATE="$REPO_DIR/packaging/whatsapp.desktop.in"
ICON_SOURCE="$REPO_DIR/assets/icon.png"
ICON_NAME="whatsapp"
SIZES=(16 24 32 48 64 128 256 512)

MODE="install"
TARGET_EXE=""

log() { printf '%s\n' "$*"; }
die() { printf 'hata: %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --exe) TARGET_EXE="${2:-}"; shift 2 ;;
    --uninstall) MODE="uninstall"; shift ;;
    -h|--help) sed -n '2,20p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) die "bilinmeyen argüman: $1" ;;
  esac
done

refresh_caches() {
  if command -v gtk-update-icon-cache >/dev/null 2>&1 && [ -d "$ICONS_DIR/hicolor" ]; then
    gtk-update-icon-cache -f -t "$ICONS_DIR/hicolor" >/dev/null 2>&1 || true
  fi
  if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$APPLICATIONS_DIR" >/dev/null 2>&1 || true
  fi
}

if [ "$MODE" = "uninstall" ]; then
  rm -f "$DESKTOP_FILE"
  for size in "${SIZES[@]}"; do
    rm -f "$ICONS_DIR/hicolor/${size}x${size}/apps/${ICON_NAME}.png"
  done
  refresh_caches
  log "kaldırıldı: $DESKTOP_FILE"
  exit 0
fi

[ -f "$TEMPLATE" ] || die "şablon bulunamadı: $TEMPLATE"
[ -f "$ICON_SOURCE" ] || die "ikon kaynağı bulunamadı: $ICON_SOURCE"

# --- Çalıştırılabilir yeri belirle -------------------------------------------------
# Öncelik: --exe > geliştirme (npm start) > paketlenmiş sürüm
if [ -n "$TARGET_EXE" ]; then
  [ -x "$TARGET_EXE" ] || die "verilen yol çalıştırılabilir değil: $TARGET_EXE"
  EXEC_CMD="\"$TARGET_EXE\" --class=WhatsApp %U"
  MODE_LABEL="paketli sürüm"
else
  ELECTRON_BIN="$REPO_DIR/node_modules/electron/dist/electron"
  PACKAGED_EXE="$REPO_DIR/dist/linux-unpacked/WhatsApp"
  if [ -x "$ELECTRON_BIN" ]; then
    EXEC_CMD="\"$ELECTRON_BIN\" \"$REPO_DIR\" --class=WhatsApp %U"
    MODE_LABEL="geliştirme (npm start)"
  elif [ -x "$PACKAGED_EXE" ]; then
    EXEC_CMD="\"$PACKAGED_EXE\" --class=WhatsApp %U"
    MODE_LABEL="paketlenmiş (linux-unpacked)"
  else
    die "electron bulunamadı. Önce 'npm install' çalıştır veya --exe ver."
  fi
fi

# --- .desktop dosyası --------------------------------------------------------------
mkdir -p "$APPLICATIONS_DIR"
ESCAPED_EXEC="${EXEC_CMD//\/\\\\}"
sed "s|@EXEC@|$ESCAPED_EXEC|g" "$TEMPLATE" > "$DESKTOP_FILE"
chmod 644 "$DESKTOP_FILE"
log "yazıldı: $DESKTOP_FILE ($MODE_LABEL)"

# --- İkonlar (isim tabanlı: hicolor/<size>/apps/whatsapp.png) ------------------------
install_icons() {
  for size in "${SIZES[@]}"; do
    dest_dir="$ICONS_DIR/hicolor/${size}x${size}/apps"
    dest="$dest_dir/${ICON_NAME}.png"
    mkdir -p "$dest_dir"
    if command -v magick >/dev/null 2>&1; then
      magick "$ICON_SOURCE" -resize "${size}x${size}" -background none "$dest"
    elif command -v convert >/dev/null 2>&1; then
      convert "$ICON_SOURCE" -resize "${size}x${size}" -background none "$dest"
    elif command -v python3 >/dev/null 2>&1 && python3 -c 'import PIL' 2>/dev/null; then
      python3 - "$ICON_SOURCE" "$dest" "$size" <<'PY'
import sys
from PIL import Image
src, dest, size = sys.argv[1], sys.argv[2], int(sys.argv[3])
img = Image.open(src).convert('RGBA')
img.thumbnail((size, size), Image.LANCZOS)
img.save(dest)
PY
    else
      [ "$size" = "512" ] || continue
      cp "$ICON_SOURCE" "$dest"
    fi
  done
  log "ikonlar kuruldu: $ICONS_DIR/hicolor/{$(IFS=,; echo "${SIZES[*]}")}/apps/${ICON_NAME}.png"
}

install_icons
refresh_caches

cat <<EOF

Kurulum tamam.
  mod            : $MODE_LABEL
  desktop entry  : $DESKTOP_FILE
  Exec           : $EXEC_CMD

Notlar:
 - GNOME alt-tab ikonu pencere açıldığında yenilenir; uygulamayı kapatıp
   yeniden başlatman yeterli.
 - Uygulamayı DEĞİŞTİRMEK (yeni kod) yeniden kurulum gerektirmez, Exec yolu
   aynı kaldığı sürece .desktop dosyası geçerlidir.
 - Geri almak için: tools/install-desktop.sh --uninstall
EOF