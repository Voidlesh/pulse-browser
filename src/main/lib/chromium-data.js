'use strict'

// Chromium stores timestamps as microseconds since 1601-01-01 (Windows epoch).
const WINDOWS_EPOCH_OFFSET_MS = 11644473600000

function chromeTimeToMs(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.round(n / 1000 - WINDOWS_EPOCH_OFFSET_MS)
}

/**
 * Flattens a Chromium/Opera "Bookmarks" JSON file into a list with folder paths.
 * @param {object} json parsed Bookmarks file
 * @returns {{title: string, url: string, folder: string, added: number}[]}
 */
function flattenBookmarks(json) {
  const out = []
  const walk = (node, folder) => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'url' && typeof node.url === 'string' && /^https?:|^file:/.test(node.url)) {
      out.push({ title: node.name || node.url, url: node.url, folder, added: chromeTimeToMs(node.date_added) })
      return
    }
    if (Array.isArray(node.children)) {
      const name = node.name || ''
      const nextFolder = folder ? `${folder}/${name}` : name
      for (const child of node.children) walk(child, nextFolder)
    }
  }
  const roots = (json && json.roots) || {}
  for (const [key, root] of Object.entries(roots)) {
    if (root && typeof root === 'object' && Array.isArray(root.children)) {
      const label = key === 'bookmark_bar' ? 'Lesezeichenleiste' : root.name || key
      for (const child of root.children) walk(child, label)
    }
  }
  return out
}

/**
 * Picks the newest version directory of an unpacked extension (e.g. "1.2.3_0").
 * @param {string[]} versions
 */
function newestVersion(versions) {
  const parse = (v) => v.split(/[._]/).map((p) => Number(p) || 0)
  return [...versions].sort((a, b) => {
    const pa = parse(a)
    const pb = parse(b)
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pb[i] || 0) - (pa[i] || 0)
      if (d) return d
    }
    return 0
  })[0]
}

/**
 * Opera ships its own features (Opera AI, Wallet, GX sidebar …) as extensions
 * that rely on private browser APIs; they can't run anywhere but Opera.
 * @param {object} manifest
 */
function isBrowserInternalExtension(manifest) {
  const perms = [...(manifest.permissions || []), ...(manifest.optional_permissions || [])]
  return perms.some((p) => typeof p === 'string' && /Private$/.test(p))
}

module.exports = { flattenBookmarks, chromeTimeToMs, newestVersion, isBrowserInternalExtension }
