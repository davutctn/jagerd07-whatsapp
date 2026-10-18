# WhatsApp — Linux Masaüstü İstemcisi

Tüm Linux dağıtımlarında (Fedora, Ubuntu, Arch, Debian, openSUSE vb.) sorunsuz
çalışan, Electron tabanlı WhatsApp Web masaüstü istemcisi.

Yapımcı: JagerD07 (yalnızca proje meta verisinde)

## Özellikler

- `https://web.whatsapp.com` yüklenir (webview değil, güvenli `BrowserWindow`)
- Görev çubuğunda (alt bar), tepside ve menülerde **WhatsApp** adı ve WhatsApp'ın
  kendi logosu kullanılır (diğer uygulamalar gibi davranır)
- Güncel Google Chrome **User-Agent** + `sec-ch-ua` Client Hints başlıkları
  (WhatsApp Web engelinin aşılması için)
- **Linux yerel bildirimleri** (DBus / LibNotify) etkinleştirilir
- **Sistem tepsisi (Tray)** ikonu: `X` ile kapatılınca tepsiye küçülür
- **Kapanışta arka planda çalışma**: `X` ile kapatınca uygulama tepside yaşamaya
  devam eder; gerçek çıkış tepsi menüsündeki **Çıkış** ile yapılır
- Tek örnek kilidi: uygulamayı ikinci kez açmak mevcut pencereyi öne getirir
- `whatsapp://` deep-link desteği (telefon numarasıyla sohbet açma)
- Harici bağlantılar (tel:, mailto:, PDF, YouTube ...) sistem tarayıcısında açılır
- **Sesli ve görüntülü arama** için kamera/mikrofon izinleri, cihaz listesi ve
  ekran paylaşımı (screen share) desteklenir (WebRTC mDNS sorunu kapalı)
- **Gelen aramada kamera otomatik açılmaz**: kamera varsayılan olarak kapalıdır,
  mikrofon çalışmaya devam eder. Tepsi menüsünden **"Aramalarda Kamerayı Aç"**
  ile kalıcı olarak açılabilir (kalıcılık `~/.config/whatsapp-linux-desktop/media-settings.json`)
- **Pano** (Ctrl+V ile resim yapıştırma) ve **pano okuma** izinleri açık
- **İndirmeler** (fotoğraf, video, ses, belge) otomatik olarak `~/Downloads` klasörüne
  gider
- Pencere boyutu/pozisyonu son durumda kalıcıdır
- `contextIsolation: true` + `nodeIntegration: false` güvenli köprü (`preload.js`)

## Dosya yapısı

```
.
├── main.js              # Electron ana süreç (pencere, tray, bildirim, UA)
├── preload.js           # Güvenli contextBridge köprüsü
├── package.json         # Bağımlılıklar + electron-builder yapılandırması
├── assets/
│   ├── icon.png                 # 512x512 uygulama/AppImage ikonu (WhatsApp logosu)
│   ├── tray.png                 # 64x64 sistem tepsisi ikonu
│   ├── whatsapp.ico             # web.whatsapp.com/favicon.ico (kaynak)
│   └── whatsapp-logo-source.png # yüksek çözünürlüklü logo kaynağı
├── tools/
│   ├── make_whatsapp_icon.py    # logodan ikon üretir (Pillow)
│   ├── ico_to_png.py            # .ico -> .png
│   ├── install-desktop.sh       # .desktop + hicolor ikon kurulumu (alt-tab ikonu)
│   └── make-flatpak-icons.sh    # flatpak hicolor ikon boyutlarını üretir
├── packaging/
│   ├── whatsapp.desktop.in      # desktop entry şablonu (@EXEC@ yer tutucu)
│   └── flatpak/
│       ├── com.jagerd07.WhatsApp.yml   # flatpak manifesti (runtime 25.08)
│       └── icons/                       # üretilmiş hicolor ikon boyutları
└── dist/                # npm run dist / flatpak çıktıları (build sonrası)
```

## Logo kaynağı

`assets/icon.png` ve `assets/tray.png`, WhatsApp'ın kendi logosundan üretilir:

- `assets/whatsapp-logo-source.png` → Wikimedia Commons, *WhatsApp Logo green.svg*
- `assets/whatsapp.ico` → `https://web.whatsapp.com/favicon.ico`

