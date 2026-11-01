'use strict'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Start page suggestions: sites visited often and recently (frecency per
 * origin), excluding speed dial entries and dismissed suggestions.
 * @param {{url: string, title: string, time: number}[]} history newest first
 * @param {{ exclude?: string[], hidden?: string[], limit?: number, now?: number }} opts
 * @returns {{url: string, title: string, score: number}[]}
 */
function topSites(history, { exclude = [], hidden = [], limit = 8, now = Date.now() } = {}) {
  const originOf = (u) => {
    try {
      const { origin, protocol } = new URL(u)
      return /^https?:$/.test(protocol) ? origin : ''
    } catch {
      return ''
    }
  }
  const skip = new Set([...exclude, ...hidden].map(originOf).filter(Boolean))
  const sites = new Map()
  for (const item of history) {
    const origin = originOf(item.url)
    if (!origin || skip.has(origin)) continue
    const ageDays = Math.max(0, (now - item.time) / DAY_MS)
    if (ageDays > 90) continue
    // Recent visits weigh more; every visit counts.
    const weight = ageDays < 1 ? 1 : ageDays < 7 ? 0.7 : ageDays < 30 ? 0.4 : 0.15
    const site = sites.get(origin) || { url: `${origin}/`, title: '', score: 0 }
    site.score += weight
    // Prefer the title of the site's front page, else the newest title.
    const isRoot = new URL(item.url).pathname === '/'
    if (!site.title || (isRoot && !site.rootTitle)) {
      site.title = cleanTitle(item.title, origin)
      site.rootTitle = isRoot
    }
    sites.set(origin, site)
  }
  return [...sites.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ url, title, score }) => ({ url, title, score: Math.round(score * 100) / 100 }))
}

function cleanTitle(title, origin) {
  const host = new URL(origin).hostname.replace(/^www\./, '')
  const t = String(title || '').split(/ [-|–·•] /)[0].trim()
  return t && t.length <= 28 && !/^https?:/.test(t) ? t : host
}

module.exports = { topSites }
