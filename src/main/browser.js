'use strict'

const path = require('node:path')
const crypto = require('node:crypto')
const { app, session, BrowserWindow, shell, Notification, net, safeStorage } = require('electron')
const { JsonStore } = require('./store')
const { DEFAULT_SETTINGS, SEARCH_ENGINES } = require('./defaults')
const { searchTemplateFor } = require('./lib/settings-schema')
const { topSites } = require('./lib/top-sites')
const { setupTab, guardPopup, isWebUrl } = require('./tab-setup')
const { Notes } = require('./notes')
const { AddressBook } = require('./addresses')
const { FocusMode } = require('./focus')
const { Cleaner } = require('./cleaner')
const { shortcutTable } = require('./lib/shortcuts')
const { extractArticle, sanitizeArticle } = require('./lib/reader')
const { generatePassword, auditPasswords, checkLeaks } = require('./lib/password-tools')
const { LANGUAGES, textTranslateUrl, pageTranslateUrl, translateWithDeepl } = require('./lib/translate')
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
const SETTINGS_URL = 'pulse://settings/'
const READER_URL = 'pulse://newtab/reader.html'
const READER_WORLD_ID = 1001
const MAX_READER_ARTICLES = 20
const GENERATOR_TTL_MS = 2 * 60 * 1000
const AUTO_SLEEP_CHECK_MS = 60 * 1000

/** Application root: shared services and all windows. */
class Browser {
  constructor() {
    const dir = app.getPath('userData')
    this.userData = dir
    this.settings = new JsonStore(path.join(dir, 'settings.json'), DEFAULT_SETTINGS)
    migrateSettings(this.settings)
    this.sessionStore = new JsonStore(path.join(dir, 'session.json'), { windows: [] })
    this.bookmarks = new Bookmarks(path.join(dir, 'bookmarks.json'))
    this.history = new History(path.join(dir, 'history.json'))
    this.passwords = new PasswordVault(path.join(dir, 'passwords.json'))
    this.permissions = new Permissions(path.join(dir, 'permissions.json'))
    this.favicons = new FaviconService(dir, () => this.mainSession)
    this.notes = new Notes(path.join(dir, 'notes.json'))
    this.addresses = new AddressBook(path.join(dir, 'addresses.json'))
    this.cleaner = new Cleaner(this)
    this.httpsExceptions = new Set()
    this.focus = new FocusMode((state) => this.onFocusChange(state))
    this.readerArticles = new Map() // token -> article
    this.generatorOffers = new Map() // token -> { wc, origin, expires }
    this.recordingShortcuts = null // webContents of the settings page while it records a key
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
    this.downloads = new Downloads(path.join(this.userData, 'downloads.json'), (startedIn) => {
      for (const w of this.windows.values()) w.send('downloads', { list: this.downloadList(w.session), started: startedIn === w.session })
    }, () => this.settings.get())
    this.downloads.attach(this.mainSession)
    this.applyPrivacyHeaders(this.mainSession)
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

    this.updater = new Updater((state) => {
      this.broadcast('update', state)
      this.broadcastToSettingsPages('settings:update', state)
    })
    this.updater.start()
    this.sleepTimer = setInterval(() => this.autoSleepTabs(), AUTO_SLEEP_CHECK_MS)
  }

  /** Downloads visible to the windows of one session. */
  downloadList(ses) {
    return this.downloads.list(ses, this.mainSession)
  }

  /** "Do Not Track" + Global Privacy Control headers, switchable at runtime. */
  applyPrivacyHeaders(ses) {
    ses.webRequest.onBeforeSendHeaders((details, callback) => {
      if (!this.settings.get().doNotTrack) return callback({ requestHeaders: details.requestHeaders })
      callback({ requestHeaders: { ...details.requestHeaders, DNT: '1', 'Sec-GPC': '1' } })
    })
  }

  /** Puts background tabs to sleep after the configured idle time. */
  autoSleepTabs() {
    const minutes = this.settings.get().autoSleepMinutes
    if (!minutes) return
    const cutoff = Date.now() - minutes * 60 * 1000
    for (const ctrl of this.windows.values()) {
      for (const tab of ctrl.tabs.tabs.values()) {
        if (tab.pinned || tab.audible || tab.discarded || tab.lastActive > cutoff || ctrl.tabs.isVisible(tab.id)) continue
        ctrl.tabs.discard(tab.id)
      }
    }
  }

