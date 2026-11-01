'use strict'

// Sandboxed preload for every web page: password manager hooks, plus a small
// API for Pulse's own pulse:// pages. Nothing is exposed to normal websites.
const { contextBridge, ipcRenderer } = require('electron')

if (location.protocol === 'pulse:') {
  contextBridge.exposeInMainWorld('pulsePage', {
    newtabData: () => ipcRenderer.invoke('page:newtab'),
    setSpeedDial: (list) => ipcRenderer.invoke('page:speeddial-set', list),
    search: (text) => ipcRenderer.invoke('page:search', text),
    favicons: (urls) => ipcRenderer.invoke('page:favicons', urls),
    onSettings: (callback) => ipcRenderer.on('page:settings', (_e, data) => callback(data)),
  })
} else if (/^https?:$/.test(location.protocol)) {
  setupPasswords()
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
