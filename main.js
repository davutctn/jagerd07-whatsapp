'use strict';

/**
 * main.js - WhatsApp masaüstü istemcisi (Electron ana süreç)
 *
 * Özellikler:
 *  - https://web.whatsapp.com yüklenir (webview değil, BrowserWindow)
 *  - Güncel Chrome User-Agent + Client Hints başlıkları ile WhatsApp Web engelinin aşılması
 *  - Linux yerel bildirimleri (DBus / LibNotify) etkinleştirilir
 *  - Sistem tepsisi (Tray): minimize edince tepsiye küçülür
 *  - Kapanışta varsayılan olarak arka planda / tepside çalışmaya devam eder
 */

const path = require('path');
const fs = require('fs');
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  Notification,
  shell,
  nativeImage,
  nativeTheme,
  session,
  desktopCapturer
} = require('electron');

const APP_ID = 'com.whatsapp.desktop';
/** Flatpak app-id (desktop girişinin dosya adı budur). */
const FLATPAK_APP_ID = 'com.jagerd07.WhatsApp';
const WHATSAPP_URL = 'https://web.whatsapp.com/';

/** Görev çubuğu / tepsi / pencelle başlığında görünen uygulama adı. */
const APP_TITLE = 'WhatsApp';

/**
 * Konsol çıktısı (Chromium log seviyesi kapandığında console.* susturulduğu
 * için doğrudan stderr'e yazılır).
 */
function log(...args) {
  process.stderr.write(args.join(' ') + '\n');
}

/** Güncel Google Chrome User-Agent (WhatsApp Web'in UA kontrolünü geçmek için). */
const CHROME_MAJOR = 131;
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/' + CHROME_MAJOR + '.0.0.0 Safari/537.36';

/** whatsapp:// deep-link desteği (telefon numarası ile sohbet açma). */
function resolveDeepLink(url) {
  if (typeof url !== 'string' || !url.toLowerCase().startsWith('whatsapp:')) return null;
  const send = /^whatsapp:\/\/send\/?\?phone=([+\d]+)/i.exec(url);
  if (send) return 'https://wa.me/' + send[1];
  return WHATSAPP_URL;
}

function findDeepLink(argv) {
  for (const arg of argv || []) {
    const resolved = resolveDeepLink(arg);
    if (resolved) return resolved;
  }
  return null;
}

/**
 * Kullanıcı isterse tepsi/arka plan davranışını kapatabilir:
 *   ./WhatsApp --no-tray
 *
 * Minimize davranışı:
 *   varsayılan  -> minimize alt barda (görev çubuğunda) kalır (diğer uygulamalar gibi)
 *   WA_MINIMIZE_TO_TRAY=1 -> minimize de tepsiye küçülür
 */
const CLOSE_TO_TRAY = !process.argv.includes('--no-tray');
const MINIMIZE_TO_TRAY =
  CLOSE_TO_TRAY && process.env.WA_MINIMIZE_TO_TRAY === '1';

// ---------------------------------------------------------------------------
// Tek örnek kilidi
// ---------------------------------------------------------------------------
const gotTheLock = app.requestSingleInstanceLock();

let mainWindow = null;
let tray = null;
let isQuitting = false;
let mediaSettings = { cameraEnabled: false };
let downloadHandlerInstalled = false;

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------
/**
 * Asset çözümleme: geliştirmede proje kökü, paketlenmiş sürümde
 * `resources/` (extraResources) içinden okur.
 */
function resourcePath(...parts) {
  const devPath = path.join(__dirname, ...parts);
  if (fs.existsSync(devPath)) return devPath;

  if (process.resourcesPath) {
    const packagedPath = path.join(process.resourcesPath, ...parts);
    if (fs.existsSync(packagedPath)) return packagedPath;
  }
  return devPath;
}

function loadImage(relative) {
  const file = resourcePath(relative);
  if (fs.existsSync(file)) {
    const img = nativeImage.createFromPath(file);
    if (!img.isEmpty()) return img;
  }
  log('[whatsapp] ikon bulunamadı:', relative);
  return nativeImage.createEmpty();
}

/**
 * Pencere boyutu/pozisyonu kalıcı: kullanıcı her açılışta aynı yerde çalışsın.
 */
