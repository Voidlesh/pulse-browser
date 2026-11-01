'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { app, ipcMain, Menu, dialog, clipboard, nativeImage } = require('electron')
const importer = require('./importer')
const { NEW_TAB_URL } = require('./lib/urls')
const { validatePatch } = require('./lib/settings-schema')
const { noteKey } = require('./notes')
const { generatePassword } = require('./lib/password-tools')

const SETTINGS_PAGE = 'pulse://settings/'
const VOLUME_STEPS = [100, 75, 50, 25, 10, 0]
const PNG_DATA_URL = /^data:image\/png;base64,[a-z0-9+/=]+$/i
const PALETTE_LIMIT = 8

/**
 * Registers every IPC channel. UI channels (ui:*) only accept calls from a
 * browser window's own chrome UI; page channels verify the sender frame.
 * @param {import('./browser').Browser} browser
 */
function registerIpc(browser) {
  const ui = (channel, fn) => ipcMain.handle(`ui:${channel}`, (event, ...args) => {
    const ctrl = browser.windowForUi(event.sender)
    if (!ctrl) throw new Error('Unbekannter Absender')
    return fn(ctrl, ...args)
  })

  // ---- window / tabs ----------------------------------------------------
  ui('init', (ctrl) => ({
    isPrivate: ctrl.isPrivate,
    settings: browser.publicSettings(),
    tabs: ctrl.tabs.snapshot(),
    downloads: browser.downloadList(ctrl.session),
  }))
  ui('layout', (ctrl, layout) => ctrl.setLayout(layout))
  ui('tab-new', (ctrl, url) => { ctrl.newTab(url ? browser.resolveInput(url) : NEW_TAB_URL) })
  ui('tab-close', (ctrl, id) => ctrl.closeTab(id))
  ui('tab-activate', (ctrl, id) => ctrl.tabs.activate(id))
  ui('tab-move', (ctrl, id, index) => ctrl.tabs.move(id, Number(index)))
  ui('tab-mute', (ctrl, id) => ctrl.tabs.toggleMute(id))
  ui('tab-volume', (ctrl, id, volume) => ctrl.tabs.setVolume(id, volume))
  ui('split-close', (ctrl) => ctrl.tabs.unsplit())
  ui('split-swap', (ctrl) => ctrl.tabs.swapSplit())
  ui('settings-open', (ctrl, section) => { browser.openSettings(ctrl, typeof section === 'string' ? section.replace(/[^a-z-]/g, '') : '') })
  ui('tab-menu', (ctrl, id) => showTabMenu(browser, ctrl, id))
  ui('navigate', (ctrl, text) => ctrl.navigate(browser.resolveInput(text)))
  ui('action', (ctrl, name) => ctrl.runAction(String(name)))
  ui('find', (ctrl, text, opts) => ctrl.find(String(text || ''), opts || {}))
  ui('find-stop', (ctrl) => ctrl.stopFind())
  ui('main-menu', (ctrl) => showMainMenu(browser, ctrl))
  ui('web-panel', (ctrl, appId) => ctrl.showWebPanel(browser.settings.get().sidebarApps.find((a) => a.id === appId) || null))
  ui('web-panel-action', (ctrl, appId, action) => ctrl.webPanelAction(appId, action))
  ui('overlay-begin', (ctrl) => ctrl.beginOverlay())
  ui('overlay-end', (ctrl) => ctrl.endOverlay())
  ui('favicons', (ctrl, urls) => {
    const list = Array.isArray(urls) ? urls.map(String) : []
    // Private windows must not fetch through the normal profile or persist visited sites.
    return ctrl.isPrivate ? browser.favicons.cachedMany(list) : browser.favicons.resolveMany(list)
  })
  ui('palette', (ctrl, query) => paletteResults(browser, String(query || ''), ctrl))
  ui('snapshot-copy', (_ctrl, dataUrl) => {
    if (!PNG_DATA_URL.test(dataUrl)) throw new Error('Ungültiges Bild')
    clipboard.writeImage(nativeImage.createFromDataURL(dataUrl))
  })
  ui('snapshot-save', async (ctrl, dataUrl) => {
    if (!PNG_DATA_URL.test(dataUrl)) throw new Error('Ungültiges Bild')
    const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')
    const { canceled, filePath } = await dialog.showSaveDialog(ctrl.win, {
      title: 'Snapshot speichern',
      defaultPath: path.join(app.getPath('pictures'), `Pulse-Snapshot-${stamp}.png`),
      filters: [{ name: 'PNG', extensions: ['png'] }],
    })
    if (canceled || !filePath) return false
    fs.writeFileSync(filePath, Buffer.from(dataUrl.split(',')[1], 'base64'))
    return true
  })
  ui('limiter-tab', (_ctrl, windowId, tabId, action) => {
    const target = [...browser.windows.values()].find((w) => w.id === windowId)
    if (!target) return
    if (action === 'close') target.closeTab(tabId)
    if (action === 'discard') target.tabs.discard(tabId)
    if (action === 'activate') { target.tabs.activate(tabId); target.win.focus() }
  })

  // ---- updates ----------------------------------------------------------
  ui('update-state', () => browser.updater.state)
  ui('update-check', () => browser.updater.check())
  ui('update-install', () => browser.updater.installNow())

  // ---- settings ---------------------------------------------------------
  ui('settings-set', (_ctrl, patch) => applySettingsPatch(browser, patch))
  ui('sidebar-add', (_ctrl, { title, url }) => {
    const parsed = new URL(url)
    if (!/^https?:$/.test(parsed.protocol)) throw new Error('Nur http(s)-Adressen')
    const entry = { id: `app-${Date.now()}`, title: String(title || parsed.hostname).slice(0, 40), url: parsed.href }
    browser.settings.update((s) => ({ ...s, sidebarApps: [...s.sidebarApps, entry] }))
  })
  ui('sidebar-remove', (ctrl, id) => {
    ctrl.webPanelAction(id, 'unload')
    browser.settings.update((s) => ({ ...s, sidebarApps: s.sidebarApps.filter((a) => a.id !== id) }))
  })
  ui('clear-data', (ctrl, kinds) => browser.cleaner.clean(ctrl.session, cleanSelection(kinds, ctrl.isPrivate)))
  ui('cleaner-scan', (ctrl) => browser.cleaner.scan(ctrl.session))
  ui('cleaner-clean', async (ctrl, what) => {
    const result = await browser.cleaner.clean(ctrl.session, cleanSelection(what, ctrl.isPrivate))
    browser.downloads.emit()
    return result
  })

  // ---- focus mode & notes -------------------------------------------------
  ui('focus-start', (_ctrl, minutes) => browser.startFocus(Math.min(240, Math.max(5, Number(minutes) || 25))))
  ui('focus-stop', () => browser.focus.stop())
  ui('focus-state', () => browser.focus.state)
  ui('note-get', (ctrl) => {
    const tab = ctrl.tabs.active
    if (!tab || !noteKey(tab.url)) return { available: false }
    return { available: !ctrl.isPrivate, url: tab.url, title: tab.title, note: ctrl.isPrivate ? null : browser.notes.get(tab.url) }
  })
  ui('note-set', (ctrl, url, title, text) => {
    if (ctrl.isPrivate) throw new Error('In privaten Fenstern werden keine Notizen gespeichert')
    browser.notes.set(String(url), String(title || ''), String(text || ''))
    browser.broadcast('notes', null)
  })
  ui('notes-list', (ctrl) => (ctrl.isPrivate ? [] : browser.notes.list()))
  ui('notes-keys', (ctrl) => (ctrl.isPrivate ? [] : browser.notes.list().map((n) => n.url)))

  // ---- bookmarks / history / downloads -----------------------------------
  ui('bookmarks-list', () => browser.bookmarks.list())
  ui('bookmark-toggle', (ctrl) => {
    const tab = ctrl.tabs.active
    if (!tab || !/^(https?|file):/.test(tab.url)) return null
    const added = browser.bookmarks.toggle({ title: tab.title, url: tab.url })
    browser.broadcast('bookmarks', browser.bookmarks.list())
    return added
  })
  ui('bookmark-update', (_ctrl, id, patch) => { browser.bookmarks.update(id, patch); browser.broadcast('bookmarks', browser.bookmarks.list()) })
  ui('bookmark-remove', (_ctrl, id) => { browser.bookmarks.remove(id); browser.broadcast('bookmarks', browser.bookmarks.list()) })
  ui('is-bookmarked', (_ctrl, url) => Boolean(browser.bookmarks.find(url)))
  ui('history-search', (_ctrl, q) => browser.history.search(String(q || '')))
  ui('history-remove', (_ctrl, url, time) => browser.history.remove(url, time))
  ui('history-clear', () => browser.history.clear())
  ui('downloads-action', (ctrl, id, action) => {
    if (browser.downloadList(ctrl.session).some((d) => d.id === id)) browser.downloads.action(id, action)
  })
  ui('downloads-clear', () => browser.downloads.clearFinished())
  ui('open', (ctrl, url, { newTab = true } = {}) => (newTab ? ctrl.newTab(url) : ctrl.navigate(url)))

  // ---- passwords --------------------------------------------------------
  ui('pw-respond', (_ctrl, token, choice) => browser.respondPassword(token, choice))
  ui('pw-generate-use', (_ctrl, token) => browser.useGeneratedPassword(String(token)))

  // ---- extensions / import ----------------------------------------------
  ui('ext-list', () => browser.extensions.list())
  ui('ext-remove', (_ctrl, id) => browser.extensions.remove(id))
  ui('ext-load-unpacked', async (ctrl) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(ctrl.win, { title: 'Entpackte Erweiterung laden', properties: ['openDirectory'] })
    if (canceled || !filePaths[0]) return null
    const ext = await browser.extensions.loadPath(filePaths[0])
    return ext ? ext.name : null
  })

  // ---- page channels ----------------------------------------------------
  ipcMain.on('pw:captured', (event, data) => {
    if (data && typeof data === 'object') browser.onPasswordCaptured(event.sender, event.senderFrame, data)
  })
  ipcMain.handle('pw:query', (event) => {
    const origin = event.senderFrame && event.senderFrame.origin
    if (!origin || !/^https?:/.test(origin) || !browser.settings.get().autofillPasswords) return []
    return browser.passwords.forOrigin(origin).map(({ username, password }) => ({ username, password }))
  })
  ipcMain.on('pw:needs-password', (event) => browser.onPasswordFieldNeedsPassword(event.sender, event.senderFrame))
  ipcMain.handle('af:query', (event) => {
    const origin = event.senderFrame && event.senderFrame.origin
    if (!origin || !/^https?:/.test(origin) || !browser.settings.get().autofillAddresses) return null
    const [profile] = browser.addresses.list()
    if (!profile) return null
    const { id: _id, ...fields } = profile
    return fields
  })

  const internal = (channel, fn) => ipcMain.handle(channel, (event, ...args) => {
    if (!event.senderFrame || !event.senderFrame.url.startsWith('pulse://')) throw new Error('Nur für interne Seiten')
    return fn(event, ...args)
  })
  internal('page:newtab', () => browser.newtabData())
  internal('page:focus-state', () => browser.focus.state)
  internal('page:reader', (_e, token) => browser.readerArticle(token))
  internal('page:reader-original', (event, url) => {
    const parsed = new URL(String(url))
    if (!/^https?:$/.test(parsed.protocol)) return
    browser.withTab(event.sender, (ctrl, tab) => ctrl.navigate(parsed.href, tab.id))
  })
  internal('page:suggestion-hide', (_e, url) => {
    const { origin } = new URL(String(url))
    browser.settings.update((s) => ({ ...s, hiddenSuggestions: [...new Set([...s.hiddenSuggestions, `${origin}/`])].slice(-200) }))
  })
  internal('page:favicons', (_e, urls) => browser.favicons.resolveMany(Array.isArray(urls) ? urls.map(String) : []))
  internal('page:speeddial-set', (_e, list) => {
    const clean = (Array.isArray(list) ? list : []).slice(0, 48).map((d) => ({ title: String(d.title || '').slice(0, 60), url: new URL(d.url).href }))
    browser.settings.update((s) => ({ ...s, speedDial: clean }))
  })
  internal('page:search', (event, text) => browser.withTab(event.sender, (ctrl, tab) => ctrl.navigate(browser.resolveInput(text), tab.id)))

  registerSettingsPage(browser)
}

