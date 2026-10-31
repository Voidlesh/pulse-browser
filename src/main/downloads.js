'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { app, shell } = require('electron')

let nextDownloadId = 1

/** Tracks downloads of all sessions; saves straight into the Downloads folder. */
class Downloads {
  constructor(onChange) {
    this.onChange = onChange
    this.items = new Map() // id -> { item, info }
  }

  attach(ses) {
    ses.on('will-download', (_event, item) => this.track(item, ses))
  }

  track(item, ses) {
    const id = nextDownloadId++
    const savePath = uniquePath(path.join(app.getPath('downloads'), sanitize(item.getFilename())))
    item.setSavePath(savePath)
    const entry = { item, session: ses, info: { id, url: item.getURL(), filename: path.basename(savePath), savePath, received: 0, total: item.getTotalBytes(), state: 'progressing', paused: false, started: Date.now() } }
    this.items.set(id, entry)
    const refresh = (state) => {
      entry.info = { ...entry.info, received: item.getReceivedBytes(), total: item.getTotalBytes(), state, paused: item.isPaused() }
      this.emit()
    }
    item.on('updated', (_e, state) => refresh(state))
    item.once('done', (_e, state) => refresh(state))
    this.emit(ses)
  }

  /** @param {Electron.Session|null} startedIn session of a newly started download */
  emit(startedIn = null) {
    this.onChange(startedIn)
  }

  /** Downloads of one session only, so private windows don't leak into normal ones. */
  list(ses) {
    return [...this.items.values()].filter((e) => e.session === ses).map((e) => e.info).sort((a, b) => b.started - a.started)
  }

  action(id, action) {
    const entry = this.items.get(id)
    if (!entry) return
    const { item, info } = entry
    if (action === 'open' && info.state === 'completed') shell.openPath(info.savePath)
    if (action === 'show') shell.showItemInFolder(info.savePath)
    if (action === 'pause' && item.canResume()) item.pause()
    if (action === 'resume' && item.canResume()) item.resume()
    if (action === 'cancel' && info.state === 'progressing') item.cancel()
    if (action === 'remove') this.items.delete(id)
    this.emit()
  }

  clearFinished() {
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
