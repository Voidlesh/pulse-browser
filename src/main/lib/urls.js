'use strict'

const INTERNAL_SCHEME = 'pulse:'
const NEW_TAB_URL = 'pulse://newtab/'
const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'file:', 'pulse:', 'chrome-extension:', 'view-source:', 'about:'])

/**
 * Turns address-bar input into a navigable URL or a search URL.
 * @param {string} input
 * @param {string} searchTemplate URL with %s placeholder
 * @returns {string}
 */
function resolveInput(input, searchTemplate) {
  const text = String(input || '').trim()
  if (!text) return NEW_TAB_URL
  const search = () => searchTemplate.replace('%s', encodeURIComponent(text))

  if (/^[a-z][a-z0-9+.-]*:/i.test(text) && !/^localhost:\d+/i.test(text)) {
    try {
      const url = new URL(text)
      return ALLOWED_SCHEMES.has(url.protocol) ? url.href : search()
    } catch {
      return search()
    }
  }
  if (/\s/.test(text)) return search()

  const looksLikeHost = /^(localhost|\d{1,3}(\.\d{1,3}){3}|[^./]+(\.[^./]+)+)(:\d+)?(\/.*)?$/i.test(text)
  if (!looksLikeHost) return search()
  const isLocal = /^(localhost|127\.|\d{1,3}(\.\d{1,3}){3})/.test(text)
  try {
    return new URL(`${isLocal ? 'http' : 'https'}://${text}`).href
  } catch {
    return search()
  }
}

/** URL to show in the address bar (empty for the new tab page). */
function displayUrl(url) {
  return !url || url.startsWith(NEW_TAB_URL) ? '' : url
}

function originOf(url) {
  try {
    const { origin } = new URL(url)
    return origin === 'null' ? '' : origin
  } catch {
    return ''
  }
}

module.exports = { resolveInput, displayUrl, originOf, NEW_TAB_URL, INTERNAL_SCHEME }
