'use strict'

// Sandboxed preload for every web page: password manager hooks, plus a small
// API for Pulse's own pulse:// pages. Nothing is exposed to normal websites.
const { contextBridge, ipcRenderer } = require('electron')

const SETTINGS_EVENTS = new Set(['settings:changed', 'settings:update', 'settings:section'])

if (location.protocol === 'pulse:' && location.host === 'settings') {
  contextBridge.exposeInMainWorld('pulseSettings', {
    call: (name, ...args) => ipcRenderer.invoke(`settings:${name}`, ...args),
    on: (event, callback) => {
      if (!SETTINGS_EVENTS.has(event)) throw new Error(`Unbekanntes Ereignis ${event}`)
      ipcRenderer.on(event, (_e, payload) => callback(payload))
    },
  })
} else if (location.protocol === 'pulse:') {
  contextBridge.exposeInMainWorld('pulsePage', {
    newtabData: () => ipcRenderer.invoke('page:newtab'),
    setSpeedDial: (list) => ipcRenderer.invoke('page:speeddial-set', list),
    search: (text) => ipcRenderer.invoke('page:search', text),
    favicons: (urls) => ipcRenderer.invoke('page:favicons', urls),
    hideSuggestion: (url) => ipcRenderer.invoke('page:suggestion-hide', url),
    focusState: () => ipcRenderer.invoke('page:focus-state'),
    onSettings: (callback) => ipcRenderer.on('page:settings', (_e, data) => callback(data)),
    onFocus: (callback) => ipcRenderer.on('page:focus', (_e, data) => callback(data)),
  })
} else if (/^https?:$/.test(location.protocol)) {
  setupPasswords()
  setupAddresses()
  setupVolume()
}

/** Per-tab volume: scales every audio/video element of the page. */
function setupVolume() {
  let factor = 1
  const apply = (el) => {
    if (el instanceof HTMLMediaElement && Math.abs(el.volume - factor) > 0.001) el.volume = factor
  }
  const applyAll = () => document.querySelectorAll('audio, video').forEach(apply)
  ipcRenderer.on('pulse:volume', (_e, percent) => {
    factor = Math.max(0, Math.min(1, Number(percent) / 100))
    applyAll()
  })
  // New or (re)started media picks the tab volume up.
  document.addEventListener('play', (e) => factor !== 1 && apply(e.target), true)
  document.addEventListener('loadedmetadata', (e) => factor !== 1 && apply(e.target), true)
}

/**
 * Address autofill: when the user clicks into an address field, empty visible
 * fields of the same form are filled from the saved profile.
 */
function setupAddresses() {
  const KINDS = [
    ['name', /^(name|fullname|full-name|cc-name)$|(^|[_-])(full_?name|your-?name|vorname.*nachname)/i, ['name']],
    ['email', /e-?mail/i, ['email']],
    ['phone', /phone|tel|mobil|handy/i, ['tel', 'tel-national']],
    ['company', /company|firma|organi[sz]ation/i, ['organization']],
    ['street', /street|stra(ss|ß)e|address-?line1|address1|adresse/i, ['street-address', 'address-line1']],
    ['zip', /zip|postal|plz|postleitzahl/i, ['postal-code']],
    ['city', /city|town|stadt|ort$/i, ['address-level2']],
    ['country', /country|land$/i, ['country', 'country-name']],
  ]
  const kindOf = (el) => {
    if (!(el instanceof HTMLInputElement) || el.disabled || el.readOnly) return null
    if (!/^(text|email|tel|search|)$/.test(el.type)) return null
    const ac = (el.getAttribute('autocomplete') || '').toLowerCase().split(/\s+/).pop()
    if (ac === 'off' || ac === 'new-password' || ac === 'current-password' || ac === 'username') return null
    for (const [kind, , tokens] of KINDS) if (tokens.includes(ac)) return kind
    const hint = `${el.name} ${el.id} ${el.getAttribute('placeholder') || ''}`
    for (const [kind, pattern] of KINDS) if (pattern.test(hint)) return kind
    if (el.type === 'email') return 'email'
    if (el.type === 'tel') return 'phone'
    return null
  }
  // Hidden or off-screen fields are skipped so pages can't harvest data silently.
  const visible = (el) => {
    const r = el.getBoundingClientRect()
    const style = getComputedStyle(el)
    return r.width > 4 && r.height > 4 && style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0.1
  }
  const fill = (el, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }
  const filledForms = new WeakSet()
  document.addEventListener('pointerdown', async (e) => {
    if (!e.isTrusted) return
    const target = e.target
    if (!kindOf(target) || target.value) return
    const scope = target.form || document
    if (filledForms.has(scope)) return
    const fields = [...scope.querySelectorAll('input')].map((el) => [el, kindOf(el)]).filter(([el, kind]) => kind && !el.value && visible(el))
    // A lone e-mail field (newsletter, login) is no address form.
    if (new Set(fields.map(([, k]) => k)).size < 2) return
    const profile = await ipcRenderer.invoke('af:query')
    if (!profile) return
    filledForms.add(scope)
    for (const [el, kind] of fields) if (profile[kind] && !el.value) fill(el, profile[kind])
  }, true)
}

function setupPasswords() {
  const passwordFields = (root) => [...root.querySelectorAll('input[type="password"]')].filter((el) => !el.disabled)

  const usernameFor = (pw) => {
    const scope = pw.form || document
    const inputs = [...scope.querySelectorAll('input')].filter((el) => !el.disabled && el.type !== 'hidden')
    const idx = inputs.indexOf(pw)
    for (let i = idx - 1; i >= 0; i--) {
      if (/^(text|email|tel)$/.test(inputs[i].type || 'text')) return inputs[i]
    }
    return scope.querySelector('input[autocomplete="username"], input[type="email"]')
  }

  const capture = (root) => {
    const pw = passwordFields(root).find((el) => el.value)
    if (!pw) return
    const user = usernameFor(pw)
    ipcRenderer.send('pw:captured', { username: user ? user.value : '', password: pw.value })
  }

  document.addEventListener('submit', (e) => capture(e.target), true)
  // Many SPAs log in via button click + fetch instead of a form submit.
  document.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('button, input[type="submit"], [role="button"]')
    if (btn && passwordFields(btn.form || document).some((el) => el.value)) setTimeout(() => capture(btn.form || document), 0)
  }, true)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target && e.target.type === 'password') capture(e.target.form || document)
  }, true)

  // Credentials are only written into the page after the user interacts with
  // a login field, so page scripts can't harvest them silently on load.
  let filled = false
  let creds = null
  const fill = (el, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }
  const autofill = async (target) => {
    if (filled || !target || target.tagName !== 'INPUT') return
    const pw = target.type === 'password' ? target : passwordFields(target.form || document).find((el) => !el.value)
    if (!pw || (target !== pw && usernameFor(pw) !== target)) return
    if (!creds) creds = await ipcRenderer.invoke('pw:query')
    if (!creds.length || filled) return
    filled = true
    const { username, password } = creds[0]
    const user = usernameFor(pw)
    if (user && !user.value && username) fill(user, username)
    if (!pw.value) fill(pw, password)
  }

  document.addEventListener('pointerdown', (e) => e.isTrusted && autofill(e.target), true)
  // Keyboard users: fill once they tab into a login field (trusted key events only).
  document.addEventListener('keyup', (e) => e.isTrusted && e.key === 'Tab' && autofill(document.activeElement), true)
}
