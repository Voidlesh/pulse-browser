'use strict'

/**
 * Maps a keyboard input (Electron `before-input-event` shape) to a browser action.
 * @param {{ type: string, key: string, control: boolean, shift: boolean, alt: boolean, meta: boolean }} input
 * @returns {string|null}
 */
function matchShortcut(input) {
  if (input.type !== 'keyDown') return null
  const key = input.key.length === 1 ? input.key.toLowerCase() : input.key
  const ctrl = input.control || input.meta

  if (ctrl && input.shift) {
    const map = { t: 'reopen-tab', n: 'private-window', b: 'toggle-bookmarks-bar', i: 'devtools', Tab: 'prev-tab', Delete: 'history' }
    return map[key] || null
  }
  if (ctrl && !input.alt) {
    if (/^[1-8]$/.test(key)) return `tab-${key}`
    const map = {
      t: 'new-tab', w: 'close-tab', n: 'new-window', l: 'focus-address', r: 'reload', f: 'find',
      d: 'bookmark', h: 'history', j: 'downloads', p: 'print', u: 'view-source', 9: 'tab-last',
      Tab: 'next-tab', PageDown: 'next-tab', PageUp: 'prev-tab',
      '+': 'zoom-in', '=': 'zoom-in', '-': 'zoom-out', 0: 'zoom-reset', F4: 'close-tab',
    }
    return map[key] || null
  }
  if (input.alt && !ctrl) {
    const map = { ArrowLeft: 'back', ArrowRight: 'forward', Home: 'home', d: 'focus-address' }
    return map[key] || null
  }
  const plain = { F5: 'reload', F6: 'focus-address', F11: 'fullscreen', F12: 'devtools', Escape: 'escape', BrowserBack: 'back', BrowserForward: 'forward' }
  return plain[key] || null
}

module.exports = { matchShortcut }
