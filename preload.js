'use strict';

/**
 * preload.js - Güvenli köprü katmanı (contextBridge)
 *
 * - Node entegrasyonu kapalı (nodeIntegration: false, contextIsolation: true).
 * - Yalnızca dar bir API açılır: yerel bildirim gönderme + sürüm bilgisi.
 * - Sayfadaki Notification API'si main süreçteki native notifier'a (DBus /
 *   LibNotify) yönlendirilir; bu köprü o çağrıların taşıyıcısıdır.
 */

const { contextBridge, ipcRenderer } = require('electron');

/** Köprünün sadece WhatsApp Web origininde çalışmasına izin ver. */
const ALLOWED_ORIGIN = 'https://web.whatsapp.com';

function originAllowed() {
  try {
    return window.location.origin === ALLOWED_ORIGIN;
  } catch (_) {
    return false;
  }
}

contextBridge.exposeInMainWorld('whatsappDesktop', {
  platform: process.platform,
  isDesktop: true,
  appVersion: process.versions.electron,

  /**
   * Linux yerel bildirimi gösterir.
   * @param {{title?: string, body?: string, icon?: string, silent?: boolean}} options
   * @returns {boolean} istek gönderildi mi
   */
  notify(options) {
    if (!originAllowed()) return false;
    const opts = options && typeof options === 'object' ? options : {};
    ipcRenderer.send('notify', {
      title: String(opts.title || 'WhatsApp'),
      body: String(opts.body || ''),
      icon: opts.icon ? String(opts.icon) : undefined,
      silent: Boolean(opts.silent)
    });
    return true;
  },

  /** Bildirim tıklandığında uygulamayı öne getirir. */
  focusWindow() {
    if (!originAllowed()) return false;
    ipcRenderer.send('app-action', 'focus');
    return true;
  },

  /** Uygulamayı tamamen kapatır (tepsi menüsündeki "Çıkış"). */
  quitApp() {
    if (!originAllowed()) return false;
    ipcRenderer.send('app-action', 'quit');
    return true;
  }
});