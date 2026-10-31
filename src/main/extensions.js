'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { nativeImage } = require('electron')
const { ElectronChromeExtensions } = require('electron-chrome-extensions')
const { installChromeWebStore } = require('electron-chrome-web-store')
const { isBrowserInternalExtension } = require('./lib/chromium-data')
const { readManifest } = require('./importer')

/**
 * Chrome extension support: chrome.* APIs via electron-chrome-extensions,
 * installs/updates from the Chrome Web Store, plus unpacked extensions
 * imported from Opera GX.
 */
class Extensions {
  /**
   * @param {{ session: Electron.Session, userData: string,
   *   createTab: (details: object) => Promise<[Electron.WebContents, Electron.BrowserWindow]>,
   *   selectTab: (wc: Electron.WebContents) => void, removeTab: (wc: Electron.WebContents) => void,
   *   createWindow: (details: object) => Promise<Electron.BrowserWindow> }} opts
   */
  constructor(opts) {
    this.session = opts.session
    this.unpackedDir = path.join(opts.userData, 'UnpackedExtensions')
    this.api = new ElectronChromeExtensions({
      session: opts.session,
      createTab: opts.createTab,
      selectTab: (wc) => opts.selectTab(wc),
      removeTab: (wc) => opts.removeTab(wc),
      createWindow: opts.createWindow,
      removeWindow: (win) => win.close(),
    })
  }

  get registry() {
    return this.session.extensions || this.session
  }

  async init() {
    try {
      await installChromeWebStore({ session: this.session, autoUpdate: true })
    } catch (err) {
      console.error('[extensions] Chrome Web Store Unterstützung fehlgeschlagen:', err.message)
    }
    await this.loadUnpacked()
  }

  async loadUnpacked() {
    if (!fs.existsSync(this.unpackedDir)) return
    for (const dir of fs.readdirSync(this.unpackedDir)) {
      const full = path.join(this.unpackedDir, dir)
      if (!fs.existsSync(path.join(full, 'manifest.json'))) continue
      // Skip Opera-only components imported by older versions.
      if (isBrowserInternalExtension(readManifest(full))) continue
      await this.loadPath(full)
    }
  }

  async loadPath(dir) {
    try {
      return await this.registry.loadExtension(dir, { allowFileAccess: true })
    } catch (err) {
      console.error(`[extensions] ${dir} konnte nicht geladen werden:`, err.message)
      return null
    }
  }

  list() {
    return this.registry.getAllExtensions().map((e) => ({
      id: e.id, name: e.name, version: e.version,
      description: e.manifest.description || '',
      icon: iconUrl(e),
      optionsUrl: e.manifest.options_page || (e.manifest.options_ui && e.manifest.options_ui.page) ? `chrome-extension://${e.id}/${e.manifest.options_page || e.manifest.options_ui.page}` : '',
    }))
  }

  remove(id) {
    const ext = this.registry.getExtension(id)
    if (!ext) return
    this.registry.removeExtension(id)
    // Only delete folders we own; Web Store installs live under userData/Extensions.
    if (ext.path.startsWith(path.dirname(this.unpackedDir))) fs.rmSync(ext.path, { recursive: true, force: true })
  }
}

function iconUrl(ext) {
  const icons = ext.manifest.icons || {}
  const size = Object.keys(icons).map(Number).sort((a, b) => b - a)[0]
  if (!size) return ''
  const file = path.resolve(ext.path, String(icons[size]).replace(/^\//, ''))
  if (!file.startsWith(path.resolve(ext.path))) return ''
  const img = nativeImage.createFromPath(file)
  return img.isEmpty() ? '' : img.resize({ width: 32 }).toDataURL()
}

module.exports = { Extensions }
