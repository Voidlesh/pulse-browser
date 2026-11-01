'use strict'

const path = require('node:path')
const { JsonStore } = require('./store')
const { originOf } = require('./lib/urls')
const { pickIconCandidates, parseManifestIcons } = require('./lib/icon-candidates')

const FETCH_TIMEOUT_MS = 6000
const MAX_HTML_BYTES = 512 * 1024
const CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000
const FAILURE_TTL_MS = 6 * 60 * 60 * 1000

/**
 * Finds the best-looking icon of a website (apple-touch-icon, manifest icons,
 * <link rel=icon>, /favicon.ico) and caches the winning URL per origin.
 */
class FaviconService {
  /** @param {string} userData @param {() => Electron.Session} getSession */
  constructor(userData, getSession) {
    this.store = new JsonStore(path.join(userData, 'favicons.json'), { icons: {} })
    this.getSession = getSession
    this.inflight = new Map()
  }

  /** @param {string[]} urls @returns {Promise<Record<string, string>>} origin -> icon URL */
  async resolveMany(urls) {
    const origins = [...new Set(urls.map(originOf).filter((o) => /^https?:/.test(o)))].slice(0, 64)
    const entries = await Promise.all(origins.map(async (o) => [o, await this.resolve(o)]))
    return Object.fromEntries(entries.filter(([, icon]) => icon))
  }

  /** Cached icons only, no network and no disk writes (for private windows). */
  cachedMany(urls) {
    const icons = this.store.get().icons
    const out = {}
    for (const url of urls) {
      const origin = originOf(url)
      if (icons[origin] && icons[origin].icon) out[origin] = icons[origin].icon
    }
    return out
  }

  async resolve(origin) {
    const cached = this.store.get().icons[origin]
    const ttl = cached && cached.icon ? CACHE_TTL_MS : FAILURE_TTL_MS
    if (cached && Date.now() - cached.time < ttl) return cached.icon || ''
    if (!this.inflight.has(origin)) {
      const job = this.discover(origin)
        .catch(() => '')
        .then((icon) => {
          // Keep an older good icon when the site is temporarily unreachable.
          const keep = !icon && cached && cached.icon ? cached.icon : icon
          this.store.update((s) => ({ ...s, icons: { ...s.icons, [origin]: { icon: keep, time: Date.now(), source: 'discovered' } } }))
          this.inflight.delete(origin)
          return keep
        })
      this.inflight.set(origin, job)
    }
    return this.inflight.get(origin)
  }

  /** A tab reported its favicon; remember it unless we already found a better one. */
  learn(pageUrl, iconUrl) {
    const origin = originOf(pageUrl)
    if (!/^https?:/.test(origin) || !/^(https?:|data:image\/)/.test(iconUrl) || iconUrl.length > 4096) return
    const cached = this.store.get().icons[origin]
    if (cached && cached.icon && cached.source === 'discovered') return
    this.store.update((s) => ({ ...s, icons: { ...s.icons, [origin]: { icon: iconUrl, time: Date.now(), source: 'tab' } } }))
  }

  async discover(origin) {
    const ses = this.getSession()
    const page = await this.fetch(ses, `${origin}/`, 'text/html')
    const candidates = []
    if (page) {
      const html = await readLimited(page, MAX_HTML_BYTES)
      const { icons, manifest } = pickIconCandidates(html, page.url || `${origin}/`)
      candidates.push(...icons)
      if (manifest) {
        const res = await this.fetch(ses, manifest, 'application/json')
        if (res) {
          try {
            candidates.push(...parseManifestIcons(JSON.parse(await readLimited(res, 256 * 1024)), res.url || manifest))
          } catch {
            // Broken manifest: ignore, other candidates remain.
          }
        }
      }
    }
    candidates.push({ url: `${origin}/favicon.ico`, score: 1 })
    candidates.sort((a, b) => b.score - a.score)
    for (const c of candidates.slice(0, 6)) {
      if (await this.isImage(ses, c.url)) return c.url
    }
    return ''
  }

  async isImage(ses, url) {
    const res = await this.fetch(ses, url, 'image/*')
    if (!res) return false
    const type = res.headers.get('content-type') || ''
    res.body && res.body.cancel().catch(() => {})
    return /^image\//.test(type) || /\.(ico|png|svg|webp|jpe?g)(\?|$)/i.test(url)
  }

  async fetch(ses, url, accept) {
    try {
      const res = await ses.fetch(url, { headers: { accept }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: 'follow' })
      return res.ok ? res : null
    } catch {
      return null
    }
  }
}

async function readLimited(res, maxBytes) {
  const reader = res.body.getReader()
  const chunks = []
  let size = 0
  while (size < maxBytes) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    size += value.length
  }
  reader.cancel().catch(() => {})
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8')
}

module.exports = { FaviconService }
