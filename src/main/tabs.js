'use strict'

const { EventEmitter } = require('node:events')
const { WebContentsView } = require('electron')
const { NEW_TAB_URL } = require('./lib/urls')

let nextTabId = 1

/**
 * Owns the tabs of one browser window. Only the active tab's view is attached
 * to the window; discarded tabs keep their navigation history but no renderer.
 *
 * Events: 'changed' (snapshot), 'navigated' (tab), 'title' (tab),
 *         'found' (tabId, result), 'created' (tab), 'closed' (tabId)
 */
class TabManager extends EventEmitter {
  /**
   * @param {Electron.BrowserWindow} win
   * @param {{ session: Electron.Session, preload: string, isPrivate: boolean,
   *   setupWebContents: (wc: Electron.WebContents, tab: object) => void }} options
   */
  constructor(win, options) {
    super()
    this.win = win
    this.options = options
    this.tabs = new Map()
    this.order = []
    this.activeId = null
    this.bounds = { x: 0, y: 0, width: 0, height: 0 }
    this.hidden = false
    this.changeQueued = false
  }

  get active() {
    return this.tabs.get(this.activeId) || null
  }

  byWebContents(wc) {
    for (const tab of this.tabs.values()) if (tab.wc === wc) return tab
    return null
  }

  create(url = NEW_TAB_URL, { active = true, index, pinned = false, history } = {}) {
    const tab = {
      id: nextTabId++, view: null, wc: null, url, title: 'Neuer Tab', favicon: '',
      loading: false, canGoBack: false, canGoForward: false, audible: false, muted: false,
      pinned, discarded: false, lastActive: Date.now(), blocked: 0, savedHistory: history || null,
    }
    this.tabs.set(tab.id, tab)
    const at = index === undefined ? this.insertIndexAfterActive() : index
    this.order = [...this.order.slice(0, at), tab.id, ...this.order.slice(at)]
    this.spawnView(tab)
    if (active || !this.activeId) this.activate(tab.id)
    this.emit('created', tab)
    this.queueChange()
    return tab
  }

  insertIndexAfterActive() {
    const i = this.order.indexOf(this.activeId)
    return i === -1 ? this.order.length : i + 1
  }

  spawnView(tab) {
    const view = new WebContentsView({
      webPreferences: {
        session: this.options.session,
        preload: this.options.preload,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: true,
      },
    })
    view.setBackgroundColor('#121019')
    tab.view = view
    tab.wc = view.webContents
    tab.discarded = false
    this.wireEvents(tab)
    this.options.setupWebContents(tab.wc, tab)

    const saved = tab.savedHistory
    tab.savedHistory = null
    if (saved && saved.entries && saved.entries.length) {
      tab.wc.navigationHistory.restore({ index: saved.index, entries: saved.entries }).catch(() => tab.wc.loadURL(tab.url))
    } else {
      tab.wc.loadURL(tab.url).catch(() => {})
    }
  }

  wireEvents(tab) {
    const wc = tab.wc
    const sync = () => {
      if (wc.isDestroyed()) return
      tab.url = wc.getURL() || tab.url
      tab.canGoBack = wc.navigationHistory.canGoBack()
      tab.canGoForward = wc.navigationHistory.canGoForward()
      this.queueChange()
    }
    wc.on('did-start-loading', () => { tab.loading = true; this.queueChange() })
    wc.on('did-stop-loading', () => { tab.loading = false; sync() })
    wc.on('did-navigate', () => { tab.favicon = ''; tab.blocked = 0; sync(); this.emit('navigated', tab) })
    wc.on('did-navigate-in-page', (_e, _url, isMainFrame) => { if (isMainFrame) { sync(); this.emit('navigated', tab) } })
    wc.on('page-title-updated', (_e, title) => { tab.title = title; this.queueChange(); this.emit('title', tab) })
    wc.on('page-favicon-updated', (_e, favicons) => { tab.favicon = favicons[0] || ''; this.queueChange() })
    wc.on('audio-state-changed', (e) => { tab.audible = e.audible; this.queueChange() })
    wc.on('found-in-page', (_e, result) => this.emit('found', tab.id, result))
    wc.on('render-process-gone', (_e, details) => {
      if (details.reason !== 'clean-exit') { tab.title = 'Seite abgestürzt'; this.queueChange() }
    })
  }

  activate(id) {
    const tab = this.tabs.get(id)
    if (!tab) return
    const previous = this.active
    if (previous && previous.view && previous !== tab) this.win.contentView.removeChildView(previous.view)
    if (tab.discarded) this.spawnView(tab)
    this.activeId = id
    tab.lastActive = Date.now()
    if (!this.hidden) this.attach(tab)
    this.emit('activated', tab)
    this.queueChange()
  }

