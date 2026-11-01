import { h, icon, hostOf, formatBytes, toast } from './util.js'
import { siteIcon } from './site-icons.js'
import { state } from './app.js'

const api = window.pulse

const favImg = (url, src) => siteIcon(url, { size: 18, src })
const actionBtn = (iconName, title, onclick) => h('button', { class: 'icon-btn small', icon: iconName, title, onclick: (e) => { e.stopPropagation(); onclick(e) } })
// Plain click opens in the current tab, Ctrl/middle click in a new one.
const open = (url, e) => api.call('open', url, { newTab: Boolean(e && (e.ctrlKey || e.button === 1)) })

// ---------------------------------------------------------------- Bookmarks
function renderBookmarks(root) {
  const search = h('input', { class: 'search', placeholder: 'Lesezeichen durchsuchen', oninput: () => draw() })
  const list = h('div')
  const draw = () => {
    const q = search.value.trim().toLowerCase()
    const items = state.bookmarks.filter((b) => !q || b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q))
    const folders = new Map()
    for (const b of items) folders.set(b.folder, [...(folders.get(b.folder) || []), b])
    list.replaceChildren(...(items.length ? [...folders.entries()].flatMap(([folder, entries]) => [
      h('div', { class: 'section-title' }, folder || 'Ohne Ordner'),
      ...entries.map((b) => h('div', { class: 'list-item clickable', onclick: (e) => open(b.url, e) },
        favImg(b.url),
        h('div', { class: 'main' }, h('div', { class: 't' }, b.title), h('div', { class: 's' }, hostOf(b.url))),
        h('div', { class: 'actions' },
          actionBtn('settings', 'Umbenennen', (e) => {
            const row = e.target.closest('.list-item')
            const input = h('input', { class: 'field', value: b.title, onclick: (ev) => ev.stopPropagation() })
            const commit = () => { if (input.value.trim()) api.call('bookmark-update', b.id, { title: input.value.trim() }) }
            input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') commit(); if (ev.key === 'Escape') draw() })
            input.addEventListener('blur', commit)
            row.querySelector('.main').replaceChildren(input)
            input.focus()
            input.select()
          }),
          actionBtn('trash', 'Löschen', () => api.call('bookmark-remove', b.id))))),
    ]) : [h('div', { class: 'empty' }, q ? 'Keine Treffer' : 'Noch keine Lesezeichen. Mit dem Stern in der Adressleiste oder Strg+D hinzufügen.')]))
  }
  root.replaceChildren(search, list)
  draw()
}
renderBookmarks.live = (root) => root.querySelector('.search') && root.querySelector('.search').dispatchEvent(new Event('input'))

// ---------------------------------------------------------------- History
function renderHistory(root, tools) {
  tools.prepend(actionBtn('trash', 'Verlauf löschen', async () => {
    if (!confirm('Gesamten Verlauf löschen?')) return
    await api.call('history-clear')
    draw()
  }))
  const search = h('input', { class: 'search', placeholder: 'Verlauf durchsuchen' })
  const list = h('div')
  let timer = null
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(draw, 150) })
  async function draw() {
    const items = await api.call('history-search', search.value)
    let lastDay = ''
    const rows = []
    for (const item of items) {
      const day = new Date(item.time).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long' })
      if (day !== lastDay) { rows.push(h('div', { class: 'section-title' }, day)); lastDay = day }
      rows.push(h('div', { class: 'list-item clickable', onclick: (e) => open(item.url, e) },
        favImg(item.url),
        h('div', { class: 'main' }, h('div', { class: 't' }, item.title), h('div', { class: 's' }, `${new Date(item.time).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} · ${hostOf(item.url)}`)),
        h('div', { class: 'actions' }, actionBtn('trash', 'Entfernen', async () => { await api.call('history-remove', item.url, item.time); draw() }))))
    }
    list.replaceChildren(...(rows.length ? rows : [h('div', { class: 'empty' }, 'Kein Verlauf')]))
  }
  root.replaceChildren(search, list)
  draw()
  search.focus()
}

