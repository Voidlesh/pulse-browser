'use strict'

const fs = require('node:fs')
const { shell } = require('electron')

/**
 * "Cleaner" like Opera GX: shows what can be freed and cleans the selected
 * categories. Downloaded files only ever go to the recycle bin.
 */
class Cleaner {
  /** @param {import('./browser').Browser} browser */
  constructor(browser) {
    this.browser = browser
  }

  async scan(ses) {
    const [cacheBytes, cookies] = await Promise.all([ses.getCacheSize().catch(() => 0), ses.cookies.get({}).catch(() => [])])
    const files = this.downloadedFiles()
    return {
      cache: { bytes: cacheBytes },
      cookies: { count: cookies.length },
      history: { count: this.browser.history.search('', Number.MAX_SAFE_INTEGER).length },
      downloadList: { count: this.browser.downloads.history().length },
      downloadFiles: { count: files.length, bytes: files.reduce((sum, f) => sum + f.size, 0) },
    }
  }

  downloadedFiles() {
    const out = []
    for (const d of this.browser.downloads.history()) {
      if (d.state !== 'completed') continue
      try {
        const stat = fs.statSync(d.savePath)
        if (stat.isFile()) out.push({ path: d.savePath, size: stat.size })
      } catch {
        // Already moved or deleted by the user.
      }
    }
    return out
  }

  /**
   * @param {Electron.Session} ses
   * @param {{cache?: boolean, cookies?: boolean, history?: boolean, downloadList?: boolean, downloadFiles?: boolean}} what
   */
  async clean(ses, what) {
    const result = { trashed: 0, failed: 0 }
    if (what.cache) await ses.clearCache()
    if (what.cookies) await ses.clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage', 'websql'] })
    if (what.history) this.browser.history.clear()
    if (what.downloadFiles) {
      for (const file of this.downloadedFiles()) {
        try {
          await shell.trashItem(file.path)
          result.trashed++
        } catch {
          result.failed++
        }
      }
    }
    if (what.downloadList || what.downloadFiles) this.browser.downloads.clearHistory()
    return result
  }
}

module.exports = { Cleaner }
