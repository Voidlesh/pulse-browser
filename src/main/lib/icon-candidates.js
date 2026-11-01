'use strict'

/**
 * Extracts icon candidates from a page's HTML, scored by how good they look
 * on a large tile: big apple-touch-icons and SVGs first, tiny favicons last.
 * @param {string} html
 * @param {string} baseUrl final URL of the page (for relative hrefs)
 * @returns {{ icons: {url: string, score: number}[], manifest: string|null }}
 */
function pickIconCandidates(html, baseUrl) {
  const head = String(html).slice(0, 200000)
  const base = resolveBase(head, baseUrl)
  const icons = []
  let manifest = null

  for (const tag of head.match(/<link\b[^>]*>/gi) || []) {
    const rel = attr(tag, 'rel').toLowerCase()
    const href = attr(tag, 'href')
    if (!href) continue
    const url = absolute(href, base)
    if (!url) continue
    if (/\bmanifest\b/.test(rel)) { manifest = manifest || url; continue }
    if (!/\b(icon|apple-touch-icon|apple-touch-icon-precomposed)\b/.test(rel) || /mask-icon/.test(rel)) continue

    const size = largestSize(attr(tag, 'sizes'))
    const type = attr(tag, 'type').toLowerCase()
    const isSvg = type.includes('svg') || /\.svg(\?|$)/i.test(url)
    let score = 10 + Math.min(size, 512) / 4
    if (/apple-touch-icon/.test(rel)) score += size ? 20 : 60 // usually 180px
    if (isSvg) score += 70
    if (!size && !isSvg && !/apple/.test(rel)) score += 4 // unknown size, often 16/32px
    icons.push({ url, score })
  }
  return { icons, manifest }
}

/** Icons from a web app manifest (PWA icons are usually 192/512px). */
function parseManifestIcons(json, manifestUrl) {
  const list = json && Array.isArray(json.icons) ? json.icons : []
  return list
    .filter((i) => i && typeof i.src === 'string' && !/monochrome/.test(i.purpose || ''))
    .map((i) => {
      const url = absolute(i.src, manifestUrl)
      const size = largestSize(i.sizes || '')
      const maskable = /maskable/.test(i.purpose || '') && !/any/.test(i.purpose || '')
      return url && { url, score: 15 + Math.min(size, 512) / 4 - (maskable ? 100 : 0) }
    })
    .filter(Boolean)
}

function resolveBase(head, pageUrl) {
  const baseTag = (head.match(/<base\b[^>]*>/i) || [])[0]
  const href = baseTag && attr(baseTag, 'href')
  return (href && absolute(href, pageUrl)) || pageUrl
}

function attr(tag, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)
  return m ? decodeEntities(m[2] ?? m[3] ?? m[4] ?? '').trim() : ''
}

function decodeEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
}

function absolute(href, base) {
  try {
    const url = new URL(href, base)
    return /^https?:$/.test(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

function largestSize(sizes) {
  if (/any/i.test(sizes)) return 512
  return Math.max(0, ...String(sizes).split(/\s+/).map((s) => Number(s.split(/x/i)[0]) || 0))
}

module.exports = { pickIconCandidates, parseManifestIcons }
