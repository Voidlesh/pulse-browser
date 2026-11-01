'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')
const { ipcMain } = require('electron')
const { ElectronBlocker } = require('@ghostery/adblocker-electron')

// The library registers these IPC handlers globally once per session it
// enables, which throws for the second session (private windows) and removes
// them for everyone when one session is disabled. They don't depend on the
// session, so Pulse keeps exactly one registration while any session blocks.
const COSMETIC_CHANNELS = ['@ghostery/adblocker/inject-cosmetic-filters', '@ghostery/adblocker/is-mutation-observer-enabled']

/**
 * Network + cosmetic ad/tracker blocking (EasyList/EasyPrivacy based lists).
 * Lists are cached on disk so blocking works offline after the first start.
 */
class AdBlock {
  constructor(cacheDir, onBlocked) {
    this.cachePath = path.join(cacheDir, 'adblock-engine.bin')
    this.onBlocked = onBlocked
    this.blocker = null
    this.sessions = new Set() // sessions with blocking on
    this.totalBlocked = 0
  }

  async init() {
    try {
      this.blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, {
        path: this.cachePath,
        read: fs.readFile,
        write: fs.writeFile,
      })
      this.blocker.on('request-blocked', (request) => {
        this.totalBlocked++
        this.onBlocked(request.tabId)
      })
    } catch (err) {
      console.error('[adblock] Filterlisten konnten nicht geladen werden:', err.message)
    }
  }

  setEnabled(ses, enabled) {
    if (!this.blocker) return
    const active = this.blocker.isBlockingEnabled(ses)
    if (enabled && !active) {
      for (const channel of COSMETIC_CHANNELS) ipcMain.removeHandler(channel)
      this.blocker.enableBlockingInSession(ses)
      this.sessions.add(ses)
    }
    if (!enabled && active) {
      this.sessions.delete(ses)
      try {
        this.blocker.disableBlockingInSession(ses)
      } catch (err) {
        console.error('[adblock] Deaktivieren fehlgeschlagen:', err.message)
      } finally {
        if (this.sessions.size) this.restoreCosmeticHandlers()
      }
    }
  }

  /** A session is gone for good (closed private window). */
  forget(ses) {
    if (this.blocker && this.blocker.isBlockingEnabled(ses)) this.setEnabled(ses, false)
  }

  restoreCosmeticHandlers() {
    for (const channel of COSMETIC_CHANNELS) ipcMain.removeHandler(channel)
    ipcMain.handle(COSMETIC_CHANNELS[0], (event, url, msg) => this.blocker.onInjectCosmeticFilters(event, url, msg))
    ipcMain.handle(COSMETIC_CHANNELS[1], (event) => this.blocker.onIsMutationObserverEnabled(event))
  }
}

module.exports = { AdBlock }
