'use strict'

const path = require('node:path')
const crypto = require('node:crypto')
const { app, session, BrowserWindow, shell, Notification } = require('electron')
const { JsonStore } = require('./store')
const { DEFAULT_SETTINGS, SEARCH_ENGINES } = require('./defaults')
const { Bookmarks, History } = require('./library')
const { PasswordVault } = require('./passwords')
const { Downloads } = require('./downloads')
const { Permissions } = require('./permissions')
const { AdBlock } = require('./adblock')
const { Extensions } = require('./extensions')
const { ResourceLimiter } = require('./limiter')
const { Updater } = require('./updater')
const { FaviconService } = require('./favicons')
const { BrowserWindowController } = require('./window')
const { buildContextMenu } = require('./context-menu')
const { matchShortcut } = require('./lib/shortcuts')
const { NEW_TAB_URL, resolveInput } = require('./lib/urls')

const PENDING_PASSWORD_TTL_MS = 5 * 60 * 1000

/** Application root: shared services and all windows. */
class Browser {
  constructor() {
    const dir = app.getPath('userData')
    this.userData = dir
    this.settings = new JsonStore(path.join(dir, 'settings.json'), DEFAULT_SETTINGS)
    this.sessionStore = new JsonStore(path.join(dir, 'session.json'), { windows: [] })
    this.bookmarks = new Bookmarks(path.join(dir, 'bookmarks.json'))
    this.history = new History(path.join(dir, 'history.json'))
    this.passwords = new PasswordVault(path.join(dir, 'passwords.json'))
    this.permissions = new Permissions(path.join(dir, 'permissions.json'))
    this.favicons = new FaviconService(dir, () => this.mainSession)
    this.windows = new Map()
    this.lastFocused = null
    this.pendingPasswords = new Map()
    this.privateCounter = 0
    this.quitting = false
  }

  get uiSession() {
    return session.defaultSession
  }

  get mainSession() {
    return session.defaultSession
  }

  async init() {
    this.downloads = new Downloads((startedIn) => {
      for (const w of this.windows.values()) w.send('downloads', { list: this.downloads.list(w.session), started: startedIn === w.session })
    })
    this.downloads.attach(this.mainSession)
    this.permissions.attach(this.mainSession)
    this.adblock = new AdBlock(this.userData, (wcId) => this.onAdBlocked(wcId))
    this.extensions = new Extensions({
      session: this.mainSession,
      userData: this.userData,
      createTab: async (details) => {
        const ctrl = this.windowFor(details.windowId) || this.focusedWindow() || this.createWindow()
        const tab = ctrl.newTab(details.url || NEW_TAB_URL, { active: details.active !== false })
        return [tab.wc, ctrl.win]
      },
      // The library also "selects" every tab it starts tracking; only honour real extension requests.
      selectTab: (wc) => !this.registeringTab && this.withTab(wc, (ctrl, tab) => ctrl.tabs.activeId !== tab.id && ctrl.tabs.activate(tab.id)),
      removeTab: (wc) => this.withTab(wc, (ctrl, tab) => ctrl.closeTab(tab.id)),
      createWindow: async (details) => {
        const url = Array.isArray(details.url) ? details.url[0] : details.url
        return this.createWindow({ url, isPrivate: Boolean(details.incognito) }).win
      },
    })
    this.extensions.api.constructor.handleCRXProtocol(this.uiSession)

    await Promise.all([this.adblock.init(), this.extensions.init()])
    this.applySettings()
    this.settings.onChange(() => this.applySettings())

    this.limiter = new ResourceLimiter({
      getSettings: () => this.settings.get(),
      getWindows: () => [...this.windows.values()],
      onSample: (sample) => this.onLimiterSample(sample),
    })
    this.limiter.start()

    this.updater = new Updater((state) => this.broadcast('update', state))
    this.updater.start()
  }

  applySettings() {
    const s = this.settings.get()
    for (const ses of this.allSessions()) this.adblock.setEnabled(ses, s.adblock)
    if (this.limiter) this.limiter.applyNetworkLimit()
    this.broadcast('settings', this.publicSettings())
    this.broadcastToInternalPages('page:settings', this.newtabData())
  }

  /** Settings the start page needs (theme, wallpaper, effects, speed dial). */
  newtabData() {
    const s = this.settings.get()
    return { speedDial: s.speedDial, accent: s.accent, wallpaper: s.wallpaper, searchEngine: s.searchEngine, bgEffect: s.bgEffect, animations: s.animations }
  }