  applySettings() {
    const s = this.settings.get()
    for (const ses of this.allSessions()) this.adblock.setEnabled(ses, s.adblock)
    if (this.limiter) this.limiter.applyNetworkLimit()
    this.broadcast('settings', this.publicSettings())
    this.broadcastToInternalPages('page:settings', this.newtabData())
    this.broadcastToSettingsPages('settings:changed', this.publicSettings())
  }

  /** Settings the start page needs (theme, wallpaper, effects, speed dial, suggestions). */
  newtabData() {
    const s = this.settings.get()
    return {
      speedDial: s.speedDial, accent: s.accent, wallpaper: s.wallpaper, searchEngine: s.searchEngine,
      bgEffect: s.bgEffect, animations: s.animations, clock: s.newtabClock,
      suggestions: s.newtabSuggestions ? this.suggestions() : [],
    }
  }

  /** Frequently and recently visited sites that aren't in the speed dial yet. */
  suggestions() {
    const s = this.settings.get()
    return topSites(this.history.search('', 5000), { exclude: s.speedDial.map((d) => d.url), hidden: s.hiddenSuggestions, limit: 8 })
  }

  broadcastToInternalPages(channel, payload, prefix = 'pulse://') {
    for (const ctrl of this.windows.values()) {
      for (const tab of ctrl.tabs.tabs.values()) {
        if (tab.wc && !tab.wc.isDestroyed() && tab.wc.getURL().startsWith(prefix)) tab.wc.send(channel, payload)
      }
    }
  }

  broadcastToSettingsPages(channel, payload) {
    this.broadcastToInternalPages(channel, payload, SETTINGS_URL)
  }

  publicSettings() {
    const { deeplKeyEnc, ...settings } = this.settings.get()
    return {
      ...settings,
      hasDeeplKey: Boolean(deeplKeyEnc),
      languages: LANGUAGES,
      shortcutTable: shortcutTable(settings.shortcuts),
      searchEngines: Object.entries(SEARCH_ENGINES).map(([id, e]) => ({ id, name: e.name })),
      focus: this.focus.state,
    }
  }

  // ---- reader view ---------------------------------------------------------

  /** Opens the active tab's article in the reader view, or leaves it again. */
  async toggleReader(ctrl) {
    const tab = ctrl.tabs.active
    if (!tab || !tab.wc) return
    if (tab.url.startsWith(READER_URL)) {
      const nav = tab.wc.navigationHistory
      if (nav.canGoBack()) nav.goBack()
      return
    }
    if (!/^https?:/.test(tab.url)) return ctrl.send('toast', 'Die Leseansicht gibt es nur für Webseiten')
    let raw = null
    try {
      raw = await tab.wc.executeJavaScriptInIsolatedWorld(READER_WORLD_ID, [{ code: `(${extractArticle.toString()})()` }])
    } catch {
      raw = null
    }
    const article = sanitizeArticle(raw, tab.url)
    if (!article) return ctrl.send('toast', 'Auf dieser Seite wurde kein Artikel gefunden')
    const token = crypto.randomUUID()
    this.readerArticles.set(token, article)
    while (this.readerArticles.size > MAX_READER_ARTICLES) this.readerArticles.delete(this.readerArticles.keys().next().value)
    ctrl.navigate(`${READER_URL}#${token}`, tab.id)
  }

  readerArticle(token) {
    return this.readerArticles.get(String(token)) || null
  }

  // ---- picture in picture ---------------------------------------------------