const WINDOW_STATE_FILE = 'window-state.json';

function loadWindowState() {
  try {
    const file = path.join(app.getPath('userData'), WINDOW_STATE_FILE);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof data.width === 'number' && typeof data.height === 'number') return data;
  } catch (_) { /* ilk çalıştırma */ }
  return null;
}

function saveWindowState(win) {
  if (!win || win.isDestroyed() || win.isMinimized()) return;
  try {
    const bounds = win.getNormalBounds();
    const file = path.join(app.getPath('userData'), WINDOW_STATE_FILE);
    fs.writeFileSync(file, JSON.stringify(bounds));
  } catch (_) { /* yazamıyorsa sorun değil */ }
}

function restoreFromTray() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/**
 * Kamera/mikrofon tanılama aracı (WA_DEBUG_MEDIA=1 ile çalışır).
 * Sesli/görüntülü arama sorunlarında cihazların görünüp görünmediğini
 * ve getUserMedia'nın neden hata verdiğini gösterir.
 */
async function diagnoseMedia(win) {
  const probe = `(async () => {
    const out = { devices: [], gum: null, gumError: null, audio: null };
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      out.devices = list.map(d => d.kind + (d.label ? ':' + d.label : ':(isimsiz)'));
    } catch (e) {
      out.devices = ['HATA: ' + e.name];
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      out.gum = stream.getTracks().map(t => t.kind + '=' + t.label).join(', ') || 'akış alındı';
      stream.getTracks().forEach(t => t.stop());
    } catch (e) {
      out.gumError = e.name + ': ' + e.message;
    }
    try {
      const audioOnly = await navigator.mediaDevices.getUserMedia({ audio: true });
      out.audio = audioOnly.getTracks().map(t => t.kind + '=' + t.label).join(', ') || 'akış alındı';
      audioOnly.getTracks().forEach(t => t.stop());
    } catch (e) {
      out.audio = 'HATA: ' + e.name + ': ' + e.message;
    }
    return JSON.stringify(out);
  })()`;

  try {
    const result = await win.webContents.executeJavaScript(probe, true);
    log('[whatsapp:media]', result);
  } catch (err) {
    log('[whatsapp:media] tanılama çalıştırılamadı:', err.message);
  }
}

/**
 * Pencer gizlendiğinde kullanıcıyı bilgilendirir: GNOME gibi masaüstlerinde
 * tepsi simgesi "gizli simgeler" (overflow) alanında kalabildiği için
 * pencere kaybolmuş gibi görünebilir. Tekrarları önlemek için dakikada bir.
 */
let lastStillRunningNotice = 0;
function notifyStillRunning(message) {
  if (!Notification.isSupported()) return;

  const now = Date.now();
  if (now - lastStillRunningNotice < 60000) return;
  lastStillRunningNotice = now;

  const notice = new Notification({
    title: APP_TITLE,
    body: `${message}. Uygulama çalışmaya devam ediyor — tepsi simgesine tıklayarak geri aç.`,
    icon: loadImage('assets/icon.png'),
    silent: true
  });
  notice.on('click', () => restoreFromTray());
  notice.show();
  setTimeout(() => {
    try {
      notice.close();
    } catch (_) { /* yoksay */ }
  }, 8000);
}

// ---------------------------------------------------------------------------
// Oturum / ağ katmanı: UA + Client Hints + izinler
// ---------------------------------------------------------------------------
function applyUserAgent(sess) {
  sess.defaultSession.setUserAgent(USER_AGENT);

  // WhatsApp Web, Electron'a özgü "Electron/<ver>" izini de UA'da arıyor.
  // İstek başlıklarında gerçek Chrome değerleri ile değiştiriyoruz.
  sess.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = Object.assign({}, details.requestHeaders, {
      'User-Agent': USER_AGENT,
      'sec-ch-ua':
        `"Google Chrome";v="${CHROME_MAJOR}", "Chromium";v="${CHROME_MAJOR}", "Not_A Brand";v="24"`,
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Linux"',
      'Accept-Language': details.requestHeaders['Accept-Language'] || 'en-US,en;q=0.9'
    });
    delete headers['X-DevTools-Emulate-Network-Conditions-Client-Id'];
    callback({ requestHeaders: headers });
  });
}

