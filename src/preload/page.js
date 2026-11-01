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
    reader: (token) => ipcRenderer.invoke('page:reader', token),
    readerOriginal: (url) => ipcRenderer.invoke('page:reader-original', url),
    onSettings: (callback) => ipcRenderer.on('page:settings', (_e, data) => callback(data)),
    onFocus: (callback) => ipcRenderer.on('page:focus', (_e, data) => callback(data)),
  })
} else if (/^https?:$/.test(location.protocol)) {
  setupPasswords()
  setupAddresses()
  setupVolume()
}

const MIN_OPACITY = 0.5
let hitSheet = null

/**
 * Hit test that also sees pointer-events:none elements. Uses a constructed
 * stylesheet (adoptedStyleSheets): no DOM mutation and no CSP violation.
 */
function forcedHitTest(x, y) {
  try {
    if (!hitSheet) {
      hitSheet = new CSSStyleSheet()
      hitSheet.replaceSync('*, *::before, *::after { pointer-events: auto !important; }')
    }
    const before = document.adoptedStyleSheets
    document.adoptedStyleSheets = [...before, hitSheet]
    try {
      return document.elementFromPoint(x, y)
    } finally {
      document.adoptedStyleSheets = before
    }
  } catch {
    return null
  }
}

function hasOpaqueBackground(node) {
  const style = getComputedStyle(node)
  if (style.backgroundImage && style.backgroundImage !== 'none') return true
  const m = /rgba?\(([^)]+)\)/.exec(style.backgroundColor)
  if (!m) return false
  const parts = m[1].split(/[\s,/]+/).filter(Boolean)
  const alpha = parts.length > 3 ? Number(parts[3]) : 1
  return alpha > 0.5
}

/**
 * Autofill only ever writes into fields the user can actually see right now:
 * on screen, clearly opaque, not hidden, not clipped away and not covered by
 * another element. This stops pages from harvesting data through invisible
 * fields.
 */
function isVisibleField(el) {
  if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false
  const r = el.getBoundingClientRect()
  if (r.width < 4 || r.height < 4) return false
  // At least a usable part of the field has to be inside the window.
  const left = Math.max(0, r.left)
  const right = Math.min(innerWidth, r.right)
  const top = Math.max(0, r.top)
  const bottom = Math.min(innerHeight, r.bottom)
  if (right - left < 4 || bottom - top < 4) return false
  // Something else on top of the visible part (an overlay hiding the field)
  // means it isn't really visible. Click-through decorations such as floating
  // labels (pointer-events: none) are ignored by the hit test, as they should be.
  const x = (left + right) / 2
  const y = (top + bottom) / 2
  const isField = (node) => node === el || (node && (el.contains(node) || node.control === el))
  if (!isField(document.elementFromPoint(x, y))) return false
  // Second pass: an opaque click-through cover (pointer-events: none) hiding
  // the field. Floating labels are text without an opaque background, so they pass.
  const cover = forcedHitTest(x, y)
  if (cover && !isField(cover) && hasOpaqueBackground(cover)) return false
  const doc = document.documentElement
  let opacity = 1
  for (let node = el; node && node !== doc; node = node.parentElement) {
    const style = getComputedStyle(node)
    opacity *= Number(style.opacity)
    if (opacity < MIN_OPACITY) return false
    if (style.clipPath !== 'none' || (style.clip && style.clip !== 'auto')) return false
    if (node !== el && style.overflow !== 'visible') {
      const box = node.getBoundingClientRect()
      const w = Math.min(r.right, box.right) - Math.max(r.left, box.left)
      const h = Math.min(r.bottom, box.bottom) - Math.max(r.top, box.top)
      if (w < 4 || h < 4) return false
    }
  }
  return true
}

/** Per-tab volume: scales every audio/video element of the page. */
function setupVolume() {
  let factor = 1
  // The page's own volume per element; the tab volume scales it.
  const base = new WeakMap()
  let applying = false
  const apply = (el) => {
    if (!(el instanceof HTMLMediaElement)) return
    if (!base.has(el)) base.set(el, el.volume)
    const target = base.get(el) * factor
    if (Math.abs(el.volume - target) < 0.001) return
    applying = true
    el.volume = target
    applying = false
  }
  ipcRenderer.on('pulse:volume', (_e, percent) => {
    factor = Math.max(0, Math.min(1, Number(percent) / 100))
    document.querySelectorAll('audio, video').forEach(apply)
  })
  // The page (or its player UI) changed the volume: remember that as its own level.
  document.addEventListener('volumechange', (e) => {
    if (applying || !(e.target instanceof HTMLMediaElement) || factor === 0) return
    base.set(e.target, Math.min(1, e.target.volume / factor))
  }, true)
  // New or (re)started media picks the tab volume up.
  document.addEventListener('play', (e) => factor !== 1 && apply(e.target), true)
  document.addEventListener('loadedmetadata', (e) => factor !== 1 && apply(e.target), true)
}

/** Fields Pulse has already filled once; if the user empties one, it stays empty. */
const filledOnce = new WeakSet()

/**
 * Address autofill: when the user clicks into an address field, empty visible
 * fields of the same form are filled from the saved profile.
 */
