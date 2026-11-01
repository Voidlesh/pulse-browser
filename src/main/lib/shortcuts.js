'use strict'

// Keyboard shortcuts. Every action has default key combos; users can replace
// them in the settings (overrides: action -> combos, [] = switched off).
// Combo format: modifiers in the order Ctrl, Alt, Shift, then the key,
// e.g. "Ctrl+Shift+T", "Alt+ArrowLeft", "F5".

/** [action, label, default combos, customizable] */
const SHORTCUTS = [
  ['new-tab', 'Neuer Tab', ['Ctrl+T']],
  ['close-tab', 'Tab schließen', ['Ctrl+W', 'Ctrl+F4']],
  ['reopen-tab', 'Geschlossenen Tab wiederherstellen', ['Ctrl+Shift+T']],
  ['new-window', 'Neues Fenster', ['Ctrl+N']],
  ['private-window', 'Neues privates Fenster', ['Ctrl+Shift+N']],
  ['next-tab', 'Nächster Tab', ['Ctrl+Tab', 'Ctrl+PageDown']],
  ['prev-tab', 'Vorheriger Tab', ['Ctrl+Shift+Tab', 'Ctrl+PageUp']],
  ['tab-last', 'Letzter Tab', ['Ctrl+9']],
  ['focus-address', 'Adressleiste', ['Ctrl+L', 'Alt+D', 'F6']],
  ['reload', 'Neu laden', ['Ctrl+R', 'F5']],
  ['back', 'Zurück', ['Alt+ArrowLeft', 'BrowserBack']],
  ['forward', 'Vorwärts', ['Alt+ArrowRight', 'BrowserForward']],
  ['home', 'Startseite', ['Alt+Home']],
  ['find', 'Auf Seite suchen', ['Ctrl+F']],
  ['bookmark', 'Lesezeichen setzen', ['Ctrl+D']],
  ['toggle-bookmarks-bar', 'Lesezeichenleiste ein/aus', ['Ctrl+Shift+B']],
  ['history', 'Verlauf', ['Ctrl+H', 'Ctrl+Shift+Delete']],
  ['downloads', 'Downloads', ['Ctrl+J']],
  ['palette', 'Befehlssuche', ['Ctrl+K', 'Ctrl+Shift+A']],
  ['snapshot', 'Snapshot', ['Ctrl+Shift+S']],
  ['easy-setup', 'Design-Fenster', ['Ctrl+Shift+E']],
  ['settings', 'Einstellungen', ['Alt+P']],
  ['reader', 'Leseansicht', ['F9']],
  ['pip', 'Bild-in-Bild (Video)', ['Alt+Shift+P']],
  ['translate-page', 'Seite übersetzen', ['Alt+Shift+T']],
  ['print', 'Drucken', ['Ctrl+P']],
  ['view-source', 'Seitenquelltext', ['Ctrl+U']],
  ['zoom-in', 'Vergrößern', ['Ctrl++', 'Ctrl+=']],
  ['zoom-out', 'Verkleinern', ['Ctrl+-']],
  ['zoom-reset', 'Zoom zurücksetzen', ['Ctrl+0']],
  ['fullscreen', 'Vollbild', ['F11']],
  ['devtools', 'Entwicklertools', ['F12', 'Ctrl+Shift+I']],
  // Fixed: tab number keys and Escape.
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => [`tab-${n}`, `Tab ${n}`, [`Ctrl+${n}`], false]),
  ['escape', 'Abbrechen / Vollbild verlassen', ['Escape'], false],
]

const CUSTOMIZABLE = new Set(SHORTCUTS.filter((s) => s[3] !== false).map((s) => s[0]))
const COMBO = /^((Ctrl|Alt|Shift)\+){0,3}[^\s+]{1,20}$|^((Ctrl|Alt|Shift)\+){1,3}\+$/

/** Turns a keyDown input into a combo string, or '' for lone modifier keys. */
function comboOf(input) {
  if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'].includes(input.key)) return ''
  const key = input.key.length === 1 ? input.key.toUpperCase() : input.key === ' ' ? 'Space' : input.key
  const mods = []
  if (input.control || input.meta) mods.push('Ctrl')
  if (input.alt) mods.push('Alt')
  if (input.shift) mods.push('Shift')
  return [...mods, key].join('+')
}

let cache = { overrides: null, map: null }

function buildMap(overrides) {
  const map = new Map()
  for (const [action, , defaults] of SHORTCUTS) {
    const combos = CUSTOMIZABLE.has(action) && overrides && Array.isArray(overrides[action]) ? overrides[action] : defaults
    for (const combo of combos) if (!map.has(combo.toUpperCase())) map.set(combo.toUpperCase(), action)
  }
  return map
}

/**
 * Maps a keyboard input (Electron `before-input-event` shape) to a browser action.
 * @param {{ type: string, key: string, control: boolean, shift: boolean, alt: boolean, meta: boolean }} input
 * @param {Record<string, string[]>} [overrides] user-defined combos per action
 * @returns {string|null}
 */
function matchShortcut(input, overrides = {}) {
  if (input.type !== 'keyDown') return null
  const combo = comboOf(input)
  if (!combo) return null
  if (cache.overrides !== overrides) cache = { overrides, map: buildMap(overrides) }
  return cache.map.get(combo.toUpperCase()) || null
}

/** Validates user overrides: known actions, valid combos, max 3 per action. */
function validateShortcuts(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const out = {}
  for (const [action, combos] of Object.entries(value)) {
    if (!CUSTOMIZABLE.has(action) || !Array.isArray(combos)) continue
    out[action] = [...new Set(combos.map(String).filter((c) => COMBO.test(c)))].slice(0, 3)
  }
  return out
}

/** Effective combos per action, for display in the UI and settings. */
function shortcutTable(overrides = {}) {
  return SHORTCUTS.map(([action, label, defaults, custom]) => ({
    action, label, defaults, customizable: custom !== false,
    combos: custom !== false && Array.isArray(overrides[action]) ? overrides[action] : defaults,
  }))
}

module.exports = { matchShortcut, comboOf, validateShortcuts, shortcutTable, SHORTCUTS }