// ---------------------------------------------------------------------------
// Kamera tercihi (gelen aramada kameranın otomatik açılmaması)
// ---------------------------------------------------------------------------
/**
 * WhatsApp Web, gelen görüntülü aramayı kamerayı AÇIK kabul ederek otomatik
 * yanıtlar. Tarayıcıda bunu engelleyen bir izin istemi çıkar; biz izinleri
 * otomatik onayladığımız için kamera sessizce açılır.
 *
 * Çözüm: kamera varsayılan olarak KAPALI. Sayfaya enjekte edilen koruma
 * katmanı (CAMERA_GUARD_JS) kamera isteyen getUserMedia() çağrılarını
 * reddeder; mikrofon çalışmaya devam eder. Kullanıcı isterse tepsi
 * menüsünden "Kamerayı Etkinleştir" ile açar (kalıcı ayar).
 */
const MEDIA_SETTINGS_FILE = 'media-settings.json';

function loadMediaSettings() {
  try {
    const file = path.join(app.getPath('userData'), MEDIA_SETTINGS_FILE);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { cameraEnabled: data.cameraEnabled === true };
  } catch (_) { /* ilk çalıştırma -> kapalı */ }
  return { cameraEnabled: false };
}

function saveMediaSettings(settings) {
  try {
    const file = path.join(app.getPath('userData'), MEDIA_SETTINGS_FILE);
    fs.writeFileSync(file, JSON.stringify(settings));
  } catch (_) { /* yazamıyorsa sorun değil */ }
}

/**
 * Başlangıç tercihi: kayıtlı ayar esas alınır. Kalıcı olan yalnızca
 * `--camera` / `--no-camera` bayraklarıdır (tepsi menüsü de kalıcı yazar).
 * `WA_CAMERA` ortam değişkeni sadece o oturumu etkiler, diske yazılmaz.
 */
function initCameraPreference() {
  const settings = loadMediaSettings();

  if (process.argv.includes('--camera')) {
    settings.cameraEnabled = true;
    saveMediaSettings(settings);
  } else if (process.argv.includes('--no-camera')) {
    settings.cameraEnabled = false;
    saveMediaSettings(settings);
  }

  if (process.env.WA_CAMERA === '1') settings.cameraEnabled = true;
  if (process.env.WA_CAMERA === '0') settings.cameraEnabled = false;

  return settings;
}

/**
 * Sayfaya enjekte edilen kamera koruması.
 *
 * Amaç: WhatsApp Web'in gelen görüntülü aramayı kamerayı AÇIK kabul ederek
 * otomatik yanılamasını engellemek.
 *
 * ÖNEMLİ — koruma yalnızca İLK kamera isteğini reddeder. Çünkü:
 *  - WhatsApp sayfa yüklenirken otomatik olarak kamera ister (istenmeyen),
 *  - ama kullanıcı konuşma içinde "kamerayı aç" dediğinde yeni bir istek
 *    gelir ve bu İSTEĞİN geçmesi gerekir.
 * İlk ret sonrası kilit açılır: `__waCameraAutoBlocked = true`.
 *
 * `cameraEnabled` true ise (tepsi menüsünden açıldıysa) hiç engel yok.
 */
function cameraGuardScript(cameraEnabled) {
  return `(function () {
  window.__waDesktopCamera = ${cameraEnabled ? 'true' : 'false'};
  // Sayfa yeniden yüklendiğinde sıfırlanır: her yüklemede ilk istek yine engellenir.
  window.__waCameraAutoBlocked = false;
  if (window.__waCameraGuardInstalled || !navigator.mediaDevices) return;
  window.__waCameraGuardInstalled = true;

  var original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);

  function wantsVideo(constraints) {
    if (!constraints) return false;
    if (Array.isArray(constraints.video)) return constraints.video.length > 0;
    return Boolean(constraints.video);
  }

  navigator.mediaDevices.getUserMedia = function (constraints) {
    var cameraWanted = wantsVideo(constraints);

    // Kamera açık ayarıysa ya da otomatik açılma zaten engellendiyse geçir.
    if (!cameraWanted || window.__waDesktopCamera || window.__waCameraAutoBlocked) {
      return original(constraints);
    }

    // İlk kamera isteği: engelle ve kilidi aç ki kullanıcı konuşma içinde
    // kamerayı açabilsin.
    window.__waCameraAutoBlocked = true;
    console.warn('[whatsapp] otomatik kamera açılışı engellendi');
    return Promise.reject(new DOMException(
      'Kamera otomatik olarak acilmadi. Konusma icinden kamera simgesine basarak acabilirsiniz.',
      'NotAllowedError'
    ));
  };
})();`;
}

