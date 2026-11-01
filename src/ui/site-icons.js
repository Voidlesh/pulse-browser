import { h, hostOf } from './util.js'

// Resolves real site icons (apple-touch-icon, manifest, favicon …) through the
// main process and shows a colored letter tile until the image has loaded.

const api = window.pulse
const resolved = new Map() // origin -> icon URL ('' = none)
const waiting = new Map() // origin -> Set<(url) => void>
const loaded = new Set() // icon URLs that rendered fine before (no letter flash on re-render)
let batch = new Set()
let timer = null

const originOf = (url) => {
  try {
    const { origin } = new URL(url)
    return /^https?:/.test(origin) ? origin : ''
  } catch {
    return ''
  }
}

function request(origin, callback) {
  if (resolved.has(origin)) return callback(resolved.get(origin))
  if (!waiting.has(origin)) waiting.set(origin, new Set())
  waiting.get(origin).add(callback)
  batch.add(origin)
  clearTimeout(timer)
  timer = setTimeout(flush, 25)
}

async function flush() {
  const origins = [...batch]
  batch = new Set()
  let icons = {}
  try {
    icons = await api.call('favicons', origins)
  } catch {
    icons = {}
  }
  for (const origin of origins) {
    const url = icons[origin] || ''
    resolved.set(origin, url)
    for (const cb of waiting.get(origin) || []) cb(url)
    waiting.delete(origin)
  }
}

/** Stable, pleasant hue per hostname for the letter fallback. */
function hueFor(host) {
  let hash = 0
  for (const ch of host) hash = (hash * 31 + ch.charCodeAt(0)) | 0
  return Math.abs(hash) % 360
}

/**
 * @param {string} url page URL whose icon to show
 * @param {{ size?: number, src?: string, label?: string }} [opts] src = icon already known (e.g. from the tab)
 */
export function siteIcon(url, { size = 16, src = '', label = '' } = {}) {
  const host = hostOf(url) || label || '?'
  const letter = h('span', { class: 'site-letter', style: { '--hue': hueFor(host) } }, (label || host).replace(/^www\./, '')[0]?.toUpperCase() || '?')
  const box = h('span', { class: 'site-icon', style: { width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.55)}px` } }, letter)

  const show = (iconUrl) => {
    if (!iconUrl) return
    const img = h('img', { alt: '', draggable: false, decoding: 'async' })
    if (loaded.has(iconUrl)) {
      box.replaceChildren(img)
      box.classList.add('loaded', 'instant')
    }
    img.onload = () => {
      if (img.naturalWidth < 2) return
      loaded.add(iconUrl)
      if (img.parentNode !== box) box.replaceChildren(img)
      box.classList.add('loaded')
    }
    img.onerror = () => {
      if (src && iconUrl === src) {
        const origin = originOf(url)
        if (origin) request(origin, (u) => u && u !== src && show(u))
      }
    }
    img.src = iconUrl
  }

  if (src) show(src)
  else {
    const origin = originOf(url)
    if (origin) request(origin, show)
  }
  return box
}
