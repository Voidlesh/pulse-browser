'use strict'

// Preload for the browser chrome (tabs, toolbar, sidebar). Runs only on pulse://app.
const { contextBridge, ipcRenderer } = require('electron')

const EVENTS = new Set([
  'tabs', 'settings', 'downloads', 'bookmarks', 'limiter', 'found', 'zoom',
  'action', 'escape', 'fullscreen', 'password-prompt', 'update', 'focus', 'notes',
])

if (location.href.startsWith('pulse://app/')) {
  try {
    require('electron-chrome-extensions/browser-action').injectBrowserAction()
  } catch (err) {
    console.error('[pulse] Extension-Leiste nicht verfügbar:', err)
  }

  contextBridge.exposeInMainWorld('pulse', {
    call: (name, ...args) => ipcRenderer.invoke(`ui:${name}`, ...args),
    on: (event, callback) => {
      if (!EVENTS.has(event)) throw new Error(`Unbekanntes Ereignis ${event}`)
      const listener = (_e, payload) => callback(payload)
      ipcRenderer.on(event, listener)
      return () => ipcRenderer.removeListener(event, listener)
    },
  })
}