/**
 * Kamerayı aç/kapat: sayfa bayrağını günceller.
 *
 * Sayfa YENİDEN YÜKLENMEZ. Yenileme WhatsApp oturumunu düşürür ve
 * devam eden aramayı sonlandırırdı; oysa değişiklik çalışan bir sonraki
 * getUserMedia çağrısında geçerli olur.
 */
function applyCameraPreference() {
  const enabled = mediaSettings.cameraEnabled;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents
      .executeJavaScript(
        'window.__waDesktopCamera = ' + (enabled ? 'true' : 'false') + ';' +
        'window.__waCameraAutoBlocked = false;'
      )
      .catch(() => {});
  }
  log('[whatsapp] kamera:', enabled ? 'acik (arama kamerasi etkin)' : 'kapali');
  return enabled;
}

/**
 * WhatsApp Web'in ihtiyaç duyduğu tüm izinler.
 * ÖNEMLİ: hem "request" hem "check" aynı listeyi kullanmalı. Check reddedilirse
 * tarayıcı izin verilmiş olsa bile getUserMedia() NotAllowedError döner ve
 * sesli/görüntülü arama "izin listesinde hiçbir şey yok" şeklinde görünür.
 */
const ALLOWED_PERMISSIONS = new Set([
  'media',                       // kamera + mikrofon (arama)
  'audioCapture',
  'videoCapture',
  'display-capture',             // ekran paylaşımı (görüntülü arama)
  'clipboard-read',
  'clipboard-sanitized-write',   // Ctrl+V ile resim/fotoğraf yapıştırma
  'notifications',
  'fullscreen',
  'pointerLock',
  'idle-detection',
  'background-sync',
  'midi',
  'midi-sysex',
  'window-management',           // WhatsApp ayarlarını yeni pencerede açma
  'storage-access'
]);

function setupPermissions(sess) {
  // Linux'ta kararlı bildirim etiketi (DBus / LibNotify zorunlu).
  app.setAppUserModelId(APP_ID);

  const defaultSession = sess.defaultSession;

  applySessionPermissions(defaultSession);
  setupDisplayMedia(defaultSession);
}

/**
 * İzin katmanı.
 *
 * Buradaki TÜM izinler onaylanır. Kamera engellemesi bilinçli olarak
 * burada yapılmaz:
 *
 *  - `setPermissionRequestHandler` bir kez "deny" dediğinde Chromium bunu
 *    kalıcı olarak BLOCKED olarak kaydeder. Sonuç: konuşma içinde "kamerayı
 *    aç" düğmesi çalışmaz (izin artık geri gelmez).
 *  - Otomatik açılmayı engellemek için sayfa katmanı (cameraGuardScript)
 *    kullanılır; bu yalnızca İLK otomatik isteği engeller, sonraki
 *    (kullanıcının konuşma içinde yaptığı) isteğe izin verir.
 */