  broadcastToInternalPages(channel, payload) {
    for (const ctrl of this.windows.values()) {
      for (const tab of ctrl.tabs.tabs.values()) {
        if (tab.wc && !tab.wc.isDestroyed() && tab.wc.getURL().startsWith('pulse://')) tab.wc.send(channel, payload)
      }
    }
  }

  publicSettings() {
    return { ...this.settings.get(), searchEngines: Object.keys(SEARCH_ENGINES) }
  }

  searchTemplate() {
    return SEARCH_ENGINES[this.settings.get().searchEngine] || SEARCH_ENGINES.google
  }

  resolveInput(text) {
    return resolveInput(text, this.searchTemplate())
  }

  allSessions() {
    return new Set([this.mainSession, ...[...this.windows.values()].map((w) => w.session)])
  }

  // ---- windows ---------------------------------------------------------

  createWindow({ isPrivate = false, url, restore, bounds } = {}) {
    const ses = isPrivate ? session.fromPartition(`pulse-private-${++this.privateCounter}`) : this.mainSession
    if (isPrivate) {
      this.downloads.attach(ses)
      this.permissions.attach(ses, { remember: false })
      this.adblock.setEnabled(ses, this.settings.get().adblock)
      ses.setUserAgent(app.userAgentFallback)
    }
    const ctrl = new BrowserWindowController(this, { isPrivate, session: ses, bounds })
    this.windows.set(ctrl.id, ctrl)
    this.lastFocused = ctrl

    ctrl.win.on('close', () => {
      if (!this.quitting && !isPrivate) this.saveSession()
    })
    ctrl.win.on('closed', () => {
      this.windows.delete(ctrl.id)
      if (this.lastFocused === ctrl) this.lastFocused = null
      try {
        ctrl.tabs.destroyAll()
        ctrl.destroyPanels()
      } finally {
        if (isPrivate) ses.clearStorageData().catch(() => {})
      }
    })

    if (restore && restore.tabs.length) {
      restore.tabs.forEach((t, i) => ctrl.newTab(t.url, { active: i === restore.activeIndex, pinned: t.pinned, history: t.history, index: i }))
    } else {
      ctrl.newTab(url || NEW_TAB_URL)
    }
    return ctrl
  }

  restoreOrCreate() {
    const saved = this.settings.get().restoreSession ? this.sessionStore.get().windows : []
    if (!saved.length) return this.createWindow()
    for (const w of saved) this.createWindow({ restore: w, bounds: w.bounds })
  }

  saveSession() {
    const windows = [...this.windows.values()]
      .filter((w) => !w.isPrivate && !w.win.isDestroyed())
      .map((w) => ({ bounds: w.win.getNormalBounds(), ...w.tabs.serialize() }))
    this.sessionStore.update(() => ({ windows }))
    this.sessionStore.flush()
  }

  shutdown() {
    this.quitting = true
    // Closing the last window already saved the session; don't overwrite it with nothing.
    if ([...this.windows.values()].some((w) => !w.isPrivate && !w.win.isDestroyed())) this.saveSession()
    for (const store of [this.settings, this.bookmarks.store, this.history.store, this.passwords.store, this.permissions.store, this.favicons.store]) store.flush()
    if (this.limiter) this.limiter.stop()
  }

  focusedWindow() {
    const focused = BrowserWindow.getFocusedWindow()
    return [...this.windows.values()].find((w) => w.win === focused) || this.lastFocused || [...this.windows.values()][0] || null
  }

  windowFor(id) {
    return id ? [...this.windows.values()].find((w) => !w.win.isDestroyed() && w.win.id === id) : null
  }

  windowForUi(wc) {
    return [...this.windows.values()].find((w) => w.ui === wc) || null
  }

  withTab(wc, fn) {
    for (const ctrl of this.windows.values()) {
      const tab = ctrl.tabs.byWebContents(wc)
      if (tab) return fn(ctrl, tab)
    }
    return undefined
  }

  broadcast(channel, payload) {
    for (const w of this.windows.values()) w.send(channel, payload)
  }

  onWindowFocus(ctrl) {
    this.lastFocused = ctrl
    const tab = ctrl.tabs.active
    if (tab && tab.wc && !ctrl.isPrivate) this.extensions.api.selectTab(tab.wc)
  }

  // ---- tabs ------------------------------------------------------------