// ---------------------------------------------------------------- Downloads
function renderDownloads(root, tools) {
  if (tools) tools.prepend(actionBtn('trash', 'Fertige entfernen', () => api.call('downloads-clear')))
  renderDownloads.live(root)
}
renderDownloads.live = (root) => {
  const items = state.downloads
  root.replaceChildren(...(items.length ? items.map((d) => {
    const pct = d.total ? Math.round((d.received / d.total) * 100) : 0
    const status = {
      progressing: d.paused ? 'Pausiert' : `${formatBytes(d.received)} von ${formatBytes(d.total)}`,
      completed: formatBytes(d.total || d.received),
      cancelled: 'Abgebrochen',
      interrupted: 'Unterbrochen',
    }[d.state]
    return h('div', { class: 'list-item' },
      icon('download'),
      h('div', { class: 'main clickable', onclick: () => api.call('downloads-action', d.id, d.state === 'completed' ? 'open' : 'show') },
        h('div', { class: 't' }, d.filename),
        h('div', { class: 's' }, `${status} · ${hostOf(d.url)}`),
        d.state === 'progressing' && h('div', { class: 'progress' }, h('div', { style: { width: `${pct}%` } }))),
      h('div', { class: 'actions', style: d.state === 'progressing' ? { display: 'flex' } : {} },
        d.state === 'progressing' && actionBtn(d.paused ? 'forward' : 'stop', d.paused ? 'Fortsetzen' : 'Pausieren', () => api.call('downloads-action', d.id, d.paused ? 'resume' : 'pause')),
        d.state === 'progressing' && actionBtn('close', 'Abbrechen', () => api.call('downloads-action', d.id, 'cancel')),
        d.state === 'completed' && actionBtn('folder', 'Im Ordner zeigen', () => api.call('downloads-action', d.id, 'show')),
        d.state !== 'progressing' && actionBtn('trash', 'Aus Liste entfernen', () => api.call('downloads-action', d.id, 'remove'))))
  }) : [h('div', { class: 'empty' }, 'Keine Downloads in dieser Sitzung')]))
}

// ---------------------------------------------------------------- Passwords
function renderPasswords(root, tools) {
  tools.prepend(
    actionBtn('import', 'CSV importieren (Opera/Chrome-Export)', async () => {
      const r = await api.call('pw-import-csv')
      if (r) { toast(`${r.added} Passwörter importiert${r.skipped ? `, ${r.skipped} übersprungen` : ''}`); draw() }
    }),
    actionBtn('download', 'Als CSV exportieren', async () => {
      if (!confirm('Passwörter werden UNVERSCHLÜSSELT als CSV gespeichert. Fortfahren?')) return
      if (await api.call('pw-export-csv')) toast('Exportiert')
    }),
  )
  const search = h('input', { class: 'search', placeholder: 'Passwörter durchsuchen', oninput: () => draw() })
  const list = h('div')
  const form = addPasswordForm(() => draw())

  async function draw() {
    const q = search.value.trim().toLowerCase()
    const items = (await api.call('pw-list')).filter((p) => !q || p.origin.includes(q) || p.username.toLowerCase().includes(q))
      .sort((a, b) => hostOf(a.origin).localeCompare(hostOf(b.origin)))
    list.replaceChildren(...(items.length ? items.map(passwordRow(draw)) : [h('div', { class: 'empty' }, q ? 'Keine Treffer' : 'Noch keine Passwörter gespeichert. Pulse fragt nach dem Login, ob es speichern soll – oder importiere deine Opera-GX-Passwörter als CSV (Import-Symbol oben).')]))
  }
  root.replaceChildren(search, list, h('div', { class: 'section-title' }, 'Manuell hinzufügen'), form)
  draw()
}

