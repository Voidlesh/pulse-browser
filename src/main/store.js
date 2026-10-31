'use strict'

const fs = require('node:fs')
const path = require('node:path')

const WRITE_DELAY_MS = 400

/**
 * Small JSON file store. State is treated as immutable: `update` receives the
 * current state and must return a new object.
 */
class JsonStore {
  constructor(filePath, defaults) {
    this.filePath = filePath
    this.state = JsonStore.load(filePath, defaults)
    this.timer = null
    this.listeners = new Set()
  }

  static load(filePath, defaults) {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      return mergeDefaults(defaults, parsed)
    } catch (err) {
      if (err.code !== 'ENOENT') console.error(`[store] ${filePath} unlesbar, nutze Standardwerte:`, err.message)
      return structuredClone(defaults)
    }
  }

  get() {
    return this.state
  }

  update(updater) {
    const next = updater(this.state)
    if (next === this.state) return next
    this.state = next
    this.scheduleWrite()
    for (const listener of this.listeners) listener(next)
    return next
  }

  onChange(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  scheduleWrite() {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), WRITE_DELAY_MS)
  }

  flush() {
    clearTimeout(this.timer)
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
      const tmp = `${this.filePath}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2))
      fs.renameSync(tmp, this.filePath)
    } catch (err) {
      console.error(`[store] Schreiben von ${this.filePath} fehlgeschlagen:`, err)
    }
  }
}

/** Deep-merge plain objects so new default keys appear in old settings files. */
function mergeDefaults(defaults, value) {
  if (!isPlainObject(defaults) || !isPlainObject(value)) return value === undefined ? defaults : value
  const out = { ...defaults }
  for (const [key, v] of Object.entries(value)) out[key] = mergeDefaults(defaults[key], v)
  return out
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

module.exports = { JsonStore, mergeDefaults }