  setupTab(ctrl, wc, tab) {
    if (!ctrl.isPrivate) {
      this.registeringTab = true
      try {
        this.extensions.api.addTab(wc, ctrl.win)
      } finally {
        this.registeringTab = false
      }
    }
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
      popup.webContents.on('context-menu', (_e, params) => this.showContextMenu(ctrl, popup.webContents, params))
    })
    wc.on('context-menu', (_e, params) => this.showContextMenu(ctrl, wc, params))
    wc.on('before-input-event', (event, input) => this.handleShortcut(ctrl, event, input, { fromPage: true }))
    wc.on('zoom-changed', (_e, direction) => ctrl.zoom(direction === 'in' ? 1 : -1))
    wc.on('will-prevent-unload', (event) => event.preventDefault())
    wc.on('enter-html-full-screen', () => ctrl.send('fullscreen', true))
    wc.on('leave-html-full-screen', () => ctrl.send('fullscreen', ctrl.win.isFullScreen()))
  }

  setupPanel(ctrl, wc) {
    wc.setWindowOpenHandler(({ url }) => {
      if (isWebUrl(url)) ctrl.newTab(url)
      return { action: 'deny' }
    })
    wc.on('context-menu', (_e, params) => this.showContextMenu(ctrl, wc, params))
  }

  showContextMenu(ctrl, wc, params) {
    const menu = buildContextMenu({
      wc,
      params,
      openTab: (url, opts) => ctrl.newTab(url, opts),
      openPrivate: (url) => this.createWindow({ isPrivate: true, url }),
      searchUrl: (q) => this.searchTemplate().replace('%s', encodeURIComponent(q)),
      extensionItems: ctrl.isPrivate ? [] : this.extensions.api.getContextMenuItems(wc, params),
    })
    menu.popup({ window: ctrl.win })
  }

  handleShortcut(ctrl, event, input, { fromPage = false } = {}) {
    const action = matchShortcut(input)
    if (!action) return
    if (fromPage && action === 'escape') return
    event.preventDefault()
    ctrl.runAction(action)
  }

  onTabActivated(ctrl, tab) {
    if (!ctrl.isPrivate && tab.wc) this.extensions.api.selectTab(tab.wc)
  }

  onTabNavigated(ctrl, tab) {
    if (!ctrl.isPrivate) this.history.add({ url: tab.url, title: tab.title })
  }

  onTabTitle(ctrl, tab) {
    if (!ctrl.isPrivate) this.history.updateTitle(tab.url, tab.title)
  }

  onAdBlocked(wcId) {
    for (const ctrl of this.windows.values()) {
      for (const tab of ctrl.tabs.tabs.values()) {
        if (tab.wc && tab.wc.id === wcId) {
          tab.blocked++
          ctrl.tabs.queueChange()
          return
        }
      }
    }
  }

  onLimiterSample(sample) {
    this.broadcast('limiter', { ...sample, adsBlocked: this.adblock.totalBlocked })
    for (const action of sample.actions) {
      if (action.type === 'ram-warning' && Notification.isSupported()) {
        new Notification({ title: 'RAM-Limit überschritten', body: `Pulse nutzt ${action.totalMb} MB (Limit ${action.limitMb} MB).` }).show()
      }
    }
  }

  // ---- passwords -------------------------------------------------------

  /** Called from the page preload after a login form was submitted. */
  onPasswordCaptured(wc, frame, { username, password }) {
    const origin = frame && frame.origin
    if (!origin || !/^https?:/.test(origin) || typeof password !== 'string' || !password) return
    this.withTab(wc, (ctrl) => {
      if (ctrl.isPrivate || this.passwords.isNeverSave(origin)) return
      if (!this.passwords.wouldChange({ origin, username, password })) return
      const token = crypto.randomUUID()
      this.pendingPasswords.set(token, { origin, username: String(username || ''), password, expires: Date.now() + PENDING_PASSWORD_TTL_MS })
      ctrl.send('password-prompt', { token, origin, username: String(username || '') })
    })
  }

  respondPassword(token, choice) {
    const pending = this.pendingPasswords.get(token)
    this.pendingPasswords.delete(token)
    if (!pending || pending.expires < Date.now()) return
    if (choice === 'save') this.passwords.save(pending)
    if (choice === 'never') this.passwords.neverSave(pending.origin)
  }

  // ---- misc -------------------------------------------------------------

  openExternal(url) {
    if (/^(https?|mailto):/.test(url)) shell.openExternal(url)
  }

  importedExtensionsDir() {
    return path.join(this.userData, 'UnpackedExtensions')
  }
}

/** Pages may only open ordinary web URLs; privileged schemes stay unreachable. */
function isWebUrl(url) {
  return /^https?:\/\//i.test(url) || url === 'about:blank'
}

module.exports = { Browser }
