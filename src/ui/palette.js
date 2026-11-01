import { h, icon, hostOf } from './util.js'
import { siteIcon } from './site-icons.js'
import { openOverlay } from './overlay.js'

// Command palette (Strg+K): jump to open tabs, bookmarks, history or run any
// browser command. Arrow keys + Enter, like an IDE.

const api = window.pulse

/** @param {{ commands: {id: string, label: string, icon: string, keys?: string, hint?: string, run: () => void}[] }} deps */
export function openPalette({ commands }) {
  return openOverlay('palette', (root, close) => {
    const input = h('input', { class: 'pal-input', placeholder: 'Tabs, Lesezeichen, Verlauf oder Befehle durchsuchen …', spellcheck: false })
    const list = h('div', { class: 'pal-list', role: 'listbox' })
    const box = h('div', { class: 'pal' }, h('div', { class: 'pal-head' }, icon('search', 18), input, h('kbd', {}, 'Esc')), list)
    root.append(box)

    let items = []
    let selected = 0
    let seq = 0

    const run = async (item) => {
      await close()
      item.run()
    }

    const draw = (groups) => {
      items = groups.flatMap((g) => g.items)
      selected = Math.min(selected, Math.max(0, items.length - 1))
      let index = 0
      list.replaceChildren(...groups.filter((g) => g.items.length).flatMap((g) => [
        h('div', { class: 'pal-group' }, g.title),
        ...g.items.map((item) => {
          const i = index++
          return h('div', {
            class: `pal-item${i === selected ? ' selected' : ''}`,
            role: 'option',
            style: { '--i': Math.min(i, 12) },
            onmousemove: () => { if (selected !== i) { selected = i; highlight() } },
            onclick: () => run(item),
          }, item.lead, h('div', { class: 'pal-text' }, h('div', { class: 't' }, item.title), item.sub && h('div', { class: 's' }, item.sub)), item.keys && h('kbd', {}, item.keys))
        }),
      ]))
      if (!items.length) list.append(h('div', { class: 'pal-empty' }, 'Enter öffnet die Suche bzw. Adresse in einem neuen Tab'))
    }

    const highlight = () => {
      list.querySelectorAll('.pal-item').forEach((el, i) => el.classList.toggle('selected', i === selected))
      list.querySelectorAll('.pal-item')[selected]?.scrollIntoView({ block: 'nearest' })
    }

    const search = async () => {
      const q = input.value.trim().toLowerCase()
      const mine = ++seq
      const data = await api.call('palette', q)
      if (mine !== seq) return
      const cmds = commands
        .filter((c) => !q || c.label.toLowerCase().includes(q) || (c.hint || '').toLowerCase().includes(q))
        .slice(0, q ? 6 : 5)
        .map((c) => ({ title: c.label, sub: '', keys: c.keys, lead: h('span', { class: 'pal-icon', icon: c.icon }), run: c.run }))
      const lead = (u, favicon) => (u.startsWith('pulse:') ? h('span', { class: 'pal-icon', icon: 'home' }) : siteIcon(u, { size: 18, src: favicon }))
      const page = (u, t, extra = {}) => ({ title: t || hostOf(u), sub: u.startsWith('pulse:') ? 'Startseite' : u, lead: lead(u, extra.favicon), ...extra })
      draw([
        { title: 'Offene Tabs', items: data.tabs.map((t) => page(t.url, t.title, { favicon: t.favicon, keys: t.active ? 'aktiv' : '', run: () => api.call('limiter-tab', t.windowId, t.id, 'activate') })) },
        { title: 'Befehle', items: cmds },
        { title: 'Lesezeichen', items: data.bookmarks.map((b) => page(b.url, b.title, { run: () => api.call('open', b.url, { newTab: false }) })) },
        { title: 'Verlauf', items: data.history.map((x) => page(x.url, x.title, { run: () => api.call('open', x.url, { newTab: false }) })) },
      ])
    }

    input.addEventListener('input', () => { selected = 0; search() })
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); selected = Math.min(items.length - 1, selected + 1); highlight() }
      if (e.key === 'ArrowUp') { e.preventDefault(); selected = Math.max(0, selected - 1); highlight() }
      if (e.key === 'Enter') {
        e.preventDefault()
        if (items[selected]) run(items[selected])
        else if (input.value.trim()) close().then(() => api.call('tab-new', input.value.trim()))
      }
    })
    search()
    requestAnimationFrame(() => input.focus())
  })
}
