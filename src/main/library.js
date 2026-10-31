'use strict'

const crypto = require('node:crypto')
const { JsonStore } = require('./store')

const HISTORY_LIMIT = 20000

/** Bookmarks: flat list of { id, title, url, folder, added }. */
class Bookmarks {
  constructor(file) {
    this.store = new JsonStore(file, { items: [] })
  }

  list() {
    return this.store.get().items
  }

  find(url) {
    return this.list().find((b) => b.url === url)
  }

  add({ title, url, folder = 'Lesezeichenleiste' }) {
    if (!/^(https?|file|pulse):/.test(url)) throw new Error('Ungültige Lesezeichen-URL')
    const item = { id: crypto.randomUUID(), title: String(title || url).slice(0, 300), url, folder, added: Date.now() }
    this.store.update((s) => ({ ...s, items: [...s.items, item] }))
    return item
  }

  update(id, patch) {
    const allowed = { ...(patch.title !== undefined && { title: String(patch.title) }), ...(patch.folder !== undefined && { folder: String(patch.folder) }) }
    this.store.update((s) => ({ ...s, items: s.items.map((b) => (b.id === id ? { ...b, ...allowed } : b)) }))
  }

  remove(id) {
    this.store.update((s) => ({ ...s, items: s.items.filter((b) => b.id !== id) }))
  }

  toggle({ title, url }) {
    const existing = this.find(url)
    if (existing) {
      this.remove(existing.id)
      return false
    }
    this.add({ title, url })
    return true
  }

  /** Adds entries whose URL+folder is not yet present. Returns number added. */
  importMany(entries) {
    const seen = new Set(this.list().map((b) => `${b.folder}|${b.url}`))
    const fresh = entries
      .filter((e) => !seen.has(`${e.folder}|${e.url}`))
      .map((e) => ({ id: crypto.randomUUID(), title: e.title, url: e.url, folder: e.folder || 'Importiert', added: e.added || Date.now() }))
    if (fresh.length) this.store.update((s) => ({ ...s, items: [...s.items, ...fresh] }))
    return fresh.length
  }
}

/** History: newest first, capped. */
class History {
  constructor(file) {
    this.store = new JsonStore(file, { items: [] })
  }

  add({ url, title }) {
    if (!/^https?:/.test(url)) return
    const now = Date.now()
    this.store.update((s) => {
      const [last] = s.items
      // Same page reloaded or title update: refresh the newest entry instead of duplicating.
      if (last && last.url === url && now - last.time < 30 * 60 * 1000) {
        return { ...s, items: [{ ...last, title: title || last.title, time: now }, ...s.items.slice(1)] }
      }
      return { ...s, items: [{ url, title: title || url, time: now }, ...s.items].slice(0, HISTORY_LIMIT) }
    })
  }

  updateTitle(url, title) {
    const [last] = this.store.get().items
    if (last && last.url === url && last.title !== title) {
      this.store.update((s) => ({ ...s, items: [{ ...last, title }, ...s.items.slice(1)] }))
    }
  }

  search(query = '', limit = 300) {
    const q = query.trim().toLowerCase()
    const items = this.store.get().items
    const hits = q ? items.filter((h) => h.url.toLowerCase().includes(q) || h.title.toLowerCase().includes(q)) : items
    return hits.slice(0, limit)
  }

  remove(url, time) {
    this.store.update((s) => ({ ...s, items: s.items.filter((h) => !(h.url === url && h.time === time)) }))
  }

  clear() {
    this.store.update((s) => ({ ...s, items: [] }))
  }

  importMany(entries) {
    const seen = new Set(this.store.get().items.map((h) => `${h.url}|${h.time}`))
    const fresh = entries.filter((e) => /^https?:/.test(e.url) && !seen.has(`${e.url}|${e.time}`))
    if (!fresh.length) return 0
    this.store.update((s) => ({
      ...s,
      items: [...s.items, ...fresh].sort((a, b) => b.time - a.time).slice(0, HISTORY_LIMIT),
    }))
    return fresh.length
  }
}

module.exports = { Bookmarks, History }