/**
 * Channels of the settings page (pulse://settings). Only that page's own main
 * frame may call them – it can reveal passwords and addresses.
 */
function registerSettingsPage(browser) {
  const page = (channel, fn) => ipcMain.handle(`settings:${channel}`, (event, ...args) => {
    const frame = event.senderFrame
    if (!frame || frame !== event.sender.mainFrame || !frame.url.startsWith(SETTINGS_PAGE)) throw new Error('Nur für die Einstellungsseite')
    const ctrl = browser.withTab(event.sender, (c) => c)
    if (!ctrl) throw new Error('Unbekannter Tab')
    return fn(ctrl, ...args)
  })

  page('get', (ctrl) => ({ settings: browser.publicSettings(), isPrivate: ctrl.isPrivate, version: app.getVersion(), update: browser.updater.state, platform: process.platform }))
  page('set', (_ctrl, patch) => { applySettingsPatch(browser, patch) })
  page('reset', () => {
    const { DEFAULT_SETTINGS } = require('./defaults')
    browser.settings.update((s) => ({ ...structuredClone(DEFAULT_SETTINGS), speedDial: s.speedDial, sidebarApps: s.sidebarApps }))
  })

  // Passwords
  page('pw-list', () => browser.passwords.list())
  page('pw-reveal', (_ctrl, id) => browser.passwords.reveal(id))
  page('pw-copy', (_ctrl, id) => { const pw = browser.passwords.reveal(id); if (pw) clipboard.writeText(pw) })
  page('pw-delete', (_ctrl, id) => browser.passwords.remove(id))
  page('pw-add', (_ctrl, { url, username, password }) => {
    const parsed = new URL(String(url))
    if (!/^https?:$/.test(parsed.protocol) || !password) throw new Error('Ungültige Eingabe')
    browser.passwords.save({ origin: parsed.origin, username: String(username || ''), password: String(password) })
  })
  page('pw-generate', (_ctrl, opts) => generatePassword({ length: Number(opts && opts.length) || 18, symbols: !(opts && opts.symbols === false) }))
  page('pw-copy-text', (_ctrl, text) => { clipboard.writeText(String(text).slice(0, 200)) })
  page('pw-audit', () => browser.passwordAudit())
  page('pw-leak-check', () => browser.passwordLeakCheck())
  page('pw-change', (_ctrl, id, password) => {
    const entry = browser.passwords.list().find((p) => p.id === id)
    if (!entry || !password) throw new Error('Ungültige Eingabe')
    browser.passwords.save({ origin: entry.origin, username: entry.username, password: String(password) })
  })
  page('deepl-key-set', (_ctrl, key) => browser.setDeeplKey(key))
  page('shortcuts-recording', (ctrl, on) => {
    const tab = ctrl.tabs.active
    browser.recordingShortcuts = on && tab ? tab.wc : null
  })
  page('pw-import-csv', async (ctrl) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(ctrl.win, { title: 'Passwort-CSV importieren', filters: [{ name: 'CSV', extensions: ['csv'] }], properties: ['openFile'] })
    if (canceled || !filePaths[0]) return null
    return browser.passwords.importCsv(fs.readFileSync(filePaths[0], 'utf8'))
  })
  page('pw-export-csv', async (ctrl) => {
    const { canceled, filePath } = await dialog.showSaveDialog(ctrl.win, { title: 'Passwörter exportieren', defaultPath: 'pulse-passwoerter.csv', filters: [{ name: 'CSV', extensions: ['csv'] }] })
    if (canceled || !filePath) return false
    fs.writeFileSync(filePath, browser.passwords.exportCsv(), { mode: 0o600 })
    return true
  })

  // Addresses (autofill)
  page('addr-list', () => browser.addresses.list())
  page('addr-save', (_ctrl, profile) => browser.addresses.save(profile && typeof profile === 'object' ? profile : {}))
  page('addr-remove', (_ctrl, id) => browser.addresses.remove(String(id)))

  // Privacy
  page('perm-list', () => browser.permissions.list())
  page('perm-reset', (_ctrl, origin, permission) => browser.permissions.reset(origin, permission))
  page('open-panel', (ctrl, name) => { if (['control', 'focus'].includes(name)) ctrl.send('action', `panel:${name}`) })
  page('https-exceptions-clear', () => browser.httpsExceptions.clear())

  // Downloads
  page('choose-download-dir', async (ctrl) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(ctrl.win, { title: 'Download-Ordner wählen', properties: ['openDirectory', 'createDirectory'] })
    if (canceled || !filePaths[0]) return null
    browser.settings.update((s) => ({ ...s, downloadDir: filePaths[0] }))
    return filePaths[0]
  })
  page('download-dir-default', () => app.getPath('downloads'))

  // System
  page('default-browser', () => browser.defaultBrowserState())
  page('default-browser-set', () => browser.makeDefaultBrowser())
  page('update-check', () => browser.updater.check())
  page('update-install', () => browser.updater.installNow())
  page('relaunch', () => { app.relaunch(); app.quit() })

  // Sidebar apps
  page('sidebar-add', (_ctrl, { title, url }) => {
    const parsed = new URL(String(url))
    if (!/^https?:$/.test(parsed.protocol)) throw new Error('Nur http(s)-Adressen')
    const entry = { id: `app-${Date.now()}`, title: String(title || parsed.hostname).slice(0, 40), url: parsed.href }
    browser.settings.update((s) => ({ ...s, sidebarApps: [...s.sidebarApps, entry] }))
  })
  page('sidebar-remove', (_ctrl, id) => {
    for (const w of browser.windows.values()) w.webPanelAction(id, 'unload')
    browser.settings.update((s) => ({ ...s, sidebarApps: s.sidebarApps.filter((a) => a.id !== id) }))
  })

  // Import
  page('import-sources', () => importer.candidateProfiles().map(({ name }) => ({ name })))
  page('import-run', (_ctrl, name, what) => runImport(browser, String(name), what && typeof what === 'object' ? what : {}))

  // Notes overview
  page('notes-list', (ctrl) => (ctrl.isPrivate ? [] : browser.notes.list()))
  page('note-delete', (_ctrl, url) => { browser.notes.set(String(url), '', ''); browser.broadcast('notes', null) })

  page('open', (ctrl, url) => {
    const parsed = new URL(String(url))
    if (/^https?:$/.test(parsed.protocol)) ctrl.newTab(parsed.href)
  })
  page('easy-setup', (ctrl) => ctrl.runAction('easy-setup'))
}

