'use strict'

const { dialog, BrowserWindow, webContents: allWebContents } = require('electron')
const { JsonStore } = require('./store')
const { originOf } = require('./lib/urls')

const ALWAYS_ALLOWED = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock', 'keyboardLock', 'window-management'])
const ASK = {
  media: 'Kamera/Mikrofon verwenden',
  geolocation: 'deinen Standort abrufen',
  notifications: 'Benachrichtigungen anzeigen',
  midi: 'MIDI-Geräte verwenden',
  midiSysex: 'MIDI-Geräte verwenden',
  'clipboard-read': 'die Zwischenablage lesen',
  'display-capture': 'deinen Bildschirm aufnehmen',
  idleDetection: 'erkennen, ob du aktiv bist',
  'speaker-selection': 'Audioausgänge auswählen',
}

/** Per-origin permission prompts with remembered decisions. */
class Permissions {
  constructor(file) {
    this.store = new JsonStore(file, { decisions: {} })
  }

  attach(ses, { remember = true } = {}) {
    ses.setPermissionRequestHandler((wc, permission, callback, details) => {
      this.request(wc, permission, details, remember).then(callback, () => callback(false))
    })
    ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
      if (ALWAYS_ALLOWED.has(permission)) return true
      return this.store.get().decisions[`${originOf(requestingOrigin)}|${permission}`] === true
    })
  }

  async request(wc, permission, details, remember) {
    if (ALWAYS_ALLOWED.has(permission)) return true
    const label = ASK[permission]
    if (!label) return false
    const origin = originOf(details.requestingUrl || (wc && wc.getURL()) || '')
    if (!origin) return false
    const key = `${origin}|${permission}`
    const saved = this.store.get().decisions[key]
    if (saved !== undefined) return saved

    const parent = (wc && BrowserWindow.fromWebContents(hostOf(wc))) || BrowserWindow.getFocusedWindow()
    const { response, checkboxChecked } = await dialog.showMessageBox(parent, {
      type: 'question',
      buttons: ['Erlauben', 'Blockieren'],
      defaultId: 1,
      cancelId: 1,
      title: 'Berechtigung',
      message: `${new URL(origin).host} möchte ${label}.`,
      checkboxLabel: 'Entscheidung merken',
      checkboxChecked: remember,
    })
    const allowed = response === 0
    if (remember && checkboxChecked) this.store.update((s) => ({ ...s, decisions: { ...s.decisions, [key]: allowed } }))
    return allowed
  }

  list() {
    return Object.entries(this.store.get().decisions).map(([key, allowed]) => {
      const [origin, permission] = key.split('|')
      return { origin, permission, allowed }
    })
  }

  reset(origin, permission) {
    this.store.update((s) => {
      const { [`${origin}|${permission}`]: _removed, ...rest } = s.decisions
      return { ...s, decisions: rest }
    })
  }
}

// WebContentsView pages have no BrowserWindow of their own; find the hosting window.
function hostOf(wc) {
  return BrowserWindow.getAllWindows().find((w) => w.contentView.children.some((v) => v.webContents === wc))?.webContents || wc || allWebContents.getFocusedWebContents()
}

module.exports = { Permissions }
