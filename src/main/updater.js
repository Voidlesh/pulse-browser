'use strict'

const { app } = require('electron')
const { autoUpdater } = require('electron-updater')

const CHECK_INTERVAL_MS = 2 * 60 * 60 * 1000
const FIRST_CHECK_DELAY_MS = 15 * 1000

/**
 * Silent auto-updates from GitHub Releases: checks on start and every two
 * hours, downloads in the background and installs when Pulse quits (or right
 * away when the user clicks "Neu starten").
 */
class Updater {
  /** @param {(state: object) => void} onState */
  constructor(onState) {
    this.onState = onState
    this.state = { status: 'idle', version: app.getVersion() }
  }

  start() {
    if (!app.isPackaged) {
      this.set({ status: 'dev' })
      return
    }
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.logger = { info() {}, warn: console.warn, error: console.error, debug() {} }

    autoUpdater.on('checking-for-update', () => this.set({ status: 'checking' }))
    autoUpdater.on('update-not-available', () => this.set({ status: 'current', checked: Date.now() }))
    autoUpdater.on('update-available', (info) => this.set({ status: 'downloading', next: info.version, percent: 0 }))
    autoUpdater.on('download-progress', (p) => this.set({ status: 'downloading', percent: Math.round(p.percent) }))
    autoUpdater.on('update-downloaded', (info) => this.set({ status: 'ready', next: info.version }))
    autoUpdater.on('error', (err) => this.set({ status: 'error', error: err.message }))

    setTimeout(() => this.check(), FIRST_CHECK_DELAY_MS)
    setInterval(() => this.check(), CHECK_INTERVAL_MS)
  }

  check() {
    if (!app.isPackaged || this.state.status === 'downloading' || this.state.status === 'ready') return
    autoUpdater.checkForUpdates().catch((err) => this.set({ status: 'error', error: err.message }))
  }

  /** Restarts into the downloaded version. Session is saved by before-quit. */
  installNow() {
    if (this.state.status === 'ready') autoUpdater.quitAndInstall(true, true)
  }

  set(patch) {
    this.state = { ...this.state, ...patch }
    this.onState(this.state)
  }
}

module.exports = { Updater }