function applySettingsPatch(browser, patch) {
  browser.settings.update((s) => ({ ...s, ...validatePatch(patch, s) }))
}

/** Normalises a cleaner selection; history is never touched from private windows. */
function cleanSelection(what, isPrivate) {
  const pick = Array.isArray(what) ? Object.fromEntries(what.map((k) => [k, true])) : what || {}
  return {
    cache: Boolean(pick.cache), cookies: Boolean(pick.cookies),
    history: !isPrivate && Boolean(pick.history),
    downloadList: !isPrivate && Boolean(pick.downloadList), downloadFiles: !isPrivate && Boolean(pick.downloadFiles),
  }
}

/** Command palette: open tabs of all windows, bookmarks and history. */
function paletteResults(browser, query, caller) {
  const q = query.trim().toLowerCase()
  const match = (...fields) => !q || fields.some((f) => String(f || '').toLowerCase().includes(q))
  const tabs = []
  for (const ctrl of browser.windows.values()) {
    if (ctrl.isPrivate && ctrl !== caller) continue
    for (const id of ctrl.tabs.order) {
      const t = ctrl.tabs.tabs.get(id)
      if (match(t.title, t.url)) tabs.push({ windowId: ctrl.id, id: t.id, title: t.title, url: t.url, favicon: t.favicon, active: ctrl.tabs.activeId === id })
    }
  }
  const tabUrls = new Set(tabs.map((t) => t.url))
  const bookmarks = browser.bookmarks.list().filter((b) => match(b.title, b.url) && !tabUrls.has(b.url)).slice(0, PALETTE_LIMIT)
  const seen = new Set([...tabUrls, ...bookmarks.map((b) => b.url)])
  const history = q
    ? browser.history.search(q, 50).filter((h) => !seen.has(h.url) && seen.add(h.url)).slice(0, PALETTE_LIMIT)
    : []
  return { tabs: tabs.slice(0, 30), bookmarks, history }
}

