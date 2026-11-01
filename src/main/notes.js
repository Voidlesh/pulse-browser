'use strict'

const { JsonStore } = require('./store')

const MAX_NOTE_LENGTH = 20000

/** Notes are attached to a page (origin + path, ignoring query and hash). */
function noteKey(url) {
  try {
    const u = new URL(url)
    if (!/^https?:$/.test(u.protocol)) return ''
    return `${u.origin}${u.pathname.replace(/\/$/, '') || '/'}`
  } catch {
    return ''
  }
}

class Notes {
  constructor(file) {
    this.store = new JsonStore(file, { items: {} })
  }

  get(url) {
    const key = noteKey(url)
    return key ? this.store.get().items[key] || null : null
  }

  has(url) {
    return Boolean(this.get(url))
  }

  /** Empty text deletes the note. */
  set(url, title, text) {
    const key = noteKey(url)
    if (!key) throw new Error('Notizen gibt es nur für Webseiten')
    const clean = String(text || '').slice(0, MAX_NOTE_LENGTH)
    this.store.update((s) => {
      const { [key]: _old, ...rest } = s.items
      if (!clean.trim()) return { ...s, items: rest }
      return { ...s, items: { ...rest, [key]: { url: key, title: String(title || key).slice(0, 300), text: clean, updated: Date.now() } } }
    })
  }

  list() {
    return Object.values(this.store.get().items).sort((a, b) => b.updated - a.updated)
  }
}

module.exports = { Notes, noteKey }
