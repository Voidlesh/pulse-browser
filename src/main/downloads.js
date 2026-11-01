'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { app, shell } = require('electron')
const { JsonStore } = require('./store')

const HISTORY_LIMIT = 500
let nextDownloadId = 1

/**
 * Tracks downloads of all sessions. Finished downloads of normal windows are
 * kept in a persistent history; private-window downloads stay in memory only.
 */
class Downloads {
  /**
   * @param {string} file history file
   * @param {(startedIn: Electron.Session|null) => void} onChange
   * @param {() => object} getSettings
   */
  constructor(file, onChange, getSettings) {
    this.store = new JsonStore(file, { items: [] })
    this.onChange = onChange
    this.getSettings = getSettings
    this.items = new Map() // id -> { item, session, persistent, info }
    nextDownloadId = Math.max(nextDownloadId, ...this.store.get().items.map((i) => i.id + 1), 1)
  }

  attach(ses, { persistent = true } = {}) {
    ses.on('will-download', (_event, item) => this.track(item, ses, persistent))
  }

  targetDir() {
    const dir = this.getSettings().downloadDir
    return dir && fs.existsSync(dir) ? dir : app.getPath('downloads')
  }

  track(item, ses, persistent) {
    const id = nextDownloadId++
    const suggested = uniquePath(path.join(this.targetDir(), sanitize(item.getFilename())))
    if (this.getSettings().askDownloadLocation) {
      // Electron then shows the native "Speichern unter" dialog itself.
      item.setSaveDialogOptions({ defaultPath: suggested })
    } else {
      item.setSavePath(suggested)
    }
    const entry = {
      item, session: ses, persistent,
      info: { id, url: item.getURL(), filename: path.basename(suggested), savePath: suggested, received: 0, total: item.getTotalBytes(), state: 'progressing', paused: false, started: Date.now() },
    }
    this.items.set(id, entry)
    const refresh = (state) => {
      const savePath = item.getSavePath() || entry.info.savePath
      entry.info = { ...entry.info, savePath, filename: path.basename(savePath), received: item.getReceivedBytes(), total: item.getTotalBytes(), state, paused: item.isPaused() }
      this.emit()
    }
    item.on('updated', (_e, state) => refresh(state))
    item.once('done', (_e, state) => {
      refresh(state)
      if (entry.persistent) this.remember(entry.info)
    })
    this.emit(ses)
  }

  remember(info) {
    this.store.update((s) => ({ ...s, items: [info, ...s.items.filter((i) => i.id !== info.id)].slice(0, HISTORY_LIMIT) }))
  }

  /** @param {Electron.Session|null} startedIn session of a newly started download */
  emit(startedIn = null) {
    this.onChange(startedIn)
  }

  /** Downloads visible to windows of one session (live + persisted history). */
  list(ses, mainSession) {
    const live = [...this.items.values()].filter((e) => e.session === ses).map((e) => e.info)
    const liveIds = new Set(live.map((i) => i.id))
    const persisted = ses === mainSession ? this.store.get().items.filter((i) => !liveIds.has(i.id)) : []
    return [...live, ...persisted].sort((a, b) => b.started - a.started)
  }

  /** Finished downloads of normal windows (for the cleaner). */
  history() {
    return this.store.get().items
  }

  action(id, action) {
    const entry = this.items.get(id)
    const info = entry ? entry.info : this.store.get().items.find((i) => i.id === id)
    if (!info) return
    if (action === 'open' && info.state === 'completed') shell.openPath(info.savePath)
    if (action === 'show') shell.showItemInFolder(info.savePath)
    if (entry && action === 'pause' && entry.item.canResume()) entry.item.pause()
    if (entry && action === 'resume' && entry.item.canResume()) entry.item.resume()
    if (entry && action === 'cancel' && info.state === 'progressing') entry.item.cancel()
    if (action === 'remove') {
      this.items.delete(id)
      this.store.update((s) => ({ ...s, items: s.items.filter((i) => i.id !== id) }))
    }
    this.emit()
  }

  clearFinished() {
    for (const [id, e] of this.items) if (e.info.state !== 'progressing') this.items.delete(id)
    this.clearHistory()
  }

  clearHistory() {
    this.store.update((s) => ({ ...s, items: [] }))
    for (const [id, e] of this.items) if (e.info.state !== 'progressing') this.items.delete(id)
    this.emit()
  }
}

function sanitize(name) {
  return (name || 'download').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 200)
}

function uniquePath(file) {
  if (!fs.existsSync(file)) return file
  const { dir, name, ext } = path.parse(file)
  for (let i = 1; ; i++) {
    const candidate = path.join(dir, `${name} (${i})${ext}`)
    if (!fs.existsSync(candidate)) return candidate
  }
}

module.exports = { Downloads }