  /** Pops the main video of the active tab out (or back in). */
  async togglePip(ctrl) {
    const tab = ctrl.tabs.active
    if (!tab || !tab.wc || !/^https?:/.test(tab.url)) return
    const code = `(() => {
      if (document.pictureInPictureElement) return document.exitPictureInPicture().then(() => 'exit', () => 'error')
      const videos = [...document.querySelectorAll('video')].filter((v) => v.readyState > 0)
        .sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight))
      const video = videos.find((v) => !v.paused) || videos[0]
      if (!video) return 'none'
      video.disablePictureInPicture = false
      return video.requestPictureInPicture().then(() => 'ok', () => 'error')
    })()`
    let result = 'error'
    try {
      // Isolated world: page scripts can't hook in while the user gesture is active.
      result = await tab.wc.executeJavaScriptInIsolatedWorld(READER_WORLD_ID + 1, [{ code }], true)
    } catch {
      result = 'error'
    }
    if (result === 'none') ctrl.send('toast', 'Auf dieser Seite läuft kein Video')
    if (result === 'error') ctrl.send('toast', 'Bild-in-Bild ist hier nicht möglich')
  }

  // ---- translation ---------------------------------------------------------

  setDeeplKey(key) {
    const clean = String(key || '').trim()
    if (clean && !/^[0-9a-f-]{20,60}(:fx)?$/i.test(clean)) throw new Error('Das sieht nicht nach einem DeepL-Schlüssel aus')
    if (clean && !safeStorage.isEncryptionAvailable()) throw new Error('Verschlüsselung des Betriebssystems ist nicht verfügbar')
    const enc = clean ? safeStorage.encryptString(clean).toString('base64') : ''
    this.settings.update((s) => ({ ...s, deeplKeyEnc: enc }))
  }

  deeplKey() {
    const enc = this.settings.get().deeplKeyEnc
    if (!enc) return ''
    try {
      return safeStorage.decryptString(Buffer.from(enc, 'base64'))
    } catch {
      return ''
    }
  }

  /** Selected text: shown translated in Pulse with DeepL, else opened in Google Translate. */
  async translateText(ctrl, text) {
    const target = this.settings.get().translateTarget
    const key = this.deeplKey()
    if (!key) return ctrl.newTab(textTranslateUrl(text, target))
    ctrl.send('translation', { pending: true, source: text.slice(0, 300) })
    try {
      const result = await translateWithDeepl(text, target, key, (url, init) => net.fetch(url, init))
      ctrl.send('translation', { source: text.slice(0, 300), text: result.text, from: result.detected, to: target })
    } catch (err) {
      ctrl.send('translation', { source: text.slice(0, 300), error: err.message })
    }
  }

