'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')
const { ElectronBlocker } = require('@ghostery/adblocker-electron')

/**
 * Network + cosmetic ad/tracker blocking (EasyList/EasyPrivacy based lists).
 * Lists are cached on disk so blocking works offline after the first start.
 */
class AdBlock {
  constructor(cacheDir, onBlocked) {
    this.cachePath = path.join(cacheDir, 'adblock-engine.bin')
    this.onBlocked = onBlocked
    this.blocker = null
    this.sessions = new Set()
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
    if (enabled && !active) this.blocker.enableBlockingInSession(ses)
    if (!enabled && active) this.blocker.disableBlockingInSession(ses)
  }
}

module.exports = { AdBlock }