function applySessionPermissions(defaultSession) {
  const isAllowed = (permission) => ALLOWED_PERMISSIONS.has(permission);

  // 1) İzin istekleri (kamera, mikrofon, ekran, pano ...) -> otomatik onayla
  defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(isAllowed(permission));
  });

  // 2) İzin sorguları -> isteklerle aynı liste.
  //    Bu ikisi tutarsızsa arama bileşeni cihaz listesini boş görür.
  defaultSession.setPermissionCheckHandler((_contents, permission) => isAllowed(permission));

  // 3) Cihaz listesi boş görünmesin diye etiketlerin (kamera adı vb.) açığa
  //    çıkması gerekir; bu izin "media" verildiğinde Chromium bunu yapar.
  //    Yine de güvence olarak cihaz listesini açığa çıkarıyoruz.
  try {
    defaultSession.setDevicePermissionHandler((details) =>
      details.deviceType === 'audioInput' ||
      details.deviceType === 'videoInput' ||
      details.deviceType === 'audioOutput'
    );
  } catch (err) {
    // Electron sürümü desteklemiyorsa sorun değil (28+ destekler).
    log('[whatsapp] setDevicePermissionHandler kullanılamadı:', err.message);
  }

  log(
    '[whatsapp] izinler ayarlandı (media, audioCapture, videoCapture, display-capture);',
    'kamera otomatik acilisi:',
    mediaSettings.cameraEnabled ? 'acik' : 'engelli'
  );
}

/** Ekran paylaşımı (WhatsApp görüntülü aramada sunar). */
function setupDisplayMedia(defaultSession) {

  // 4) Ekran paylaşımı (WhatsApp görüntülü aramada sunar).
  //    Wayland'da sistem seçici kullanılır, X11'de ilk ekran kaynağı seçilir.
  try {
    defaultSession.setDisplayMediaRequestHandler(
      (_request, callback) => {
        desktopCapturer
          .getSources({ types: ['screen', 'window'] })
          .then((sources) => {
            if (!sources.length) {
              callback({});
              return;
            }
            callback({ video: sources[0], audio: 'loopback' });
          })
          .catch(() => callback({}));
      },
      { useSystemPicker: true }
    );
  } catch (err) {
    log('[whatsapp] ekran paylaşımı ayarlanamadı:', err.message);
  }
}

/**
 * Sesli/görüntülü arama için WebRTC ayarları.
 * Linux'ta mDNS gizleme (WebRtcHideLocalIpsWithMdns) yerel cihaz/keşif
 * sorunlarına yol açabiliyor; kapatıyoruz.
 */
function applyMediaSwitches() {
  app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');
  // WhatsApp Web bildirim sesleri/medya otomatik oynatır.
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
}

// ---------------------------------------------------------------------------
// Sayfa içi bildirim köprüsü (Electron renderer'da Notification API yok)
// ---------------------------------------------------------------------------
const NOTIFICATION_BRIDGE_JS = `
(() => {
  if (window.__whatsappNotificationHooked || !window.whatsappDesktop) return;
  window.__whatsappNotificationHooked = true;

  const Native = window.Notification;
  const granted = Native && Native.permission === 'granted';

  function Shim(title, options) {
    const opts = typeof options === 'string' ? { body: options } : (options || {});
    try {
      window.whatsappDesktop.notify({
        title: String(title || 'WhatsApp'),
        body: String(opts.body || ''),
        icon: opts.icon ? String(opts.icon) : undefined,
        silent: Boolean(opts.silent)
      });
    } catch (err) { /* yoksay */ }
    return { close() {}, addEventListener() {}, removeEventListener() {}, onclick: null };
  }

  Shim.permission = 'granted';
  Shim.maxActions = 2;
  Shim.requestPermission = (cb) => {
    const p = Promise.resolve('granted');
    if (typeof cb === 'function') cb('granted');
    return p;
  };

  try {
    Object.defineProperty(window, 'Notification', { value: Shim, configurable: true });
  } catch (err) { /* yoksay */ }

  // WhatsApp Web bildirimleri ServiceWorker üzerinden de gelir: yakala.
  if (navigator.serviceWorker && navigator.serviceWorker.register) {
    try {
      const orig = navigator.serviceWorker.register.bind(navigator.serviceWorker);
      navigator.serviceWorker.register = (...args) => orig(...args);
    } catch (err) { /* yoksay */ }
  }
  void granted;
})();
`;