  translatePage(ctrl, tabId = ctrl.tabs.activeId) {
    const tab = ctrl.tabs.tabs.get(tabId)
    if (!tab || !/^https?:/.test(tab.url)) return ctrl.send('toast', 'Nur Webseiten können übersetzt werden')
    if (/^https:\/\/[^/]*translate\.(google\.com|goog)\//.test(tab.url)) return ctrl.send('toast', 'Diese Seite ist bereits übersetzt')
    ctrl.navigate(pageTranslateUrl(tab.url, this.settings.get().translateTarget), tab.id)
  }

  // ---- password generator & check -----------------------------------------

  /**
   * While the settings page records a key combo, shortcuts are off for that
   * page only. Cleared on finish, reload/navigation, close, or after 30 s.
   */
  setShortcutRecording(wc, on) {
    clearTimeout(this.recordingTimer)
    if (this.recordingShortcuts && this.recordingCleanup) this.recordingCleanup()
    this.recordingShortcuts = null
    this.recordingCleanup = null
    if (!on) return
    const stop = () => this.setShortcutRecording(wc, false)
    wc.once('did-start-navigation', stop)
    wc.once('destroyed', stop)
    this.recordingShortcuts = wc
    this.recordingCleanup = () => {
      wc.removeListener('did-start-navigation', stop)
      wc.removeListener('destroyed', stop)
    }
    this.recordingTimer = setTimeout(stop, 30 * 1000)
  }

  /** A sign-up field got focus: offer a strong password in the info bar. */
  onPasswordFieldNeedsPassword(wc, frame) {
    const origin = frame && frame.origin
    if (!origin || !/^https?:/.test(origin) || frame !== wc.mainFrame || !this.settings.get().suggestPasswords) return
    this.withTab(wc, (ctrl) => {
      // Only offer when Pulse can save it afterwards – a password nobody knows is worse than none.
      if (!this.canSavePassword(ctrl, origin)) return
      const token = crypto.randomUUID()
      for (const [t, o] of this.generatorOffers) if (o.wc === wc || o.expires < Date.now()) this.generatorOffers.delete(t)
      this.generatorOffers.set(token, { wc, origin, expires: Date.now() + GENERATOR_TTL_MS })
      ctrl.send('password-generate-offer', { token, origin })
    })
  }

  /** Fills a fresh password into the page that asked (only if it's still on that site). */
  useGeneratedPassword(token) {
    const offer = this.generatorOffers.get(token)
    this.generatorOffers.delete(token)
    if (!offer || offer.expires < Date.now() || offer.wc.isDestroyed()) return false
    return this.fillGeneratedPassword(offer.wc, offer.origin)
  }

  fillGeneratedPassword(wc, origin) {
    if (wc.mainFrame.origin !== origin) return false
    const password = generatePassword({ length: 18 })
    wc.mainFrame.send('pw:fill-generated', password)
    // If Pulse won't save it (private window, saving off, "never" for this
    // site), show it so the user can note it down.
    this.withTab(wc, (ctrl) => {
      if (!this.canSavePassword(ctrl, origin)) ctrl.send('generated-password', { origin, password })
    })
    return true
  }

  canSavePassword(ctrl, origin) {
    return !ctrl.isPrivate && this.settings.get().savePasswords && !this.passwords.isNeverSave(origin)
  }

  /** Weak and reused passwords (no passwords in the result). */
  passwordAudit() {
    return auditPasswords(this.decryptedPasswords())
  }

  /** Have I Been Pwned check (k-anonymity: only hash prefixes are sent). */
  async passwordLeakCheck() {
    const leaked = await checkLeaks(this.decryptedPasswords(), (url, init) => net.fetch(url, init))
    return Object.fromEntries(leaked)
  }

  decryptedPasswords() {
    return this.passwords.list().map((p) => ({ ...p, password: this.passwords.reveal(p.id) || '' })).filter((p) => p.password)
  }

  searchTemplate() {
    return searchTemplateFor(this.settings.get())
  }

  // ---- focus mode --------------------------------------------------------

  startFocus(minutes) {
    const s = this.settings.get()
    this.focus.start(Number(minutes) || s.focusMinutes, s.focusBlocklist)
    // Tabs already showing a blocked site get the block page right away.
    for (const ctrl of this.windows.values()) {
      for (const tab of ctrl.tabs.tabs.values()) {
        if (tab.wc && !tab.wc.isDestroyed() && this.focus.isBlocked(tab.wc.getURL())) tab.wc.reload()
      }
    }
  }

  onFocusChange(state) {
    this.broadcast('focus', state)
    this.broadcastToInternalPages('page:focus', state)
    if (!state.active && state.finished && Notification.isSupported()) {
      new Notification({ title: 'Fokus-Zeit vorbei', body: 'Gut gemacht! Alle Seiten sind wieder erreichbar.' }).show()
    }
  }

  // ---- settings page -----------------------------------------------------

  /** Opens (or reuses) the settings tab of a window, optionally at a section. */
  openSettings(ctrl, section = '') {
    const target = `${SETTINGS_URL}${section ? `#${section}` : ''}`
    const existing = [...ctrl.tabs.tabs.values()].find((t) => t.url.startsWith(SETTINGS_URL))
    if (existing) {
      ctrl.tabs.activate(existing.id)
      if (section && existing.wc) existing.wc.send('settings:section', section)
      return existing
    }
    return ctrl.newTab(target)
  }

  /** In an unpackaged run Electron needs the app path, or it registers the bare electron binary. */
  protocolClientArgs() {
    return app.isPackaged ? [] : [process.execPath, [path.resolve(process.argv[1] || '.')]]
  }

  async defaultBrowserState() {
    const args = this.protocolClientArgs()
    return { isDefault: app.isDefaultProtocolClient('https', ...args) && app.isDefaultProtocolClient('http', ...args), platform: process.platform }
  }

  async makeDefaultBrowser() {
    const args = this.protocolClientArgs()
    app.setAsDefaultProtocolClient('http', ...args)
    app.setAsDefaultProtocolClient('https', ...args)
    // Since Windows 10 the user has to confirm the choice in the system settings.
    if (process.platform === 'win32') await shell.openExternal('ms-settings:defaultapps')
    return this.defaultBrowserState()
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
      this.downloads.attach(ses, { persistent: false })
      this.applyPrivacyHeaders(ses)
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
        if (isPrivate) {
          this.adblock.forget(ses)
          ses.clearStorageData().catch(() => {})
        }
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
    const s = this.settings.get()
    if (s.startup === 'pages' && s.startupPages.length) {
      const ctrl = this.createWindow({ url: s.startupPages[0] })
      for (const url of s.startupPages.slice(1)) ctrl.newTab(url, { active: false, index: ctrl.tabs.order.length })
      return ctrl
    }
    const saved = s.startup === 'restore' ? this.sessionStore.get().windows : []
    if (!saved.length) return this.createWindow()
    for (const w of saved) this.createWindow({ restore: w, bounds: w.bounds })
  }

  /** Where the home button and Alt+Home go. */
  homeUrl() {
    return this.settings.get().homepage || NEW_TAB_URL
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
    this.flushStores()
    if (this.limiter) this.limiter.stop()
    clearInterval(this.sleepTimer)
  }

  flushStores() {
    for (const store of [this.settings, this.bookmarks.store, this.history.store, this.passwords.store, this.permissions.store,
      this.favicons.store, this.notes.store, this.addresses.store, this.downloads.store]) store.flush()
  }

  /** True if "clear on exit" has anything to do. */
  needsExitCleanup() {
    return Object.values(this.settings.get().clearOnExit || {}).some(Boolean)
  }

  /** Runs the "clear on exit" choices; called once while quitting. */
  async exitCleanup() {
    const what = this.settings.get().clearOnExit
    try {
      await this.cleaner.clean(this.mainSession, { cache: what.cache, cookies: what.cookies, history: what.history, downloadList: what.downloads })
    } catch (err) {
      console.error('[pulse] Aufräumen beim Beenden fehlgeschlagen:', err)
    }
    this.flushStores()
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
    setupTab(this, ctrl, wc, tab)
  }

  setupPanel(ctrl, wc) {
    guardPopup(wc)
    wc.setWindowOpenHandler(({ url }) => {
      if (isWebUrl(url)) ctrl.newTab(url)
      return { action: 'deny' }
    })
    wc.on('context-menu', (_e, params) => this.showContextMenu(ctrl, wc, params))
  }

  showContextMenu(ctrl, wc, params) {
    const isTab = Boolean(ctrl.tabs.byWebContents(wc))
    const menu = buildContextMenu({
      wc,
      params,
      openTab: (url, opts) => ctrl.newTab(url, opts),
      openPrivate: (url) => this.createWindow({ isPrivate: true, url }),
      searchUrl: (q) => this.searchTemplate().replace('%s', encodeURIComponent(q)),
      translateText: (text) => this.translateText(ctrl, text),
      translatePage: isTab ? () => this.translatePage(ctrl, ctrl.tabs.byWebContents(wc).id) : null,
      togglePip: isTab ? () => { const t = ctrl.tabs.byWebContents(wc); if (t) { ctrl.tabs.activate(t.id); this.togglePip(ctrl) } } : null,
      generatePassword: () => this.fillGeneratedPassword(wc, wc.mainFrame.origin),
      extensionItems: ctrl.isPrivate ? [] : this.extensions.api.getContextMenuItems(wc, params),
    })
    menu.popup({ window: ctrl.win })
  }

  handleShortcut(ctrl, event, input, { fromPage = false, wc = null } = {}) {
    // While the settings page records a new key combo, keys go to the page.
    if (wc && wc === this.recordingShortcuts) return
    const action = matchShortcut(input, this.settings.get().shortcuts)
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
      if (ctrl.isPrivate || !this.settings.get().savePasswords || this.passwords.isNeverSave(origin)) return
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

/** Carries old settings files (1.1) over to the 1.2 keys. */
function migrateSettings(store) {
  const s = store.get()
  if (!Object.hasOwn(s, 'restoreSession')) return
  const { restoreSession, ...rest } = s
  store.update(() => ({ ...rest, startup: restoreSession === false ? 'newtab' : rest.startup }))
}

module.exports = { Browser, SETTINGS_URL }