function passwordRow(redraw) {
  return (p) => {
    const value = h('div', { class: 's pw-value' }, '••••••••••')
    let shown = false
    return h('div', { class: 'list-item' },
      favImg(p.origin),
      h('div', { class: 'main' }, h('div', { class: 't' }, `${hostOf(p.origin)} · ${p.username || '(ohne Benutzername)'}`), value),
      h('div', { class: 'actions' },
        actionBtn('eye', 'Anzeigen', async () => {
          shown = !shown
          value.textContent = shown ? await api.call('pw-reveal', p.id) : '••••••••••'
        }),
        actionBtn('copy', 'Passwort kopieren', async () => { await api.call('pw-copy', p.id); toast('Passwort kopiert') }),
        actionBtn('globe', 'Seite öffnen', () => api.call('open', p.origin, { newTab: true })),
        actionBtn('trash', 'Löschen', async () => {
          if (!confirm(`Passwort für ${hostOf(p.origin)} löschen?`)) return
          await api.call('pw-delete', p.id)
          redraw()
        })))
  }
}

function addPasswordForm(onAdded) {
  const url = h('input', { class: 'field', placeholder: 'Website (https://…)' })
  const user = h('input', { class: 'field', placeholder: 'Benutzername / E-Mail', style: { marginTop: '6px' } })
  const pw = h('input', { class: 'field', type: 'password', placeholder: 'Passwort', style: { marginTop: '6px' } })
  return h('div', { class: 'card' }, url, user, pw, h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', onclick: async () => {
    try {
      await api.call('pw-add', { url: url.value.includes('://') ? url.value : `https://${url.value}`, username: user.value, password: pw.value })
      url.value = ''; user.value = ''; pw.value = ''
      toast('Gespeichert')
      onAdded()
    } catch { toast('Bitte gültige Website und Passwort angeben') }
  } }, icon('plus'), 'Speichern')))
}

// ---------------------------------------------------------------- Extensions
async function renderExtensions(root, tools) {
  tools.prepend(actionBtn('folder', 'Entpackte Erweiterung laden', async () => {
    const name = await api.call('ext-load-unpacked')
    if (name) { toast(`${name} geladen`); renderExtensions(root, document.createElement('div')) }
  }))
  const exts = await api.call('ext-list')
  root.replaceChildren(
    h('div', { class: 'card' },
      h('div', { style: { marginBottom: '8px' } }, 'Installiere Erweiterungen direkt aus dem Chrome Web Store – „Hinzufügen“ funktioniert dort wie in Chrome.'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn primary', onclick: () => api.call('open', 'https://chromewebstore.google.com/', { newTab: true }) }, icon('puzzle'), 'Chrome Web Store'),
        h('button', { class: 'btn', onclick: () => window.dispatchEvent(new CustomEvent('pulse-open-panel', { detail: 'import' })) }, icon('import'), 'Aus Opera GX übernehmen'))),
    h('div', { class: 'section-title' }, `Installiert (${exts.length})`),
    ...(exts.length ? exts.map((e) => h('div', { class: 'list-item' },
      e.icon ? h('img', { class: 'fav', src: e.icon }) : icon('puzzle'),
      h('div', { class: 'main' }, h('div', { class: 't' }, `${e.name} `, h('span', { class: 'muted' }, e.version)), h('div', { class: 's', title: e.description }, e.description)),
      h('div', { class: 'actions' },
        e.optionsUrl && actionBtn('settings', 'Optionen', () => api.call('open', e.optionsUrl, { newTab: true })),
        actionBtn('trash', 'Entfernen', async () => {
          if (!confirm(`${e.name} entfernen?`)) return
          await api.call('ext-remove', e.id)
          renderExtensions(root, document.createElement('div'))
        })))) : [h('div', { class: 'empty' }, 'Keine Erweiterungen installiert')]),
  )
}

export const DATA_PANELS = {
  bookmarks: renderBookmarks,
  history: renderHistory,
  downloads: renderDownloads,
  passwords: renderPasswords,
  extensions: renderExtensions,
}