  attach(tab) {
    this.win.contentView.addChildView(tab.view)
    tab.view.setBounds(this.bounds)
    if (!tab.wc.isDestroyed()) tab.wc.focus()
  }

  /** Hide/show the active page (e.g. while a full-screen UI overlay is open). */
  setHidden(hidden) {
    this.hidden = hidden
    const tab = this.active
    if (!tab || !tab.view) return
    if (hidden) this.win.contentView.removeChildView(tab.view)
    else this.attach(tab)
  }

  setBounds(bounds) {
    this.bounds = bounds
    const tab = this.active
    if (tab && tab.view && !this.hidden) tab.view.setBounds(bounds)
  }

  close(id) {
    const tab = this.tabs.get(id)
    if (!tab) return
    const idx = this.order.indexOf(id)
    this.order = this.order.filter((t) => t !== id)
    if (this.activeId === id) {
      this.activeId = null
      const nextId = this.order[Math.min(idx, this.order.length - 1)]
      if (nextId) this.activate(nextId)
    }
    this.destroyView(tab)
    this.tabs.delete(id)
    this.emit('closed', id)
    if (!this.order.length) this.emit('empty')
    this.queueChange()
  }

  destroyView(tab) {
    if (!tab.view) return
    if (!this.win.isDestroyed()) this.win.contentView.removeChildView(tab.view)
    if (!tab.wc.isDestroyed()) tab.wc.close()
    tab.view = null
    tab.wc = null
  }

  /** Frees the renderer of a background tab; it reloads on activation. */
  discard(id) {
    const tab = this.tabs.get(id)
    if (!tab || tab.discarded || id === this.activeId) return false
    tab.savedHistory = this.historyOf(tab)
    this.destroyView(tab)
    tab.discarded = true
    tab.audible = false
    this.queueChange()
    return true
  }

  historyOf(tab) {
    if (!tab.wc || tab.wc.isDestroyed()) return tab.savedHistory || { index: 0, entries: [{ url: tab.url, title: tab.title }] }
    const nav = tab.wc.navigationHistory
    return { index: nav.getActiveIndex(), entries: nav.getAllEntries().map(({ url, title }) => ({ url, title })) }
  }

  move(id, toIndex) {
    const without = this.order.filter((t) => t !== id)
    const at = Math.max(0, Math.min(toIndex, without.length))
    this.order = [...without.slice(0, at), id, ...without.slice(at)]
    this.queueChange()
  }

  activateRelative(step) {
    if (!this.order.length) return
    const i = this.order.indexOf(this.activeId)
    this.activate(this.order[(i + step + this.order.length) % this.order.length])
  }

  togglePin(id) {
    const tab = this.tabs.get(id)
    if (!tab) return
    tab.pinned = !tab.pinned
    const pinnedCount = this.order.filter((t) => this.tabs.get(t).pinned && t !== id).length
    // Pinned tabs live at the start; pinning/unpinning moves to the block boundary.
    this.move(id, pinnedCount)
  }

  toggleMute(id) {
    const tab = this.tabs.get(id)
    if (!tab || !tab.wc) return
    tab.muted = !tab.muted
    tab.wc.setAudioMuted(tab.muted)
    this.queueChange()
  }

  queueChange() {
    if (this.changeQueued) return
    this.changeQueued = true
    queueMicrotask(() => {
      this.changeQueued = false
      this.emit('changed', this.snapshot())
    })
  }

  snapshot() {
    return {
      activeId: this.activeId,
      tabs: this.order.map((id) => {
        const t = this.tabs.get(id)
        return {
          id: t.id, url: t.url, title: t.title, favicon: t.favicon, loading: t.loading,
          canGoBack: t.canGoBack, canGoForward: t.canGoForward, audible: t.audible, muted: t.muted,
          pinned: t.pinned, discarded: t.discarded, blocked: t.blocked,
        }
      }),
    }
  }

  /** Serializable session for restore on next start. */
  serialize() {
    return {
      activeIndex: Math.max(0, this.order.indexOf(this.activeId)),
      tabs: this.order.map((id) => {
        const t = this.tabs.get(id)
        return { url: t.url, title: t.title, pinned: t.pinned, history: this.historyOf(t) }
      }),
    }
  }

  destroyAll() {
    for (const tab of this.tabs.values()) this.destroyView(tab)
    this.tabs.clear()
    this.order = []
  }
}

module.exports = { TabManager }
