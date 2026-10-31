'use strict'

const path = require('node:path')
const { BrowserWindow, WebContentsView } = require('electron')
const { TabManager } = require('./tabs')
const { NEW_TAB_URL } = require('./lib/urls')

const PRELOAD_DIR = path.join(__dirname, '..', 'preload')
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5]
const CHROME_COLOR = '#0d0b12'

let nextWindowId = 1

/** One browser window: UI chrome + tabs + docked sidebar web panel. */
class BrowserWindowController {
  /**
   * @param {import('./browser').Browser} browser
   * @param {{ isPrivate?: boolean, session: Electron.Session, bounds?: object }} opts
   */
  constructor(browser, opts) {
    this.id = nextWindowId++
    this.browser = browser
    this.isPrivate = Boolean(opts.isPrivate)
    this.session = opts.session
    this.closedTabs = []
    this.webPanels = new Map()
    this.openPanelId = null
    this.panelBounds = null

    this.win = new BrowserWindow({
      width: 1400, height: 880, minWidth: 640, minHeight: 420, ...(opts.bounds || {}),
      show: false,
      title: this.isPrivate ? 'Pulse – Privat' : 'Pulse',
      backgroundColor: CHROME_COLOR,
      icon: path.join(__dirname, '..', '..', 'build', 'icon.png'),
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: CHROME_COLOR, symbolColor: '#e8e6f0', height: 38 },
      webPreferences: {
        preload: path.join(PRELOAD_DIR, 'ui.js'),
        // Not sandboxed: the preload needs the browser-action module from node_modules.
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
        session: browser.uiSession,
      },
    })
    this.ui = this.win.webContents
    this.ui.loadURL(`pulse://app/index.html${this.isPrivate ? '?private=1' : ''}`)
    // Dropped files/links must open as tabs instead of replacing the browser UI.
    this.ui.on('will-navigate', (event, url) => {
      event.preventDefault()
      if (/^(https?|file):/.test(url)) this.newTab(url)
    })
    this.ui.setWindowOpenHandler(() => ({ action: 'deny' }))
    this.win.once('ready-to-show', () => this.win.show())
    this.ui.on('before-input-event', (event, input) => this.browser.handleShortcut(this, event, input))
    this.win.on('enter-full-screen', () => this.send('fullscreen', true))
    this.win.on('leave-full-screen', () => this.send('fullscreen', false))
    this.win.on('focus', () => this.browser.onWindowFocus(this))

