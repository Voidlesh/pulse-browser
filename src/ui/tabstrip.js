import { h, icon, hostOf } from './util.js'
import { siteIcon } from './site-icons.js'

// Keyed tab strip: existing tab elements are updated in place so tabs can
// animate in and out, and a single indicator glides to the active tab.

const api = window.pulse
const strip = document.querySelector('#tabstrip')
const indicator = h('div', { id: 'tab-indicator' })
const nodes = new Map() // tab id -> { el, parts, last }
let dragId = null
let firstRender = true
let currentActive = null
let order = [] // tab ids in rendered order (nodes Map keeps creation order)

strip.append(indicator)

export function renderTabStrip({ tabs, activeId, split }) {
  const ids = new Set(tabs.map((t) => t.id))
  for (const [id, node] of nodes) {
    if (!ids.has(id)) {
      nodes.delete(id)
      leave(node.el)
    }
  }

  let prev = null
  for (const tab of tabs) {
    let node = nodes.get(tab.id)
    if (!node) {
      node = create(tab)
      nodes.set(tab.id, node)
      if (!firstRender) node.el.classList.add('entering')
    }
    update(node, tab, tab.id === activeId, Boolean(split && split.includes(tab.id)))
    const anchor = prev ? prev.nextSibling : strip.firstChild
    if (anchor !== node.el) strip.insertBefore(node.el, anchor)
    prev = node.el
  }
  strip.append(indicator)
  firstRender = false
  currentActive = activeId
  order = tabs.map((t) => t.id)
  requestAnimationFrame(() => moveIndicator(activeId))
}

function create(tab) {
  const fav = h('span', { class: 'tab-fav-slot' })
  const title = h('span', { class: 'tab-title' })
  const audio = h('button', {
    class: 'tab-audio',
    onmousedown: (e) => { e.stopPropagation(); api.call('tab-mute', tab.id) },
  })
  const close = h('button', {
    class: 'tab-close', title: 'Tab schließen (Strg+W)', icon: 'close',
    onmousedown: (e) => { e.stopPropagation(); if (e.button === 0) api.call('tab-close', tab.id) },
  })
  const el = h('div', {
    class: 'tab',
    draggable: true,
    onmousedown: (e) => {
      if (e.button === 0) api.call('tab-activate', tab.id)
      if (e.button === 1) { e.preventDefault(); api.call('tab-close', tab.id) }
    },
    oncontextmenu: (e) => { e.preventDefault(); api.call('tab-menu', tab.id) },
    ondragstart: (e) => { dragId = tab.id; el.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move' },
    ondragend: () => { dragId = null; el.classList.remove('dragging') },
    ondragover: (e) => e.preventDefault(),
    ondrop: (e) => {
      e.preventDefault()
      const index = order.indexOf(tab.id)
      if (dragId && dragId !== tab.id) api.call('tab-move', dragId, index)
    },
    onanimationend: (e) => {
      if (e.animationName !== 'tab-in') return
      el.classList.remove('entering')
      moveIndicator(currentActive)
    },
  }, fav, title, audio, close)
  return { el, parts: { fav, title, audio }, last: {} }
}

function update(node, tab, active, inSplit) {
  const { el, parts, last } = node
  el.classList.toggle('active', active)
  el.classList.toggle('split', inSplit)
  el.classList.toggle('pinned', tab.pinned)
  el.classList.toggle('discarded', tab.discarded)
  el.classList.toggle('loading', tab.loading)
  el.title = `${tab.title}\n${tab.url}${tab.discarded ? '\n(schläft – RAM freigegeben)' : ''}`

  const favKey = `${tab.loading}|${tab.favicon}|${tab.loading ? '' : tab.url.split('/')[2]}`
  if (last.favKey !== favKey) {
    parts.fav.replaceChildren(
      tab.loading ? h('span', { class: 'spinner' })
        : tab.url.startsWith('pulse://settings') ? h('span', { class: 'tab-home', icon: 'settings' })
        : tab.url.startsWith('pulse:') ? h('span', { class: 'tab-home', icon: 'home' })
          : siteIcon(tab.url, { size: 16, src: tab.favicon }),
    )
    last.favKey = favKey
  }
  const title = tab.title || hostOf(tab.url)
  if (last.title !== title) {
    parts.title.textContent = title
    last.title = title
  }
  const audioState = tab.muted || (tab.audible && tab.volume === 0) ? 'mute' : tab.audible ? 'volume' : ''
  if (last.audio !== audioState) {
    parts.audio.hidden = !audioState
    parts.audio.title = tab.muted ? 'Ton an' : `Stummschalten (Lautstärke ${tab.volume} % – Rechtsklick auf den Tab)`
    parts.audio.replaceChildren(audioState ? icon(audioState) : '')
    last.audio = audioState
  }
}

function leave(el) {
  el.classList.add('leaving')
  el.style.pointerEvents = 'none'
  const done = () => el.remove()
  el.addEventListener('animationend', () => { done(); moveIndicator(currentActive) }, { once: true })
  // Safety net when animations are disabled.
  setTimeout(done, 400)
}

export function moveIndicator(activeId) {
  const node = nodes.get(activeId)
  if (!node || !node.el.isConnected) {
    indicator.style.opacity = '0'
    return
  }
  const { offsetLeft, offsetWidth } = node.el
  indicator.style.opacity = '1'
  indicator.style.transform = `translateX(${offsetLeft + 10}px)`
  indicator.style.width = `${Math.max(0, offsetWidth - 20)}px`
}

new ResizeObserver(() => moveIndicator(currentActive)).observe(strip)
