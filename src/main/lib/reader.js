'use strict'

// Reader view: a script pulls the main article out of the page (run in an
// isolated world, so page scripts can't interfere), the result is reduced to
// plain text blocks here and shown on pulse://newtab/reader.html.

const BLOCK_TYPES = new Set(['h2', 'h3', 'p', 'li', 'quote', 'pre', 'img'])
const MAX_BLOCKS = 1500
const MAX_TEXT = 20000

/**
 * Runs inside the page. Picks the element with the most paragraph text and
 * turns it into simple blocks. Must stay self-contained (it's serialised).
 */
function extractArticle() {
  const SKIP = 'nav, header, footer, aside, form, script, style, noscript, iframe, button, [role="navigation"], [role="banner"], [role="complementary"], [aria-hidden="true"], .ad, .ads, .advert, .share, .social, .comments, #comments, .newsletter, .related'
  const textLen = (el) => (el.textContent || '').trim().length
  const candidates = [...document.querySelectorAll('article, main, [role="main"], section, div')]
  let best = null
  let bestScore = 0
  for (const el of candidates) {
    const paragraphs = [...el.querySelectorAll(':scope > p, :scope > * > p')]
    let score = paragraphs.reduce((sum, p) => sum + Math.min(textLen(p), 1000), 0)
    if (el.matches('article, main, [role="main"]')) score *= 1.3
    // Lots of links relative to text = navigation, not an article.
    const linkText = [...el.querySelectorAll('a')].reduce((sum, a) => sum + textLen(a), 0)
    score *= 1 - Math.min(0.9, linkText / Math.max(1, textLen(el)))
    if (score > bestScore) { best = el; bestScore = score }
  }
  if (!best || bestScore < 400) return null
  const blocks = []
  const walk = (node) => {
    for (const el of node.children) {
      if (el.matches(SKIP)) continue
      const tag = el.tagName.toLowerCase()
      const text = (el.innerText || el.textContent || '').trim()
      if (/^h[1-3]$/.test(tag)) { if (text) blocks.push({ type: tag === 'h3' ? 'h3' : 'h2', text }) }
      else if (tag === 'p') { if (text) blocks.push({ type: 'p', text }) }
      else if (tag === 'li') { if (text) blocks.push({ type: 'li', text }) }
      else if (tag === 'blockquote') { if (text) blocks.push({ type: 'quote', text }) }
      else if (tag === 'pre') { if (text) blocks.push({ type: 'pre', text }) }
      else if (tag === 'img' || tag === 'picture' || tag === 'figure') {
        const img = tag === 'img' ? el : el.querySelector('img')
        // Lazy-loaded images may not be loaded yet: fall back to their data-src and declared size.
        const lazy = img && (img.dataset.src || img.dataset.lazySrc || img.dataset.original)
        // Placeholders (data: URIs, 1×1 GIFs) lose against the real image in data-src.
        const placeholder = img && (/^data:/.test(img.currentSrc || img.getAttribute('src') || '') || (img.complete && img.naturalWidth <= 2))
        const src = img && (lazy && (placeholder || !img.currentSrc) ? lazy : img.currentSrc || img.getAttribute('src') || lazy)
        const wide = img && (img.naturalWidth >= 200 || ((placeholder || img.naturalWidth === 0) && (Number(img.getAttribute('width')) >= 200 || lazy)))
        if (src && wide && !src.startsWith('data:')) blocks.push({ type: 'img', src, text: (el.querySelector('figcaption') || {}).textContent || img.alt || '' })
      } else walk(el)
    }
  }
  walk(best)
  const meta = (name) => (document.querySelector(`meta[property="${name}"], meta[name="${name}"]`) || {}).content || ''
  return {
    title: (document.querySelector('h1') || {}).textContent || meta('og:title') || document.title,
    byline: meta('author') || (document.querySelector('[rel="author"], .author, .byline') || {}).textContent || '',
    site: meta('og:site_name') || location.hostname,
    blocks,
  }
}

const clean = (v, max) => String(v || '').replace(/\s+\n/g, '\n').replace(/[ \t]+/g, ' ').trim().slice(0, max)

/** Reduces the page's result to known block types, text only, web images only. */
function sanitizeArticle(raw, url) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.blocks)) return null
  const blocks = []
  for (const b of raw.blocks.slice(0, MAX_BLOCKS)) {
    if (!b || !BLOCK_TYPES.has(b.type)) continue
    if (b.type === 'img') {
      try {
        const src = new URL(String(b.src), url)
        if (/^https?:$/.test(src.protocol)) blocks.push({ type: 'img', src: src.href, text: clean(b.text, 300) })
      } catch {
        // Skip unusable image URLs.
      }
      continue
    }
    const text = clean(b.text, b.type === 'pre' ? MAX_TEXT : 5000)
    // The headline is shown once, above the article.
    if ((b.type === 'h2' || b.type === 'h3') && text === clean(raw.title, 300)) continue
    if (text && !(blocks.length && blocks[blocks.length - 1].text === text)) blocks.push({ type: b.type, text })
  }
  if (blocks.filter((b) => b.type === 'p').length < 2) return null
  const words = blocks.reduce((sum, b) => sum + (b.type === 'img' ? 0 : b.text.split(/\s+/).length), 0)
  return {
    title: clean(raw.title, 300), byline: clean(raw.byline, 120), site: clean(raw.site, 120), url,
    minutes: Math.max(1, Math.round(words / 200)), blocks,
  }
}

module.exports = { extractArticle, sanitizeArticle }