// ---------------------------------------------------------------------------
// Pencere
// ---------------------------------------------------------------------------
function createWindow() {
  const saved = loadWindowState();

  mainWindow = new BrowserWindow({
    width: saved ? saved.width : 1280,
    height: saved ? saved.height : 860,
    x: saved ? saved.x : undefined,
    y: saved ? saved.y : undefined,
    minWidth: 400,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b141a',
    icon: loadImage('assets/icon.png'),
    title: APP_TITLE,
    webPreferences: {
      preload: resourcePath('preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: false,
      spellcheck: true,
      backgroundThrottling: false
    }
  });

  mainWindow.loadURL(WHATSAPP_URL);

  if (process.env.WA_DEBUG) {
    mainWindow.webContents.on('did-finish-load', () => {
      log('[whatsapp:debug] did-finish-load ->', mainWindow.webContents.getURL());
      mainWindow.webContents
        .executeJavaScript(
          'JSON.stringify({ bridge: !!window.whatsappDesktop,' +
            ' notification: typeof window.Notification,' +
            ' permission: window.Notification && window.Notification.permission })'
        )
        .then((r) => log('[whatsapp:debug] page =', r))
        .catch(() => {});

      // Bildirim hattını test et:  WA_DEBUG_NOTIFY=1 npm start
      if (process.env.WA_DEBUG_NOTIFY) {
        log('[whatsapp:debug] native bildirim destekleniyor mu =', Notification.isSupported());
        mainWindow.webContents
          .executeJavaScript("window.whatsappDesktop.notify({ title: 'WhatsApp', body: 'Yerel bildirim testi' })")
          .catch((err) => log('[whatsapp:debug] notify hatası:', err));
      }
    });
    mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
      log('[whatsapp:debug] did-fail-load', code, desc, url);
    });

    // Medya tanılama: kamera/mikrofon gerçekten erişilebiliyor mu?
    //   WA_DEBUG_MEDIA=1 npm start
    if (process.env.WA_DEBUG_MEDIA) {
      mainWindow.webContents.on('did-finish-load', () => {
        diagnoseMedia(mainWindow);
      });
    }
  }

  mainWindow.once('ready-to-show', () => {
    if (!app.commandLine.hasSwitch('hidden')) mainWindow.show();
  });

  // Ek / medya indirmeleri (fotoğraf, video, ses, belge) masaüstü indirme
  // klasörüne gider ve pencere öne getirilir.
  //
  // NOT: Oturum (session) paylaşımlı olduğu için bu dinleyici pencere
  // yeniden oluşturulduğunda üst üste binmesin diye yalnızca bir kez kurulur.
  if (!downloadHandlerInstalled) {
    downloadHandlerInstalled = true;
    mainWindow.webContents.session.on('will-download', (_event, item) => {
      const defaultPath = path.join(app.getPath('downloads'), item.getFilename());
      item.setSavePath(defaultPath);
      item.on('updated', (_e, state) => {
        if (state === 'interrupted') {
          log('[whatsapp] indirme kesildi:', item.getFilename());
        }
      });
      item.once('done', (_e, state) => {
        log('[whatsapp] indirme', state === 'completed' ? 'tamamlandı' : 'durduruldu', ':', item.getFilename());
        restoreFromTray();
      });
    });
  }

  // Yeni pencere istekleri (tel:, mailto:, YouTube...) sistem tarayıcısında açılır.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const protocol = new URL(url).protocol;
      if (['https:', 'http:', 'mailto:', 'tel:'].includes(protocol)) {
        shell.openExternal(url);
      }
    } catch (_) { /* geçersiz URL */ }
    return { action: 'deny' };
  });

  // Uygulama dışı gezinmeyi engelle, harici bağlantıyı tarayıcıda aç.
  //
  // Dikkat: `getURL()` navigasyon sırasında HENÜZ yeni adresi döndürdüğü için
  // eski sürümdeki "url !== getURL()" karşılaştırması yanlış negatif üretiyordu.
  // Doğru kontrol: adres uygulamaya ait mi?
  const isAppUrl = (url) =>
    url === WHATSAPP_URL ||
    url.startsWith('https://web.whatsapp.com') ||
    url.startsWith('https://wa.me/') ||           // deep-link yönlendirmesi
    url.startsWith('https://web.whatsapp.com/settings');

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    if (/^https?:/.test(url)) shell.openExternal(url);
  });

  // Bildirim köprüsünü ve kamera korumasını her sayfa yüklemesinde kur.
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.executeJavaScript(NOTIFICATION_BRIDGE_JS).catch(() => {});
    mainWindow.webContents
      .executeJavaScript(cameraGuardScript(mediaSettings.cameraEnabled))
      .catch(() => {});
  });

  // Kamera tercihi değişti: sayfayı yenilemek WhatsApp oturumunu düşürür ve
  // devam eden aramayı sonlandırırdı. Bunun yerine yalnızca sayfa içindeki
  // bayrak güncellenir; bir sonraki getUserMedia çağrısı geçerli olur.
  mainWindow.on('camera-preference-changed', () => {
    applyCameraPreference();
  });

  // --- Pencere olayları ---
  mainWindow.on('minimize', (event) => {
    if (MINIMIZE_TO_TRAY && tray) {
      event.preventDefault(); // bazı WM'lerde çalışır
      mainWindow.hide();      // tepsiye küçül
      notifyStillRunning('Pencere arka plana alındı');
    }
    // Varsayılan: minimize alt barda (görev çubuğunda) kalır.
  });

  mainWindow.on('close', (event) => {
    saveWindowState(mainWindow);
    // Varsayılan davranış: kapatınca arka planda / tepside çalışmaya devam et.
    if (!isQuitting && CLOSE_TO_TRAY && tray) {
      event.preventDefault();
      mainWindow.hide();
      notifyStillRunning('Uygulama arka planda çalışıyor');
    }
  });

  mainWindow.on('closed', () => {
    saveWindowState(mainWindow);
    mainWindow = null;
  });

  return mainWindow;
}