async function runImport(browser, name, what) {
  const source = importer.candidateProfiles().find((p) => p.name === name)
  if (!source) throw new Error(`${name} wurde nicht gefunden`)
  const result = {}
  if (what.bookmarks) {
    result.bookmarks = browser.bookmarks.importMany(importer.readBookmarks(source.profile).map((b) => ({ ...b, folder: `${name}/${b.folder}` })))
    browser.broadcast('bookmarks', browser.bookmarks.list())
  }
  if (what.history) {
    try {
      result.history = browser.history.importMany(importer.readHistory(source.profile))
    } catch (err) {
      result.historyError = `Verlauf nicht lesbar (${err.message}). Schließe ${name} und versuche es erneut.`
    }
  }
  if (what.extensions) {
    const loadedIds = new Set(browser.extensions.list().map((e) => e.id))
    const dirs = importer.copyExtensions(source.profile, browser.importedExtensionsDir(), loadedIds)
    const loaded = []
    for (const dir of dirs) {
      const ext = await browser.extensions.loadPath(dir)
      if (ext) loaded.push(ext.name)
      else fs.rmSync(dir, { recursive: true, force: true })
    }
    result.extensions = loaded
  }
  return result
}

function showTabMenu(browser, ctrl, id) {
  const tab = ctrl.tabs.tabs.get(id)
  if (!tab) return
  Menu.buildFromTemplate([
    { label: 'Neuer Tab rechts', click: () => ctrl.newTab(NEW_TAB_URL, { index: ctrl.tabs.order.indexOf(id) + 1 }) },
    { label: 'Neu laden', enabled: Boolean(tab.wc), click: () => tab.wc.reload() },
    { label: 'Duplizieren', click: () => ctrl.newTab(tab.url, { history: ctrl.tabs.historyOf(tab) }) },
    { label: tab.pinned ? 'Loslösen' : 'Anheften', click: () => ctrl.tabs.togglePin(id) },
    { label: tab.muted ? 'Ton an' : 'Stummschalten', enabled: Boolean(tab.wc), click: () => ctrl.tabs.toggleMute(id) },
    {
      label: `Lautstärke (${tab.volume} %)`,
      submenu: VOLUME_STEPS.map((v) => ({ label: `${v} %`, type: 'radio', checked: tab.volume === v, click: () => ctrl.tabs.setVolume(id, v) })),
    },
    { type: 'separator' },
    ...(ctrl.tabs.split && ctrl.tabs.split.includes(id)
      ? [
          { label: 'Seiten tauschen', click: () => ctrl.tabs.swapSplit() },
          { label: 'Split Screen beenden', click: () => ctrl.tabs.unsplit() },
        ]
      : [{ label: 'Neben aktivem Tab anzeigen (Split Screen)', enabled: id !== ctrl.tabs.activeId, click: () => ctrl.tabs.splitWith(id) }]),
    { type: 'separator' },
    { label: 'Tab schlafen legen (RAM freigeben)', enabled: !ctrl.tabs.isVisible(id) && !tab.discarded, click: () => ctrl.tabs.discard(id) },
    { type: 'separator' },
    { label: 'Tab schließen', click: () => ctrl.closeTab(id) },
    { label: 'Andere Tabs schließen', click: () => ctrl.tabs.order.filter((t) => t !== id && !ctrl.tabs.tabs.get(t).pinned).forEach((t) => ctrl.closeTab(t)) },
    { label: 'Tabs rechts schließen', click: () => ctrl.tabs.order.slice(ctrl.tabs.order.indexOf(id) + 1).forEach((t) => ctrl.closeTab(t)) },
    { label: 'Geschlossenen Tab wiederherstellen', enabled: ctrl.closedTabs.length > 0, click: () => ctrl.reopenClosedTab() },
  ]).popup({ window: ctrl.win })
}