    this.tabs = new TabManager(this.win, {
      session: this.session,
      preload: path.join(PRELOAD_DIR, 'page.js'),
      isPrivate: this.isPrivate,
      setupWebContents: (wc, tab) => this.browser.setupTab(this, wc, tab),
    })
    this.tabs.on('changed', (snapshot) => this.send('tabs', snapshot))
    this.tabs.on('found', (tabId, result) => tabId === this.tabs.activeId && this.send('found', result))
    this.tabs.on('activated', (tab) => this.browser.onTabActivated(this, tab))
    this.tabs.on('navigated', (tab) => this.browser.onTabNavigated(this, tab))
    this.tabs.on('title', (tab) => this.browser.onTabTitle(this, tab))
    this.tabs.on('empty', () => this.win.close())
  }

  isFocusedOrVisible() {
    return !this.win.isDestroyed() && this.win.isVisible() && !this.win.isMinimized()
  }

  send(channel, payload) {
    if (!this.ui.isDestroyed()) this.ui.send(channel, payload)
  }

  /** Called by the UI whenever its page viewport / panel slot move. */
  setLayout({ viewport, panel }) {
    const round = (r) => r && { x: Math.round(r.x), y: Math.round(r.y), width: Math.max(0, Math.round(r.width)), height: Math.max(0, Math.round(r.height)) }
    this.tabs.setBounds(round(viewport))
    this.panelBounds = round(panel)
    const view = this.webPanels.get(this.openPanelId)
    if (view && this.panelBounds) view.setBounds(this.panelBounds)
  }

  newTab(url = NEW_TAB_URL, opts) {
    return this.tabs.create(url, opts)
  }

  closeTab(id = this.tabs.activeId) {
    const tab = this.tabs.tabs.get(id)
    if (!tab) return
    if (!this.isPrivate && tab.url && tab.url !== NEW_TAB_URL) {
      this.closedTabs = [...this.closedTabs, { url: tab.url, history: this.tabs.historyOf(tab) }].slice(-25)
    }
    this.tabs.close(id)
  }

  reopenClosedTab() {
    const last = this.closedTabs[this.closedTabs.length - 1]
    if (!last) return
    this.closedTabs = this.closedTabs.slice(0, -1)
    this.tabs.create(last.url, { history: last.history })
  }

  navigate(url, id = this.tabs.activeId) {
    const tab = this.tabs.tabs.get(id)
    if (!tab) return
    if (tab.discarded) this.tabs.activate(id)
    tab.url = url
    tab.wc.loadURL(url).catch(() => {})
    tab.wc.focus()
  }

  /** Runs a named browser action on the active tab. */
  runAction(action) {
    const tab = this.tabs.active
    const wc = tab && tab.wc && !tab.wc.isDestroyed() ? tab.wc : null
    const nav = wc && wc.navigationHistory
    const actions = {
      'new-tab': () => this.newTab(),
      'close-tab': () => this.closeTab(),
      'reopen-tab': () => this.reopenClosedTab(),
      'next-tab': () => this.tabs.activateRelative(1),
      'prev-tab': () => this.tabs.activateRelative(-1),
      'tab-last': () => this.tabs.activate(this.tabs.order[this.tabs.order.length - 1]),
      back: () => nav && nav.canGoBack() && nav.goBack(),
      forward: () => nav && nav.canGoForward() && nav.goForward(),
      reload: () => wc && wc.reload(),
      'hard-reload': () => wc && wc.reloadIgnoringCache(),
      stop: () => wc && wc.stop(),
      home: () => this.navigate(NEW_TAB_URL),
      'zoom-in': () => this.zoom(1),
      'zoom-out': () => this.zoom(-1),
      'zoom-reset': () => this.zoom(0),
      print: () => wc && wc.print(),
      devtools: () => wc && wc.toggleDevTools(),
      'view-source': () => wc && this.newTab(`view-source:${wc.getURL()}`),
      fullscreen: () => this.win.setFullScreen(!this.win.isFullScreen()),
      escape: () => (this.win.isFullScreen() ? this.win.setFullScreen(false) : this.send('escape')),
      'new-window': () => this.browser.createWindow(),
      'private-window': () => this.browser.createWindow({ isPrivate: true }),
    }
    const tabMatch = /^tab-(\d)$/.exec(action)
    if (tabMatch) return this.tabs.activate(this.tabs.order[Number(tabMatch[1]) - 1])
    if (actions[action]) return actions[action]()
    // Everything else is UI-side (find bar, panels, address focus …).
    this.send('action', action)
  }

  zoom(direction) {
    const wc = this.tabs.active && this.tabs.active.wc
    if (!wc) return
    const current = wc.getZoomFactor()
    let next = 1
    if (direction > 0) next = ZOOM_STEPS.find((z) => z > current + 0.001) || current
    if (direction < 0) next = [...ZOOM_STEPS].reverse().find((z) => z < current - 0.001) || current
    wc.setZoomFactor(next)
    this.send('zoom', Math.round(next * 100))
  }

  find(text, { forward = true, findNext = false } = {}) {
    const wc = this.tabs.active && this.tabs.active.wc
    if (!wc) return
    if (!text) return wc.stopFindInPage('clearSelection')
    wc.findInPage(text, { forward, findNext })
  }

  stopFind() {
    const wc = this.tabs.active && this.tabs.active.wc
    if (wc) wc.stopFindInPage('clearSelection')
  }

  /** Shows (or hides with null) a docked sidebar web app. */
  showWebPanel(app) {
    const current = this.webPanels.get(this.openPanelId)
    if (current) this.win.contentView.removeChildView(current)
    this.openPanelId = app ? app.id : null
    if (!app) return
    let view = this.webPanels.get(app.id)
    if (!view) {
      view = new WebContentsView({
        webPreferences: { session: this.session, preload: path.join(PRELOAD_DIR, 'page.js'), sandbox: true, contextIsolation: true },
      })
      view.setBackgroundColor('#121019')
      view.webContents.loadURL(app.url).catch(() => {})
      this.browser.setupPanel(this, view.webContents)
      this.webPanels.set(app.id, view)
    }
    this.win.contentView.addChildView(view)
    if (this.panelBounds) view.setBounds(this.panelBounds)
  }

  webPanelAction(appId, action) {
    const view = this.webPanels.get(appId)
    if (!view) return
    const wc = view.webContents
    if (action === 'reload') wc.reload()
    if (action === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
    if (action === 'unload') {
      if (this.openPanelId === appId) this.showWebPanel(null)
      wc.close()
      this.webPanels.delete(appId)
    }
  }

  destroyPanels() {
    for (const view of this.webPanels.values()) if (!view.webContents.isDestroyed()) view.webContents.close()
    this.webPanels.clear()
  }
}

module.exports = { BrowserWindowController }
