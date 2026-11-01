'use strict'

const { NEW_TAB_URL } = require('./lib/urls')

const LOCAL_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\])/
const FOCUS_PAGE = 'pulse://newtab/focus.html'

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
    popup.webContents.setWindowOpenHandler(({ url }) => {
      if (isWebUrl(url)) ctrl.newTab(url)
      return { action: 'deny' }
    })
    popup.webContents.on('context-menu', (_e, params) => browser.showContextMenu(ctrl, popup.webContents, params))
  })
  wc.on('context-menu', (_e, params) => browser.showContextMenu(ctrl, wc, params))
  wc.on('before-input-event', (event, input) => browser.handleShortcut(ctrl, event, input, { fromPage: true }))
  wc.on('zoom-changed', (_e, direction) => ctrl.zoom(direction === 'in' ? 1 : -1))
  wc.on('will-prevent-unload', (event) => event.preventDefault())
  wc.on('enter-html-full-screen', () => ctrl.send('fullscreen', true))
  wc.on('leave-html-full-screen', () => ctrl.send('fullscreen', ctrl.win.isFullScreen()))
  wc.on('focus', () => ctrl.tabs.focusSplitPane(tab.id))

  guardInternalPages(wc)
  wc.on('did-start-navigation', (details) => onNavigationStart(browser, ctrl, wc, tab, details))
  wc.on('did-fail-load', (_e, code, _desc, url, isMainFrame) => onLoadFailed(wc, tab, code, url, isMainFrame))
  wc.on('dom-ready', () => {
    const zoom = browser.settings.get().defaultZoom / 100
    if (!tab.userZoomed && Math.abs(wc.getZoomFactor() - zoom) > 0.001) wc.setZoomFactor(zoom)
    if (tab.volume !== 100) wc.send('pulse:volume', tab.volume)
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
}

function onNavigationStart(browser, ctrl, wc, tab, details) {
  if (!details.isMainFrame || details.isSameDocument) return
  const url = details.url

  if (browser.focus.isBlocked(url)) {
    wc.stop()
    const host = new URL(url).hostname.replace(/^www\./, '')
    wc.loadURL(`${FOCUS_PAGE}?site=${encodeURIComponent(host)}`).catch(() => {})
    return
  }

  if (browser.settings.get().httpsOnly && url.startsWith('http://')) {
    const { hostname } = new URL(url)
    if (!LOCAL_HOST.test(hostname) && !browser.httpsExceptions.has(hostname)) {
      wc.stop()
      tab.httpsUpgrade = hostname
      wc.loadURL(`https://${url.slice('http://'.length)}`).catch(() => {})
    }
  }
}

/** HTTPS-only: if the upgraded https:// load fails, fall back to http once. */
function onLoadFailed(wc, tab, code, url, isMainFrame) {
  if (!isMainFrame || code === -3 || !tab.httpsUpgrade) return // -3 = aborted
  try {
    const { hostname, protocol } = new URL(url)
    if (protocol === 'https:' && hostname === tab.httpsUpgrade) {
      tab.httpsUpgrade = null
      tab.browserHttpsFallback?.(hostname)
      wc.loadURL(url.replace(/^https:/, 'http:')).catch(() => {})
    }
  } catch {
    // Ignore malformed URLs.
  }
}

module.exports = { setupTab, isWebUrl, NEW_TAB_URL, FOCUS_PAGE }