function showMainMenu(browser, ctrl) {
  const panel = (name) => () => ctrl.send('action', `panel:${name}`)
  Menu.buildFromTemplate([
    { label: 'Neuer Tab', accelerator: 'Ctrl+T', click: () => ctrl.newTab() },
    { label: 'Neues Fenster', accelerator: 'Ctrl+N', click: () => browser.createWindow() },
    { label: 'Neues privates Fenster', accelerator: 'Ctrl+Shift+N', click: () => browser.createWindow({ isPrivate: true }) },
    { type: 'separator' },
    { label: 'Verlauf', accelerator: 'Ctrl+H', click: panel('history') },
    { label: 'Downloads', accelerator: 'Ctrl+J', click: panel('downloads') },
    { label: 'Lesezeichen', click: panel('bookmarks') },
    { label: 'Notizen', click: panel('notes') },
    { label: 'Erweiterungen', click: panel('extensions') },
    { label: 'Chrome Web Store öffnen', click: () => ctrl.newTab('https://chromewebstore.google.com/') },
    { type: 'separator' },
    { label: 'Zoom +', accelerator: 'Ctrl+Plus', click: () => ctrl.zoom(1) },
    { label: 'Zoom −', accelerator: 'Ctrl+-', click: () => ctrl.zoom(-1) },
    { label: 'Zoom zurücksetzen', accelerator: 'Ctrl+0', click: () => ctrl.zoom(0) },
    { label: 'Vollbild', accelerator: 'F11', click: () => ctrl.win.setFullScreen(!ctrl.win.isFullScreen()) },
    { type: 'separator' },
    { label: 'Suchen …', accelerator: 'Ctrl+F', click: () => ctrl.send('action', 'find') },
    { label: 'Drucken …', accelerator: 'Ctrl+P', click: () => ctrl.runAction('print') },
    { label: 'Entwicklertools', accelerator: 'F12', click: () => ctrl.runAction('devtools') },
    { type: 'separator' },
    { label: browser.focus.state.active ? 'Fokus-Modus beenden' : 'Fokus-Modus starten …', click: () => (browser.focus.state.active ? browser.focus.stop() : panel('focus')()) },
    { type: 'separator' },
    { label: 'Passwörter & Autofill', click: () => browser.openSettings(ctrl, 'passwords') },
    { label: 'Daten aus Opera GX importieren …', click: () => browser.openSettings(ctrl, 'import') },
    { label: 'Einstellungen', accelerator: 'Alt+P', click: () => browser.openSettings(ctrl) },
    { type: 'separator' },
    { label: 'Beenden', click: () => require('electron').app.quit() },
  ]).popup({ window: ctrl.win })
}

module.exports = { registerIpc, cleanSelection }
