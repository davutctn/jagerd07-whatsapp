# JagerD07 WhatsApp Desktop Application

Tüm Linux dağıtımlarında (Fedora, Ubuntu, Arch, Debian vb.) sorunsuz çalışabilecek Electron tabanlı özel bir WhatsApp masaüstü uygulaması kodla.

## Gereksinimler & Yapılandırma
1. **Dosya Yapısı:**
   - `package.json` (Proje bağımlılıkları ve build scriptleri)
   - `main.js` (Electron ana süreç kodları)
   - `preload.js` (Gerekiyorsa güvenlik ve köprü katmanı)

2. **Özellikler:**
   - Webview veya BrowserWindow içinde `https://web.whatsapp.com` adresini yükle.
   - Güncel Google Chrome User-Agent başlığı tanımla (WhatsApp Web engelini aşmak için).
   - Linux yerel bildirim desteğini etkinleştir.
   - Sistem tepsisi (System Tray) simgesi ekle (minimize edildiğinde tepsiye küçülsün).
   - Kapanışta varsayılan olarak arka planda/tepside çalışmaya devam etsin.

3. **Paketleme (electron-builder):**
   - `package.json` içine `electron-builder` yapılandırmasını ekle.
   - Evrensel `.AppImage` ve `.tar.gz` çıktıları üretecek `npm run dist` scriptini tanımla.