function setupAddresses() {
  // [kind, pattern for name/id/placeholder words, autocomplete tokens]
  const KINDS = [
    ['email', /^e-?mail/i, ['email']],
    ['phone', /^(phone|telefon|tel|mobil|handy)/i, ['tel', 'tel-national']],
    ['company', /^(company|firma|organi[sz]ation)/i, ['organization']],
    ['street', /^(street|stra(ss|ß)e|address-?line-?1|address1?|adresse)$/i, ['street-address', 'address-line1']],
    ['zip', /^(zip(code)?|postal(code)?|plz|postleitzahl)$/i, ['postal-code']],
    ['city', /^(city|town|stadt|ort|wohnort)$/i, ['address-level2']],
    ['country', /^(country|land)$/i, ['country', 'country-name']],
    ['name', /^(name|full-?name|your-?name|vollst(ae|ä)ndiger-?name)$/i, ['name']],
  ]
  const kindOf = (el) => {
    if (!(el instanceof HTMLInputElement) || el.disabled || el.readOnly) return null
    if (!/^(text|email|tel|search|)$/.test(el.type)) return null
    const ac = (el.getAttribute('autocomplete') || '').toLowerCase().split(/\s+/).pop()
    if (ac === 'off' || ac === 'new-password' || ac === 'current-password' || ac === 'username') return null
    for (const [kind, , tokens] of KINDS) if (tokens.includes(ac)) return kind
    // Each attribute is checked on its own, word by word ("billing_city" → "city").
    const words = [el.name, el.id, el.getAttribute('placeholder') || '']
      .flatMap((v) => [v.trim(), ...v.split(/[\s_\-[\].]+/)]).filter(Boolean)
    for (const [kind, pattern] of KINDS) if (words.some((w) => pattern.test(w))) return kind
    if (el.type === 'email') return 'email'
    if (el.type === 'tel') return 'phone'
    return null
  }
  const fill = (el, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }
  document.addEventListener('pointerdown', async (e) => {
    if (!e.isTrusted) return
    const target = e.target instanceof HTMLLabelElement ? e.target.control : e.target
    if (!kindOf(target) || target.value) return
    const scope = target.form || document
    if (!isVisibleField(target)) return
    // Only empty fields visible right now; fields further down get filled when the user clicks there.
    const fields = [...scope.querySelectorAll('input')].map((el) => [el, kindOf(el)])
      .filter(([el, kind]) => kind && !el.value && !filledOnce.has(el) && isVisibleField(el))
    // A lone e-mail field (newsletter, login) is no address form.
    if (new Set(fields.map(([, k]) => k)).size < 2) return
    const profile = await ipcRenderer.invoke('af:query')
    if (!profile) return
    for (const [el, kind] of fields) {
      if (!profile[kind] || el.value) continue
      fill(el, profile[kind])
      filledOnce.add(el)
    }
  }, true)
}

function setupPasswords() {
  const passwordFields = (root) => [...root.querySelectorAll('input[type="password"]')].filter((el) => !el.disabled)
  const visibleUsernameFor = (pw) => {
    const user = usernameFor(pw)
    return user && isVisibleField(user) ? user : null
  }

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
    if (!isVisibleField(target)) return
    const pw = target.type === 'password' ? target : passwordFields(target.form || document).find((el) => !el.value && isVisibleField(el))
    if (!pw || !isVisibleField(pw) || (target !== pw && usernameFor(pw) !== target)) return
    if (!creds) creds = await ipcRenderer.invoke('pw:query')
    if (!creds.length || filled) return
    filled = true
    const { username, password } = creds[0]
    const user = visibleUsernameFor(pw)
    if (user && !user.value && username) fill(user, username)
    if (!pw.value) fill(pw, password)
  }

  document.addEventListener('pointerdown', (e) => e.isTrusted && autofill(e.target instanceof HTMLLabelElement ? e.target.control : e.target), true)

  // ---- password generator: offered for sign-up / new-password fields
  const offered = new WeakSet()
  let lastNewPasswordField = null
  const isNewPasswordField = (el) => {
    if (!(el instanceof HTMLInputElement) || el.type !== 'password' || el.disabled || el.readOnly) return false
    if ((el.getAttribute('autocomplete') || '').includes('new-password')) return true
    // Registration forms usually ask for the password twice.
    return passwordFields(el.form || document).filter(isVisibleField).length >= 2
  }
  const maybeOffer = (target) => {
    const el = target instanceof HTMLLabelElement ? target.control : target
    if (!isNewPasswordField(el) || el.value || offered.has(el) || !isVisibleField(el)) return
    offered.add(el)
    lastNewPasswordField = el
    ipcRenderer.send('pw:needs-password')
  }
  document.addEventListener('pointerdown', (e) => e.isTrusted && maybeOffer(e.target), true)
  document.addEventListener('keyup', (e) => e.isTrusted && e.key === 'Tab' && maybeOffer(document.activeElement), true)

  ipcRenderer.on('pw:fill-generated', (_e, password) => {
    const active = document.activeElement
    const first = active instanceof HTMLInputElement && active.type === 'password' ? active : lastNewPasswordField
    if (!first || !first.isConnected || !isVisibleField(first)) return
    // The field and its "repeat password" partner(s) in the same form.
    const targets = [first, ...passwordFields(first.form || document).filter((el) => el !== first && !el.value && isVisibleField(el))]
    for (const el of targets.slice(0, 2)) fill(el, password)
    first.focus()
  })
  // Keyboard users: fill once they tab into a login field (trusted key events only).
  document.addEventListener('keyup', (e) => e.isTrusted && e.key === 'Tab' && autofill(document.activeElement), true)
}