Yeniden üretmek için (Pillow gerekli):

```bash
python3 -m pip install Pillow
python3 tools/make_whatsapp_icon.py
```

> Not: Bu uygulama WhatsApp Inc. tarafından üretilmemiş, **resmî olmayan** bir
> istemcidir. WhatsApp adı ve logosu WhatsApp Inc.'in tescilli markalarıdır ve
> yalnızca bu istemcinin WhatsApp Web ile uyumunu göstermek için kullanılır.

## Kurulum / Çalıştırma

```bash
npm install
npm run setup:desktop   # masaüstü girişi + ikon kaydı (alt-tab ikonu için)
npm start
```

### Neden `setup:desktop` gerekli?

GNOME/Wayland'da alt-tab (GNOME Shell) pencere ikonunu, çalışan pencerenin
`WM_CLASS` değeriyle eşleşen **`.desktop` dosyasından** bulur — `BrowserWindow`
ikonundan değil. Kayıtlı bir `.desktop` yoksa generic bir ikon görünür.

Betik şunları yapar:

- `~/.local/share/applications/WhatsApp.desktop` yazar
  (`StartupWMClass=WhatsApp`, `Icon=whatsapp`, `whatsapp://` protokol işleyicisi)
- `assets/icon.png` dosyasından 16/24/32/48/64/128/256/512 px ikonları üretip
  `~/.local/share/icons/hicolor/<size>/apps/whatsapp.png` olarak kurar
- `gtk-update-icon-cache` ve `update-desktop-database` ile önbellekleri tazeler

```bash
npm run setup:desktop                 # otomatik algıla (npm start ya da linux-unpacked)
npm run setup:desktop:appimage        # paketlenmiş sürüm (dist/linux-unpacked/WhatsApp)
tools/install-desktop.sh --exe /opt/WhatsApp/WhatsApp   # kendi yolunuz
npm run uninstall:desktop             # geri al
```

Kurulumdan sonra uygulamayı bir kez kapatıp yeniden açın; alt-tab ikonu
WhatsApp logosuna döner.

Uygulamayı tepsi davranışı olmadan çalıştırmak için:

```bash
npm start -- --no-tray             # tepsi/arka plan davranışı tamamen kapalı
WA_MINIMIZE_TO_TRAY=1 npm start   # minimize de tepsiye küçülsün
npm start -- --camera              # aramalarda kamera açık başlasın (kalıcı)
npm start -- --no-camera           # aramalarda kamera kapalı başlasın (kalıcı)
WA_CAMERA=1 npm start              # yalnızca bu oturumda kamera açık (kalıcı değil)
```

### Kamera tercihi

WhatsApp Web, gelen görüntülü aramayı kamerayı açık kabul ederek otomatik
yanıtlar. Bu istemci **yalnızca otomatik açılışı** engeller:

| Durum | Sonuç |
|---|---|
| Gelen arama (WhatsApp'in kendi isteği) | Kamera açılmaz, `NotAllowedError` |
| Konuşma içinde "kamerayı aç" düğmesi | **Çalışır** — ikinci istek geçer |
| Sesli arama (mikrofon) | Her zaman çalışır |

İzin katmanı (`setPermissionRequestHandler`) bilinçli olarak **tüm izinleri
onaylar**. Çünkü bir kez `deny` dendiğinde Chromium bunu kalıcı olarak
`BLOCKED` kaydeder ve konuşma içindeki kamera düğmesi bir daha çalışmaz.
Engelleme yalnızca sayfa katmanında (`cameraGuardScript`) yapılır ve **sadece
ilk** isteği reddeder.

Kalıcı ayar: tepsi simgesi → sağ tık → **"Aramalarda Kamerayı Aç"**. Bu ayar
sayfayı yeniden yüklemez (yenileme oturumu ve devam eden aramayı düşürürdü).

**Varsayılan pencere davranışları:**

| Eylem | Sonuç |
|---|---|
| Pencereyi küçült | Alt barda (görev çubuğunda) kalır, "WhatsApp" adı ve logosuyla görünür |
| Pencereyi kapat (`X`) | Pencere gizlenir, uygulama arka planda çalışmaya devam eder (tepsi) |
| Tepsi simgesi | Penceriyi geri getirir / gizler; sağ tık → Çıkış |

### Sesli / görüntülü arama çalışmıyorsa

1. Tanılama çalıştırın:
   ```bash
   WA_DEBUG_MEDIA=1 npm start
   ```
   Konsolda `[whatsapp:media]` satırı cihaz listesini ve `getUserMedia` sonucunu
   gösterir. Kamera/mikrofon adları "(isimsiz)" olarak geliyorsa izin verilmemiş
   demektir.
2. Hâlâ boşsa işletim sistemi düzeyinde kontrol edin:
   ```bash
   # Kamera/mikrofon cihazlarını gör
   arecord -l ; v4l2-ctl --list-devices
   # Wayland kullanıyorsanız portal üzerinden izin gerekir (Flatpak/Snap gibi
   # sandbox'lı uygulamalarda PipeWire erişimi kısıtlı olabilir)
   ```
3. `setPermissionRequestHandler` **ve** `setPermissionCheckHandler` aynı izin
   listesini kullanmalıdır; ikisi tutarsızsa cihaz listesi boş görünür. Bu
   uygulamada ikisi de `ALLOWED_PERMISSIONS` kümesini kullanır
   (`main.js` içinde tanımlı).

### Tepsi simgesi görünmüyorsa (GNOME / KDE)

- **GNOME 40+**: Electron tepsi simgesi "StatusNotifierItem" kullanır. Simge
  üst çubuktaki `^` (gizli simgeler) okunun içinde olabilir. Üst çubuğa sabitlemek için
  GNOME Tweaks → *Üst Çubuk* → *Gösterilen Simgeler* listesine ekleyin.
  Simge hiç görünmüyorsa `gnome-shell-extension-appindicator` eklentisi gerekir:
  ```bash
  sudo dnf install gnome-shell-extension-appindicator      # Fedora
  sudo apt install gnome-shell-extension-appindicator      # Ubuntu/Debian
  ```
- **KDE Plasma**: Ayarlar → Sistem Ayarları → Uygulama Başlatıcısı Ayarları →
  *Uygulama İçin Sistem Tepsisi Simgesini Göster* seçeneğini açın.
- **XFCE/MATE**: Doğrudan üst çubukta görünür.

Pencere küçültüldüğünde/kapandığında uygulama bir **bilgilendirme** gösterir;
bildirimin üzerine tıklamak pencereyi geri getirir (tepsi simgesi görünmese bile).

### Hata ayıklama

```bash
WA_DEBUG=1 npm start        # tray / UA / sayfa yükleme durumu
WA_DEBUG_NOTIFY=1 npm start # sayfa üzerinden test bildirimi gönderir
WA_DEBUG_MEDIA=1 npm start  # kamera/mikrofon tanılama (arama sorunu varsa bakın)
WA_DISABLE_GPU=1 npm start  # GPU hızlandırma kapalı (konsol uyarıları tamamen susar)
```

> **Not:** Chromium bazı Fedora/Wayland + GPU sürücüsü kombinasyonlarında
> `GetVSyncParametersIfAvailable() failed` veya
> `terminator_CreateInstance: Failed to CreateInstance in ICD` uyarıları basar.
> Bunlar **uygulama hatası değildir**, sadece GPU yüzeyi uyarılarıdır; pencere
> normal çalışır. Konsolu tamamen sessize almak için
> `WA_DISABLE_GPU=1 npm start` ile başlatın.

## Flatpak

Flatpak sarmalayıcısı `packaging/flatpak/com.jagerd07.WhatsApp.yml` içindedir.
Runtime: **org.freedesktop.Platform 25.08** (`org.freedesktop.Sdk//25.08` gerekir).

### Ön koşullar

```bash
sudo dnf install flatpak-builder
flatpak install flathub org.freedesktop.Sdk//25.08
tools/make-flatpak-icons.sh      # hicolor ikon boyutlarını üretir (bir kez)
```

### Derleme ve kurulum

```bash
# Yerel kurulum + çalıştırma
flatpak-builder --user --install --force-clean \
  .flatpak-build packaging/flatpak/com.jagerd07.WhatsApp.yml
flatpak run com.jagerd07.WhatsApp

# Dağıtım paketleri (tek dosya bundle + OCI repo)
flatpak-builder --repo=dist/flatpak-repo --force-clean \
  .flatpak-build packaging/flatpak/com.jagerd07.WhatsApp.yml
flatpak build-bundle dist/flatpak-repo \
  dist/com.jagerd07.WhatsApp.flatpak com.jagerd07.WhatsApp

# Kurulum
flatpak install --user --bundle dist/com.jagerd07.WhatsApp.flatpak
```

### Notlar

- **Electron neden ayrı modül?** Flathub'da resmî bir Electron base runtime yok
  ve freedesktop 25.08 SDK'i Node.js içermiyor. Electron'un resmî prebuilt
  paketi indirilip `/app/electron` altına yerleştirilir; uygulama kaynakları
  ayrı modüldür ve `node_modules` içermez.
- **`build-options: no-debuginfo: true` zorunlu.** flatpak-builder'ın otomatik
  debuginfo ayırma/strip işlemi Electron'un PIE binary'sini bozuyor:
  `electron --version` sessizce rc=1 dönüyor.
- **`resources/default_app.asar` silinmemeli.** Silinirse Electron hiç
  başlamıyor.
- **`LD_LIBRARY_PATH` tanımlanmamalı.** Electron kütüphanelerini binary'nin
  yanından (`$ORIGIN`) bulur; `LD_LIBRARY_PATH` tanımlanırsa `/app/lib`
  öncelik kazanır ve `libffmpeg.so` hatası verir.
- **İki farklı desktop girişi vardır** ve `main.js` doğru olanı seçer:
  flatpak'ta `com.jagerd07.WhatsApp.desktop`, normal kurulumda
  `WhatsApp.desktop`. Wayland alt-tab ikonu bu eşleşmeye bağlıdır.
- Flatpak içinde `--socket=pulseaudio` kullanılır (`--socket=pipewire` 25.08'de
  desteklenmiyor).

## Paketleme (electron-builder)

```bash
npm run dist        # .AppImage + .tar.gz  -> dist/
npm run dist:all    # tüm Linux hedefleri (rpm, deb, snap vb.)
npm run pack        # yalnızca kurulum gerektirmeyen dizin çıktısı
```

`dist/` içine üretilen dosyalar:

- `WhatsApp-1.0.0-x86_64.AppImage` (evrensel, çalıştırılabilir)
- `WhatsApp-1.0.0-x64.tar.gz` (evrensel arşiv)

### Dağıtım notları

- **AppImage**: `chmod +x WhatsApp-*.AppImage` sonra çift tıklayarak
  veya `./WhatsApp-*.AppImage` ile çalıştırılır. FUSE olmayan sistemlerde
  `--appimage-extract-and-run` kullanılabilir.
- **tar.gz**: çıkarılır, `WhatsApp` dosyası doğrudan çalıştırılır.
- İkonları yeniden üretmek için: `python3 tools/make_whatsapp_icon.py`
- Kurulumdan sonra masaüstü menüsünde **WhatsApp** adıyla görünür
- Elle kurulan (AppImage/tar.gz) sürümlerde alt-tab ikonu için
  `npm run setup:desktop:appimage` (veya `--exe <yol>`) çalıştırılmalıdır;
  paket içindeki `.desktop` dosyasını sistem elle kurmamıştır

## Gereksinimler

- Node.js 18+
- Electron 28 (devDependencies ile otomatik kurulur)
- Dağıtım tarafında: `libnotify` / D-Bus (bildirimler için),
  `libappindicator3` veya `libayatana-appindicator` (tepsi için)

## Lisans

Kod: **MIT** — tam metin için [LICENSE](LICENSE) dosyasına bakın.
Markalar: [TRADEMARKS.md](TRADEMARKS.md) (MIT kapsamında **değildir**).

> **Marka bildirimi:** Bu proje **resmî olmayan** bir istemcidir. WhatsApp LLC
> veya Meta Platforms, Inc. tarafından üretilmemiş, onaylanmış veya
> desteklenmemiştir. "WhatsApp" adı ve logosu WhatsApp LLC'nin tescilli
> markalarıdır ve yalnızca WhatsApp Web uyumluluğunu göstermek amacıyla
> kullanılır.