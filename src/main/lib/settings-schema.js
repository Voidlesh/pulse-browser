'use strict'

const { SEARCH_ENGINES, ANIMATION_LEVELS, BG_EFFECTS } = require('../defaults')
const { validateShortcuts } = require('./shortcuts')
const { LANGUAGES } = require('./translate')

// Every user-editable setting with its validator. Unknown keys and invalid
// values are dropped, so the settings file can never hold garbage.

const bool = (v) => (typeof v === 'boolean' ? v : undefined)
const oneOf = (list) => (v) => (list.includes(v) ? v : undefined)
const int = (min, max) => (v) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined
}
const webUrl = (v) => {
  try {
    const url = new URL(String(v))
    return /^https?:$/.test(url.protocol) ? url.href : undefined
  } catch {
    return undefined
  }
}
const domain = (v) => {
  const d = String(v || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d) ? d : undefined
}
const list = (item, max) => (v) => (Array.isArray(v) ? [...new Set(v.map(item).filter(Boolean))].slice(0, max) : undefined)
const boolMap = (keys) => (v) => {
  if (!v || typeof v !== 'object') return undefined
  return Object.fromEntries(keys.map((k) => [k, Boolean(v[k])]))
}

const FIELDS = {
  startup: oneOf(['restore', 'newtab', 'pages']),
  startupPages: list(webUrl, 20),
  homepage: (v) => (v === '' ? '' : webUrl(v)),
  showHomeButton: bool,
  newtabSuggestions: bool,
  newtabClock: bool,
  searchEngine: oneOf([...Object.keys(SEARCH_ENGINES), 'custom']),
  customSearch: (v) => {
    if (!v || typeof v !== 'object') return undefined
    const url = String(v.url || '')
    if (url && (!url.includes('%s') || !webUrl(url.replace('%s', 'test')))) return undefined
    return { name: String(v.name || '').slice(0, 40), url }
  },
  accent: (v) => (/^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : undefined),
  themePreset: (v) => (typeof v === 'string' && /^[a-z0-9-]{1,30}$/.test(v) ? v : undefined),
  wallpaper: (v) => (typeof v === 'string' && (v === '' || /^(https?:|data:image\/(png|jpe?g|webp|gif);base64,)/.test(v)) && v.length < 8_000_000 ? v : undefined),
  bgEffect: oneOf(BG_EFFECTS),
  animations: oneOf(ANIMATION_LEVELS),
  showBookmarksBar: bool,
  showSidebar: bool,
  extensionsCollapsed: bool,
  defaultZoom: int(50, 200),
  uiSounds: bool,
  uiSoundVolume: int(0, 100),
  ambientMusic: bool,
  ambientVolume: int(0, 100),
  adblock: bool,
  doNotTrack: bool,
  httpsOnly: bool,
  clearOnExit: boolMap(['cache', 'cookies', 'history', 'downloads']),
  savePasswords: bool,
  autofillPasswords: bool,
  autofillAddresses: bool,
  suggestPasswords: bool,
  translateTarget: oneOf(Object.keys(LANGUAGES)),
  shortcuts: validateShortcuts,
  askDownloadLocation: bool,
  downloadDir: (v) => (typeof v === 'string' && v.length < 1000 ? v : undefined),
  newTabPosition: oneOf(['afterActive', 'end']),
  autoSleepMinutes: oneOf([0, 15, 30, 60, 120]),
  hardwareAcceleration: bool,
  focusMinutes: int(5, 240),
  focusBlocklist: list(domain, 100),
  hiddenSuggestions: list(webUrl, 200),
}

/**
 * Validates a partial settings update.
 * @param {object} patch
 * @param {object} current current settings (for nested merges)
 * @returns {object} only the accepted keys
 */
function validatePatch(patch, current) {
  const out = {}
  if (!patch || typeof patch !== 'object') return out
  for (const [key, validate] of Object.entries(FIELDS)) {
    if (!(key in patch)) continue
    const value = validate(patch[key])
    if (value !== undefined) out[key] = value
  }
  if (patch.limiter && typeof patch.limiter === 'object') out.limiter = validateLimiter(patch.limiter, current.limiter)
  return out
}

function validateLimiter(p, l) {
  const num = (v, min, max, fallback) => (Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Number(v))) : fallback)
  const flag = (v, fallback) => (typeof v === 'boolean' ? v : fallback)
  return {
    ram: { enabled: flag(p.ram?.enabled, l.ram.enabled), hard: flag(p.ram?.hard, l.ram.hard), limitMb: num(p.ram?.limitMb, 512, 65536, l.ram.limitMb) },
    cpu: { enabled: flag(p.cpu?.enabled, l.cpu.enabled), limitPercent: num(p.cpu?.limitPercent, 5, 100, l.cpu.limitPercent) },
    network: { enabled: flag(p.network?.enabled, l.network.enabled), limitKbps: num(p.network?.limitKbps, 64, 1_000_000, l.network.limitKbps) },
  }
}

/** Search URL template for the chosen engine (custom falls back to Google). */
function searchTemplateFor(settings) {
  if (settings.searchEngine === 'custom' && settings.customSearch && settings.customSearch.url) return settings.customSearch.url
  return (SEARCH_ENGINES[settings.searchEngine] || SEARCH_ENGINES.google).url
}

module.exports = { validatePatch, searchTemplateFor, domain }
