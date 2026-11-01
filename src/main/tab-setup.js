'use strict'

const { NEW_TAB_URL } = require('./lib/urls')

const LOCAL_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\])/
const FOCUS_PAGE = 'pulse://newtab/focus.html'
// ERR_CONNECTION_CLOSED/RESET/REFUSED/FAILED, SSL_PROTOCOL_ERROR, ADDRESS_UNREACHABLE,
// CONNECTION_TIMED_OUT, SSL_VERSION_OR_CIPHER_MISMATCH, EMPTY_RESPONSE
const HTTPS_FALLBACK_ERRORS = new Set([-100, -101, -102, -104, -107, -109, -118, -113, -324])

/** Pages may only open ordinary web URLs; privileged schemes stay unreachable. */
function isWebUrl(url) {
  return /^https?:\/\//i.test(url) || url === 'about:blank'
}

/**
 * Wires a tab's webContents: popups, context menu, shortcuts, navigation
 * guards (internal pages, focus mode, HTTPS-only), zoom and volume.
 * @param {import('./browser').Browser} browser
 * @param {import('./window').BrowserWindowController} ctrl
 * @param {Electron.WebContents} wc
 * @param {object} tab
 */
function setupTab(browser, ctrl, wc, tab) {
  wc.setWindowOpenHandler(({ url, disposition }) => {
    if (!isWebUrl(url)) return { action: 'deny' }
    if (disposition === 'new-window') {
      // Real popups (OAuth logins etc.) keep window.opener working.
      return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, backgroundColor: '#121019', webPreferences: { session: ctrl.session, sandbox: true } } }
    }
    ctrl.newTab(url, { active: disposition !== 'background-tab' })
    return { action: 'deny' }
  })
  wc.on('did-create-window', (popup) => {
    guardPopup(popup.webContents)
    popup.webContents.setWindowOpenHandler(({ url }) => {
      if (isWebUrl(url)) ctrl.newTab(url)
      return { action: 'deny' }
    })
    popup.webContents.on('context-menu', (_e, params) => browser.showContextMenu(ctrl, popup.webContents, params))
  })
  wc.on('context-menu', (_e, params) => browser.showContextMenu(ctrl, wc, params))
  wc.on('before-input-event', (event, input) => browser.handleShortcut(ctrl, event, input, { fromPage: true, wc }))
  wc.on('zoom-changed', (_e, direction) => ctrl.zoom(direction === 'in' ? 1 : -1))
  wc.on('will-prevent-unload', (event) => event.preventDefault())
  wc.on('enter-html-full-screen', () => ctrl.send('fullscreen', true))
  wc.on('leave-html-full-screen', () => ctrl.send('fullscreen', ctrl.win.isFullScreen()))
  wc.on('focus', () => ctrl.tabs.focusSplitPane(tab.id))

  guardInternalPages(wc)
  wc.on('did-start-navigation', (details) => onNavigationStart(browser, ctrl, wc, tab, details))
  wc.on('did-fail-load', (_e, code, _desc, url, isMainFrame) => onLoadFailed(browser, wc, tab, code, url, isMainFrame))
  wc.on('dom-ready', () => {
    const zoom = browser.settings.get().defaultZoom / 100
    if (!tab.userZoomed && Math.abs(wc.getZoomFactor() - zoom) > 0.001) wc.setZoomFactor(zoom)
    if (tab.volume !== 100) wc.send('pulse:volume', tab.volume)
    if (tab.url.startsWith('pulse://')) wc.send('page:focus', browser.focus.state)
  })
}

/**
 * Websites must never reach privileged pulse:// pages, neither by navigating
 * the tab (renderer-initiated) nor by embedding them in an iframe.
 */
function guardInternalPages(wc) {
  wc.on('will-navigate', (event) => {
    if (event.url.startsWith('pulse:') && !wc.getURL().startsWith('pulse:')) event.preventDefault()
  })
  wc.on('will-frame-navigate', (event) => {
    if (!event.isMainFrame && event.url.startsWith('pulse:')) event.preventDefault()
  })
  // Pulse never redirects to its own pages, so any redirect there comes from a website.
  wc.on('will-redirect', (event) => {
    if (event.url.startsWith('pulse:')) event.preventDefault()
  })
}

/** Popups and sidebar web apps only ever show websites. */
function guardPopup(wc) {
  const block = (event) => {
    if (event.url.startsWith('pulse:')) event.preventDefault()
  }
  wc.on('will-navigate', block)
  wc.on('will-frame-navigate', block)
  wc.on('will-redirect', block)
}

function onNavigationStart(browser, ctrl, wc, tab, details) {
  if (!details.isMainFrame || details.isSameDocument) return
  const url = details.url

  if (browser.focus.isBlocked(url)) {
    const host = new URL(url).hostname.replace(/^www\./, '')
    redirect(wc, `${FOCUS_PAGE}?site=${encodeURIComponent(host)}`)
    return
  }

  if (browser.settings.get().httpsOnly && url.startsWith('http://')) {
    const { hostname } = new URL(url)
    if (!LOCAL_HOST.test(hostname) && !browser.httpsExceptions.has(hostname)) {
      tab.httpsUpgrade = hostname
      redirect(wc, `https://${url.slice('http://'.length)}`)
    }
  }
}

/**
 * Replaces a navigation that just started. Starting a new load from inside
 * did-start-navigation re-enters Chromium's navigation code and crashes, so
 * the new load is started on the next tick.
 */
function redirect(wc, url) {
  setImmediate(() => {
    if (wc.isDestroyed()) return
    wc.stop()
    wc.loadURL(url).catch(() => {})
  })
}

/** HTTPS-only: if the upgraded https:// load fails, fall back to http once. */
function onLoadFailed(browser, wc, tab, code, url, isMainFrame) {
  // Only fall back when the site simply has no HTTPS (connection-level errors).
  // Certificate errors (-200…-299) are never downgraded to HTTP.
  if (!isMainFrame || !tab.httpsUpgrade || !HTTPS_FALLBACK_ERRORS.has(code)) return
  try {
    const { hostname, protocol } = new URL(url)
    if (protocol === 'https:' && hostname === tab.httpsUpgrade) {
      tab.httpsUpgrade = null
      // Remember for this run so the site isn't upgraded (and failing) again.
      browser.httpsExceptions.add(hostname)
      redirect(wc, url.replace(/^https:/, 'http:'))
    }
  } catch {
    // Ignore malformed URLs.
  }
}

module.exports = { setupTab, guardPopup, isWebUrl, NEW_TAB_URL, FOCUS_PAGE }
