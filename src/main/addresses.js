'use strict'

const crypto = require('node:crypto')
const { safeStorage } = require('electron')
const { JsonStore } = require('./store')

const FIELDS = ['name', 'email', 'phone', 'company', 'street', 'zip', 'city', 'country']

/** Autofill address profiles, encrypted at rest with the OS key store. */
class AddressBook {
  constructor(file) {
    this.store = new JsonStore(file, { items: [] })
  }

  encrypt(data) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Verschlüsselung des Betriebssystems ist nicht verfügbar')
    return safeStorage.encryptString(JSON.stringify(data)).toString('base64')
  }

  decrypt(enc) {
    try {
      return JSON.parse(safeStorage.decryptString(Buffer.from(enc, 'base64')))
    } catch {
      return null
    }
  }

  list() {
    return this.store.get().items
      .map((item) => ({ id: item.id, ...this.decrypt(item.enc) }))
      .filter((p) => p.name !== undefined || p.email !== undefined)
  }

  get(id) {
    const item = this.store.get().items.find((p) => p.id === id)
    return item ? { id, ...this.decrypt(item.enc) } : null
  }

  save(profile) {
    const data = Object.fromEntries(FIELDS.map((f) => [f, String(profile[f] || '').trim().slice(0, 200)]))
    if (!Object.values(data).some(Boolean)) throw new Error('Leeres Profil')
    const id = profile.id && this.store.get().items.some((p) => p.id === profile.id) ? profile.id : crypto.randomUUID()
    const entry = { id, enc: this.encrypt(data), updated: Date.now() }
    this.store.update((s) => ({ ...s, items: [...s.items.filter((p) => p.id !== id), entry] }))
    return id
  }

  remove(id) {
    this.store.update((s) => ({ ...s, items: s.items.filter((p) => p.id !== id) }))
  }
}

module.exports = { AddressBook, ADDRESS_FIELDS: FIELDS }