// ---------------------------------------------------------------------------
// Sistem tepsisi
// ---------------------------------------------------------------------------
function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: APP_TITLE, enabled: false },
    { type: 'separator' },
    { label: 'Pencereyi Göster', click: () => restoreFromTray() },
    { label: 'WhatsApp Web', click: () => shell.openExternal(WHATSAPP_URL) },
    { type: 'separator' },
    {
      label: 'Aramalarda Kamerayı Aç',
      type: 'checkbox',
      checked: mediaSettings.cameraEnabled,
      click: (item) => {
        mediaSettings.cameraEnabled = item.checked;
        saveMediaSettings(mediaSettings);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.emit('camera-preference-changed');
        } else {
          applyCameraPreference();
        }
        tray.setContextMenu(buildTrayMenu());
      }
    },
    { type: 'separator' },
    {
      label: 'Çıkış',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);
}

function createTray() {
  // Linux masaüstlerinde 22x22 px ikon önerilir.
  let icon = loadImage('assets/tray.png');
  if (icon.isEmpty()) icon = loadImage('assets/icon.png');
  if (icon.isEmpty()) return; // ikon yoksa tepsiyi hiç oluşturma

  tray = new Tray(icon.resize({ width: 22, height: 22, quality: 'best' }));
  tray.setToolTip(APP_TITLE);
  tray.setContextMenu(buildTrayMenu());

  tray.on('click', () => {
    if (mainWindow && mainWindow.isVisible() && !mainWindow.isMinimized()) {
      mainWindow.hide();
    } else {
      restoreFromTray();
    }
  });

  tray.on('double-click', () => restoreFromTray());
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
ipcMain.on('notify', (_event, payload) => {
  if (!Notification.isSupported()) {
    log('[whatsapp] yerel bildirim desteklenmiyor (DBus/notify-send yok?)');
    return;
  }

  const data = payload || {};

  const notification = new Notification({
    title: data.title || 'WhatsApp',
    body: data.body || '',
    icon: loadImage('assets/icon.png'),
    silent: Boolean(data.silent)
  });

  notification.on('click', () => restoreFromTray());
  notification.show();
});

ipcMain.on('notify-click', () => restoreFromTray());

ipcMain.on('app-action', (_event, action) => {
  if (action === 'quit') {
    isQuitting = true;
    app.quit();
    return;
  }
  restoreFromTray();
});

ipcMain.on('get-version', (event) => {
  event.returnValue = app.getVersion();
});

// ---------------------------------------------------------------------------
// Yaşam döngüsü
// ---------------------------------------------------------------------------
if (!gotTheLock) {
  // Başka bir örnek zaten çalışıyor -> bu süreç sonlanır.
  log('[whatsapp] uygulama zaten çalışıyor, mevcut pencere öne getirildi.');
  app.quit();
} else {
  // Bazı Fedora/Wayland + GPU sürücüsü kombinasyonlarında Chromium konsola
  // "GetVSyncParametersIfAvailable() failed" / "terminator_CreateInstance"
  // uyarıları basar. Bunlar **uygulama hatası değildir** (GPU yüzeyi uyarısı).
  // Konsolu tamamen sessize almak isteyenler:  WA_DISABLE_GPU=1 npm start
  if (process.env.WA_DISABLE_GPU === '1') {
    app.disableHardwareAcceleration();
    log('[whatsapp] GPU hızlandırma kapatıldı (WA_DISABLE_GPU=1)');
  }

  // Görev çubuğu/alt bar etiketi "WhatsApp" görünsün (diğer uygulamalar gibi).
  app.setName(APP_TITLE);
  if (process.platform === 'linux') {
    // Wayland alt-tab (GNOME Shell) pencere ikonunu, uygulamanın app_id'siyle
    // eşleşen .desktop dosyasından bulur. app_id bu değerden türetilir.
    //
    // Flatpak'ta yayınlanan dosya adı app-id ile aynıdır
    // (com.jagerd07.WhatsApp.desktop); normal kurulumda ise WhatsApp.desktop
    // kullanılır (tools/install-desktop.sh). Yanlış ad seçilirse alt-tab'da
    // generic ikon görünür.
    const isFlatpak = Boolean(process.env.FLATPAK_ID);
    const desktopEntry = isFlatpak ? `${FLATPAK_APP_ID}.desktop` : 'WhatsApp.desktop';

    app.setDesktopName(desktopEntry);
    log('[whatsapp] desktop entry:', desktopEntry, '(flatpak:', isFlatpak + ')');
  }

  app.on('second-instance', (_event, argv) => {
    restoreFromTray();
    const deepLink = findDeepLink(argv);
    if (deepLink && mainWindow) mainWindow.loadURL(deepLink);
  });

  app.setAsDefaultProtocolClient('whatsapp');

  // Kamera tercihi (varsayılan: kapalı) ve komut satırı anahtarları
  // hazır olmadan, uygulama başlamadan ayarlanmalı.
  mediaSettings = initCameraPreference();
  applyMediaSwitches();

app.whenReady().then(() => {
    nativeTheme.themeSource = 'system';

    applyUserAgent(session);
    setupPermissions(session);

    createWindow();
    createTray();

    if (process.env.WA_DEBUG) {
      log('[whatsapp:debug] tray =', tray ? 'olusturuldu' : 'yok (ikon bulunamadi?)');
      log('[whatsapp:debug] user-agent =', session.defaultSession.getUserAgent());
    } else {
      log('[whatsapp] çalışıyor — pencere açıldı. Çıkmak için Ctrl+C veya tepsi > Çıkış');
    }

    // Başlangıçta deep-link ile açıldıysa (whatsapp://...) uygula.
    const initialDeepLink = findDeepLink(process.argv);
    if (initialDeepLink && initialDeepLink !== WHATSAPP_URL && mainWindow) {
      mainWindow.loadURL(initialDeepLink);
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else restoreFromTray();
    });
  });

  // Tüm pencereler kapansa bile uygulama tepside yaşamaya devam eder.
  app.on('window-all-closed', () => {
    if (isQuitting || !CLOSE_TO_TRAY) app.quit();
  });
}

app.on('before-quit', () => {
  isQuitting = true;
  if (tray) {
    tray.destroy();
    tray = null;
  }
});

// Linux'ta "Quit" menüsü çalışmadığı ortamlarda (GNOME v39+) SIGTERM'i de yakala.
process.on('SIGTERM', () => {
  isQuitting = true;
  app.quit();
});

// Terminalden Ctrl+C ile kapatıldığında düzgün çıkış (geliştirme kolaylığı).
process.on('SIGINT', () => {
  log('[whatsapp] kapatiliyor...');
  isQuitting = true;
  app.quit();
});

process.on('uncaughtException', (err) => {
  log('[whatsapp] beklenmeyen hata:', err);
});