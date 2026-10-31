'use strict'

const crypto = require('node:crypto')
const { safeStorage } = require('electron')
const { JsonStore } = require('./store')
const { originOf } = require('./lib/urls')
const { parseCsvObjects, toCsv } = require('./lib/csv')

/**
 * Password vault. Each password is encrypted individually with the OS key
 * store (Windows DPAPI via Electron safeStorage); plaintext never hits disk.
 */
class PasswordVault {
  constructor(file) {
    this.store = new JsonStore(file, { items: [], neverSave: [] })
  }

  ensureAvailable() {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Verschlüsselung des Betriebssystems ist nicht verfügbar')
  }

  encrypt(text) {
    this.ensureAvailable()
    return safeStorage.encryptString(String(text)).toString('base64')
  }

  decrypt(b64) {
    this.ensureAvailable()
    return safeStorage.decryptString(Buffer.from(b64, 'base64'))
  }

  /** Metadata only - never includes passwords. */
  list() {
    return this.store.get().items.map(({ passwordEnc, ...meta }) => meta)
  }

  reveal(id) {
    const item = this.store.get().items.find((p) => p.id === id)
    return item ? this.decrypt(item.passwordEnc) : null
  }

  forOrigin(origin) {
    if (!origin) return []
    return this.store.get().items
      .filter((p) => p.origin === origin)
      .map((p) => ({ id: p.id, username: p.username, password: this.decrypt(p.passwordEnc) }))
  }

  isNeverSave(origin) {
    return this.store.get().neverSave.includes(origin)
  }

  neverSave(origin) {
    this.store.update((s) => (s.neverSave.includes(origin) ? s : { ...s, neverSave: [...s.neverSave, origin] }))
  }

  /** Returns 'new' | 'updated' | 'unchanged'. */
  save({ origin, username, password }) {
    if (!origin || !password) throw new Error('Origin und Passwort sind erforderlich')
    const items = this.store.get().items
    const existing = items.find((p) => p.origin === origin && p.username === username)
    if (existing && this.decrypt(existing.passwordEnc) === password) return 'unchanged'
    const passwordEnc = this.encrypt(password)
    if (existing) {
      this.store.update((s) => ({ ...s, items: s.items.map((p) => (p.id === existing.id ? { ...p, passwordEnc, updated: Date.now() } : p)) }))
      return 'updated'
    }
    const item = { id: crypto.randomUUID(), origin, username: String(username || ''), passwordEnc, created: Date.now(), updated: Date.now() }
    this.store.update((s) => ({ ...s, items: [...s.items, item] }))
    return 'new'
  }

  /** Whether saving these credentials would change anything. */
  wouldChange({ origin, username, password }) {
    const existing = this.store.get().items.find((p) => p.origin === origin && p.username === username)
    return !existing || this.decrypt(existing.passwordEnc) !== password
  }

  remove(id) {
    this.store.update((s) => ({ ...s, items: s.items.filter((p) => p.id !== id) }))
  }

  /**
   * Imports a Chromium/Opera password export (columns: name,url,username,password[,note]).
   * @returns {{ added: number, skipped: number }}
   */
  importCsv(text) {
    let added = 0
    let skipped = 0
    for (const row of parseCsvObjects(text)) {
      const origin = originOf(row.url || row.origin || '')
      if (!origin || !row.password) { skipped++; continue }
      const result = this.save({ origin, username: row.username || '', password: row.password })
      if (result === 'new' || result === 'updated') added++
      else skipped++
    }
    return { added, skipped }
  }

  exportCsv() {
    const rows = this.store.get().items.map((p) => [new URL(p.origin).hostname, p.origin, p.username, this.decrypt(p.passwordEnc), ''])
    return toCsv(['name', 'url', 'username', 'password', 'note'], rows)
  }
}

module.exports = { PasswordVault }
