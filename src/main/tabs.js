'use strict'

const { EventEmitter } = require('node:events')
const { WebContentsView } = require('electron')
const { NEW_TAB_URL } = require('./lib/urls')

let nextTabId = 1
const SPLIT_GAP = 4

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
   *   setupWebContents: (wc: Electron.WebContents, tab: object) => void,
   *   newTabPosition?: () => 'afterActive'|'end' }} options
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
    this.split = null // [leftId, rightId] shown side by side
  }

  /** Tab ids whose views are currently on screen. */
  visibleIds() {
    if (this.split && this.split.includes(this.activeId)) return this.split
    return this.activeId ? [this.activeId] : []
  }

  isVisible(id) {
    return this.visibleIds().includes(id)
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
      pinned, discarded: false, lastActive: Date.now(), blocked: 0, savedHistory: history || null, volume: 100,
    }
    this.tabs.set(tab.id, tab)
    const atEnd = this.options.newTabPosition && this.options.newTabPosition() === 'end'
    const at = index === undefined ? (atEnd ? this.order.length : this.insertIndexAfterActive()) : index
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
    wc.on('did-navigate', () => { tab.favicon = ''; tab.blocked = 0; tab.hasVideo = false; sync(); this.emit('navigated', tab) })
    wc.on('did-navigate-in-page', (_e, _url, isMainFrame) => { if (isMainFrame) { sync(); this.emit('navigated', tab) } })
    wc.on('page-title-updated', (_e, title) => { tab.title = title; this.queueChange(); this.emit('title', tab) })
    wc.on('page-favicon-updated', (_e, favicons) => { tab.favicon = favicons[0] || ''; this.queueChange(); this.emit('favicon', tab) })
    wc.on('audio-state-changed', (e) => { tab.audible = e.audible; this.queueChange() })
    wc.on('found-in-page', (_e, result) => this.emit('found', tab.id, result))
    wc.on('render-process-gone', (_e, details) => {
      if (details.reason !== 'clean-exit') { tab.title = 'Seite abgestürzt'; this.queueChange() }
    })
  }

  activate(id) {
    const tab = this.tabs.get(id)
    if (!tab) return
    const before = this.visibleIds()
    this.activeId = id
    tab.lastActive = Date.now()
    const after = this.visibleIds()
    for (const otherId of before) {
      const other = this.tabs.get(otherId)
      if (!after.includes(otherId) && other && other.view) this.win.contentView.removeChildView(other.view)
    }
    if (!this.hidden) this.layout()
    if (tab.wc && !tab.wc.isDestroyed()) tab.wc.focus()
    this.emit('activated', tab)
    this.queueChange()
  }

  /** Attaches the visible tab view(s) and sizes them (split = side by side). */
  layout() {
    const ids = this.visibleIds()
    const { x, y, width, height } = this.bounds
    const half = Math.max(0, Math.floor((width - SPLIT_GAP) / 2))
    ids.forEach((id, i) => {
      const tab = this.tabs.get(id)
      if (!tab) return
      if (tab.discarded) this.spawnView(tab)
      this.win.contentView.addChildView(tab.view)
      const bounds = ids.length === 1 ? this.bounds : { x: i === 0 ? x : x + half + SPLIT_GAP, y, width: i === 0 ? half : width - half - SPLIT_GAP, height }
      tab.view.setBounds(bounds)
    })
  }

  /** Hide/show the visible page(s) (e.g. while a full-screen UI overlay is open). */
  setHidden(hidden) {
    this.hidden = hidden
    if (hidden) {
      for (const id of this.visibleIds()) {
        const tab = this.tabs.get(id)
        if (tab && tab.view) this.win.contentView.removeChildView(tab.view)
      }
    } else {
      this.layout()
      const tab = this.active
      if (tab && tab.wc && !tab.wc.isDestroyed()) tab.wc.focus()
    }
  }

  setBounds(bounds) {
    this.bounds = bounds
    if (!this.hidden) this.layout()
  }

  // ---- split screen -------------------------------------------------------

  /** Shows `otherId` next to the active tab. */
  splitWith(otherId) {
    if (!this.tabs.has(otherId) || otherId === this.activeId || !this.activeId) return
    const previous = this.visibleIds()
    this.split = [this.activeId, otherId]
    for (const id of previous) {
      const t = this.tabs.get(id)
      if (!this.split.includes(id) && t && t.view) this.win.contentView.removeChildView(t.view)
    }
    if (!this.hidden) this.layout()
    this.queueChange()
  }

  unsplit() {
    if (!this.split) return
    const keep = this.activeId
    for (const id of this.split) {
      const t = this.tabs.get(id)
      if (id !== keep && t && t.view && this.split.includes(this.activeId)) this.win.contentView.removeChildView(t.view)
    }
    this.split = null
    if (!this.hidden) this.layout()
    this.queueChange()
  }

  swapSplit() {
    if (!this.split) return
    this.split = [this.split[1], this.split[0]]
    if (!this.hidden) this.layout()
    this.queueChange()
  }

  /** Clicking into a split pane makes that tab the active one (address bar etc.). */
  focusSplitPane(id) {
    if (!this.split || !this.split.includes(id) || !this.split.includes(this.activeId) || this.activeId === id) return
    this.activeId = id
    this.tabs.get(id).lastActive = Date.now()
    this.emit('activated', this.tabs.get(id))
    this.queueChange()
  }

  // ---- volume -------------------------------------------------------------

  /** Per-tab volume in percent (0–100); applied to the page's media elements. */
  setVolume(id, volume) {
    const tab = this.tabs.get(id)
    if (!tab) return
    tab.volume = Math.max(0, Math.min(100, Math.round(Number(volume) || 0)))
    if (tab.wc && !tab.wc.isDestroyed()) tab.wc.send('pulse:volume', tab.volume)
    this.queueChange()
  }

  close(id) {
    const tab = this.tabs.get(id)
    if (!tab) return
    const idx = this.order.indexOf(id)
    this.order = this.order.filter((t) => t !== id)
    let partner = null
    if (this.split && this.split.includes(id)) {
      partner = this.split.find((t) => t !== id)
      this.split = null
    }
    if (this.activeId === id) {
      this.activeId = null
      const nextId = partner || this.order[Math.min(idx, this.order.length - 1)]
      if (nextId) this.activate(nextId)
    } else if (partner && !this.hidden) {
      this.layout()
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
    if (!tab || tab.discarded || this.isVisible(id)) return false
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
          pinned: t.pinned, discarded: t.discarded, blocked: t.blocked, volume: t.volume, hasVideo: Boolean(t.hasVideo),
        }
      }),
      split: this.split,
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
    this.split = null
  }
}

module.exports = { TabManager }
