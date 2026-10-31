import { h, icon, faviconFor, hostOf, toast } from './util.js'
import { renderPanel, PANEL_TITLES } from './panels.js'

const api = window.pulse
const $ = (sel) => document.querySelector(sel)

export const state = {
  isPrivate: false,
  settings: null,
  tabs: { activeId: null, tabs: [] },
  downloads: [],
  bookmarks: [],
  limiter: null,
  panel: null, // 'control' | 'bookmarks' | … | 'app:<id>'
  editingAddress: false,
  update: null,
}

// ---------------------------------------------------------------- layout
function reportLayout() {
  const vp = $('#viewport').getBoundingClientRect()
  const slot = $('#webpanel-slot')
  const panel = slot.hidden ? null : slot.getBoundingClientRect()
  api.call('layout', { viewport: rect(vp), panel: panel && rect(panel) })
}
const rect = (r) => ({ x: r.left, y: r.top, width: r.width, height: r.height })
new ResizeObserver(reportLayout).observe($('#viewport'))
new ResizeObserver(reportLayout).observe($('#webpanel-slot'))
window.addEventListener('resize', reportLayout)

// ---------------------------------------------------------------- tabs
const activeTab = () => state.tabs.tabs.find((t) => t.id === state.tabs.activeId)
let dragId = null

function renderTabs() {
  const strip = $('#tabstrip')
  strip.replaceChildren(...state.tabs.tabs.map(renderTab))
  const tab = activeTab()
  document.title = tab ? `${tab.title} – Pulse` : 'Pulse'
  renderToolbar()
}

function renderTab(tab) {
  const fav = tab.loading
    ? h('div', { class: 'spinner' })
    : tab.favicon
      ? h('img', { class: 'tab-fav', src: tab.favicon, onerror: (e) => e.target.replaceWith(icon('globe')) })
      : h('span', { class: 'tab-fav placeholder', icon: tab.url.startsWith('pulse:') ? 'home' : 'globe' })
  const el = h('div', {
    class: `tab${tab.id === state.tabs.activeId ? ' active' : ''}${tab.pinned ? ' pinned' : ''}${tab.discarded ? ' discarded' : ''}`,
    title: `${tab.title}\n${tab.url}${tab.discarded ? '\n(schläft – RAM freigegeben)' : ''}`,
    draggable: true,
    onmousedown: (e) => {
      if (e.button === 0) api.call('tab-activate', tab.id)
      if (e.button === 1) { e.preventDefault(); api.call('tab-close', tab.id) }
    },
    oncontextmenu: (e) => { e.preventDefault(); api.call('tab-menu', tab.id) },
    ondragstart: () => { dragId = tab.id; el.classList.add('dragging') },
    ondragend: () => { dragId = null; el.classList.remove('dragging') },
    ondragover: (e) => e.preventDefault(),
    ondrop: (e) => {
      e.preventDefault()
      if (dragId && dragId !== tab.id) api.call('tab-move', dragId, state.tabs.tabs.findIndex((t) => t.id === tab.id))
    },
  },
  fav,
  h('span', { class: 'tab-title' }, tab.title || hostOf(tab.url)),
  (tab.audible || tab.muted) && h('button', {
    class: 'tab-audio', title: tab.muted ? 'Ton an' : 'Stummschalten', icon: tab.muted ? 'mute' : 'volume',
    onmousedown: (e) => { e.stopPropagation(); api.call('tab-mute', tab.id) },
  }),
  h('button', {
    class: 'tab-close', title: 'Tab schließen (Strg+W)', icon: 'close',
    onmousedown: (e) => { e.stopPropagation(); if (e.button === 0) api.call('tab-close', tab.id) },
  }))
  return el
}

// ---------------------------------------------------------------- toolbar
function renderToolbar() {
  const tab = activeTab()
  $('#btn-back').disabled = !tab || !tab.canGoBack
  $('#btn-forward').disabled = !tab || !tab.canGoForward
  const reload = $('#btn-reload')
  reload.replaceChildren(icon(tab && tab.loading ? 'stop' : 'reload'))
  reload.title = tab && tab.loading ? 'Stopp' : 'Neu laden (F5)'

  const url = tab ? tab.url : ''
  if (!state.editingAddress) $('#address').value = url.startsWith('pulse://newtab') ? '' : url
  const secure = url.startsWith('https:')
  const siteIcon = $('#site-icon')
  siteIcon.className = secure ? 'secure' : ''
  siteIcon.replaceChildren(icon(secure ? 'lock' : url.startsWith('pulse:') ? 'search' : 'globe', 14))

  const adb = $('#adblock-badge')
  const blocked = tab ? tab.blocked : 0
  adb.className = state.settings && !state.settings.adblock ? 'off' : blocked ? 'active' : ''
  adb.replaceChildren(icon('shield', 14), String(blocked || ''))
  updateBookmarkStar()
}

async function updateBookmarkStar() {
  const tab = activeTab()
  const on = tab && state.bookmarks.some((b) => b.url === tab.url)
  $('#btn-bookmark').classList.toggle('on', Boolean(on))
}

function renderBookmarksBar() {
  const bar = $('#bookmarks-bar')
  const show = state.settings && state.settings.showBookmarksBar && !state.isPrivate
  bar.hidden = !show
  if (!show) return reportLayout()
  const items = state.bookmarks.filter((b) => b.folder === 'Lesezeichenleiste' || b.folder.endsWith('/Lesezeichenleiste'))
  bar.replaceChildren(...(items.length ? items : state.bookmarks.slice(0, 30)).slice(0, 40).map((b) => h('button', {
    class: 'bm-chip', title: `${b.title}\n${b.url}`,
    onclick: (e) => api.call('open', b.url, { newTab: e.ctrlKey }),
    onauxclick: (e) => e.button === 1 && api.call('open', b.url, { newTab: true }),
  }, h('img', { src: faviconFor(b.url), onerror: (e) => e.target.replaceWith(icon('globe', 14)) }), h('span', { class: 't' }, b.title))))
  if (!state.bookmarks.length) bar.append(h('span', { class: 'muted' }, 'Lesezeichen erscheinen hier – Strg+D zum Hinzufügen'))
  reportLayout()
}

// ---------------------------------------------------------------- sidebar & panels
function renderSidebar() {
  const apps = (state.settings && state.settings.sidebarApps) || []
  $('#side-apps').replaceChildren(...apps.map((app) => {
    const btn = h('button', {
      class: `side-btn${state.panel === `app:${app.id}` ? ' active' : ''}`,
      title: app.title,
      onclick: () => togglePanel(`app:${app.id}`),
      oncontextmenu: (e) => {
        e.preventDefault()
        if (confirm(`„${app.title}“ aus der Seitenleiste entfernen?`)) api.call('sidebar-remove', app.id)
      },
    }, h('img', { src: faviconFor(app.url), onerror: (e) => e.target.replaceWith(h('span', { class: 'letter' }, app.title[0])) }))
    return btn
  }))
  for (const btn of document.querySelectorAll('.side-btn[data-panel]')) {
    btn.classList.toggle('active', state.panel === btn.dataset.panel)
  }
}

export function togglePanel(name) {
  openPanel(state.panel === name ? null : name)
}

export function openPanel(name) {
  state.panel = name
  const panel = $('#panel')
  const isApp = Boolean(name && name.startsWith('app:'))
  panel.hidden = !name
  panel.classList.toggle('web', isApp)
  $('#webpanel-slot').hidden = !isApp
  $('#panel-content').hidden = isApp
  api.call('web-panel', isApp ? name.slice(4) : null)
  renderSidebar()
  if (!name) return reportLayout()

  const tools = $('#panel-tools')
  tools.replaceChildren()
  if (isApp) {
    const app = state.settings.sidebarApps.find((a) => `app:${a.id}` === name)
    $('#panel-title').textContent = app ? app.title : ''
    tools.append(
      h('button', { class: 'icon-btn small', title: 'Zurück', icon: 'back', onclick: () => api.call('web-panel-action', app.id, 'back') }),
      h('button', { class: 'icon-btn small', title: 'Neu laden', icon: 'reload', onclick: () => api.call('web-panel-action', app.id, 'reload') }),
      h('button', { class: 'icon-btn small', title: 'Beenden (RAM freigeben)', icon: 'moon', onclick: () => { api.call('web-panel-action', app.id, 'unload'); openPanel(null) } }),
    )
  } else {
    $('#panel-title').textContent = PANEL_TITLES[name] || ''
    renderPanel(name, $('#panel-content'), tools)
  }
  tools.append(h('button', { class: 'icon-btn small', title: 'Schließen', icon: 'close', onclick: () => openPanel(null) }))
  requestAnimationFrame(reportLayout)
}

function refreshPanel(kind) {
  if (state.panel === kind) renderPanel(kind, $('#panel-content'), $('#panel-tools'), { refresh: true })
}

// ---------------------------------------------------------------- infobar (password prompt)
function showPasswordPrompt({ token, origin, username }) {
  const bar = $('#infobar')
  const done = (choice) => { api.call('pw-respond', token, choice); bar.hidden = true; reportLayout() }
  bar.replaceChildren(
    icon('key'),
    h('span', { class: 'msg' }, `Passwort für ${hostOf(origin)}${username ? ` (${username})` : ''} in Pulse speichern?`),
    h('button', { class: 'btn primary', onclick: () => { done('save'); toast('Passwort gespeichert') } }, 'Speichern'),
    h('button', { class: 'btn', onclick: () => done('never') }, 'Nie für diese Seite'),
    h('button', { class: 'icon-btn small', icon: 'close', onclick: () => done('dismiss') }),
  )
  bar.hidden = false
  reportLayout()
}

// ---------------------------------------------------------------- updates
let updateBarDismissed = false
function onUpdate(update) {
  state.update = update
  refreshPanel('settings')
  const bar = $('#updatebar')
  const show = update.status === 'ready' && !updateBarDismissed
  if (show) {
    bar.replaceChildren(
      icon('download'),
      h('span', { class: 'msg' }, `Pulse ${update.next} ist bereit. Es wird automatisch beim Beenden installiert.`),
      h('button', { class: 'btn primary', onclick: () => api.call('update-install') }, 'Jetzt neu starten'),
      h('button', { class: 'icon-btn small', icon: 'close', title: 'Später', onclick: () => { updateBarDismissed = true; bar.hidden = true; reportLayout() } }),
    )
  }
  if (bar.hidden === show) { bar.hidden = !show; reportLayout() }
}

// ---------------------------------------------------------------- find bar
let findText = ''
function openFind() {
  $('#findbar').hidden = false
  reportLayout()
  const input = $('#find-input')
  input.focus()
  input.select()
}
function closeFind() {
  $('#findbar').hidden = true
  findText = ''
  $('#find-count').textContent = ''
  api.call('find-stop')
  reportLayout()
}
$('#find-input').addEventListener('input', (e) => { findText = e.target.value; api.call('find', findText, {}) })
$('#find-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') api.call('find', findText, { forward: !e.shiftKey, findNext: true })
  if (e.key === 'Escape') closeFind()
})
$('#find-next').append(icon('down'))
$('#find-prev').append(icon('up'))
$('#find-close').append(icon('close'))
$('#find-next').onclick = () => api.call('find', findText, { forward: true, findNext: true })
$('#find-prev').onclick = () => api.call('find', findText, { forward: false, findNext: true })
$('#find-close').onclick = closeFind

// ---------------------------------------------------------------- toolbar wiring
const fill = (id, name) => $(id).append(icon(name))
fill('#btn-back', 'back'); fill('#btn-forward', 'forward'); fill('#btn-home', 'home')
fill('#btn-bookmark', 'star'); fill('#btn-downloads', 'download'); fill('#btn-menu', 'menu'); fill('#new-tab', 'plus')
for (const btn of document.querySelectorAll('.side-btn[data-panel]')) {
  const icons = { control: 'gauge', bookmarks: 'bookmark', history: 'history', downloads: 'download', passwords: 'key', extensions: 'puzzle', settings: 'settings' }
  btn.append(icon(icons[btn.dataset.panel], 20))
  btn.addEventListener('click', () => togglePanel(btn.dataset.panel))
}
$('#side-add').append(icon('plus', 18))
$('#side-add').onclick = () => openPanel('settings')

$('#btn-back').onclick = () => api.call('action', 'back')
$('#btn-forward').onclick = () => api.call('action', 'forward')
$('#btn-reload').onclick = () => api.call('action', activeTab() && activeTab().loading ? 'stop' : 'reload')
$('#btn-home').onclick = () => api.call('action', 'home')
$('#btn-menu').onclick = () => api.call('main-menu')
$('#logo').onclick = () => api.call('main-menu')
$('#new-tab').onclick = () => api.call('tab-new')
$('#btn-downloads').onclick = () => togglePanel('downloads')
$('#btn-bookmark').onclick = async () => {
  const added = await api.call('bookmark-toggle')
  if (added !== null) toast(added ? 'Lesezeichen hinzugefügt' : 'Lesezeichen entfernt')
}
$('#adblock-badge').onclick = () => openPanel('control')
$('#zoom-badge').onclick = () => api.call('action', 'zoom-reset')
$('#tabstrip').addEventListener('dblclick', (e) => e.target === $('#tabstrip') && api.call('tab-new'))

const address = $('#address')
address.addEventListener('focus', () => { state.editingAddress = true; requestAnimationFrame(() => address.select()) })
address.addEventListener('blur', () => { state.editingAddress = false; renderToolbar() })
address.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { state.editingAddress = false; renderToolbar(); address.blur() }
  if (e.key === 'Enter' && e.altKey) { e.preventDefault(); api.call('tab-new', address.value); address.blur() }
})
$('#address-form').addEventListener('submit', (e) => {
  e.preventDefault()
  const text = address.value
  state.editingAddress = false
  address.blur()
  api.call('navigate', text)
})

// ---------------------------------------------------------------- actions from main
const ACTIONS = {
  'focus-address': () => address.focus(),
  find: openFind,
  bookmark: () => $('#btn-bookmark').click(),
  history: () => openPanel('history'),
  downloads: () => openPanel('downloads'),
  'toggle-bookmarks-bar': () => api.call('settings-set', { showBookmarksBar: !state.settings.showBookmarksBar }),
}
window.addEventListener('pulse-open-panel', (e) => openPanel(e.detail))

function onAction(action) {
  if (action.startsWith('panel:')) return openPanel(action.slice(6))
  if (ACTIONS[action]) ACTIONS[action]()
}

// ---------------------------------------------------------------- theme
function applyTheme() {
  document.documentElement.style.setProperty('--accent', state.settings.accent)
}

// ---------------------------------------------------------------- boot
async function boot() {
  const init = await api.call('init')
  state.isPrivate = init.isPrivate
  state.settings = init.settings
  state.tabs = init.tabs
  state.downloads = init.downloads
  state.bookmarks = await api.call('bookmarks-list')
  document.body.classList.toggle('private', state.isPrivate)
  applyTheme()
  renderTabs()
  renderSidebar()
  renderBookmarksBar()
  reportLayout()

  api.on('tabs', (snapshot) => { state.tabs = snapshot; renderTabs() })
  api.on('settings', (settings) => {
    state.settings = settings
    applyTheme(); renderSidebar(); renderBookmarksBar(); renderToolbar()
    refreshPanel('settings')
  })
  api.on('bookmarks', (list) => { state.bookmarks = list; renderBookmarksBar(); updateBookmarkStar(); refreshPanel('bookmarks') })
  api.on('downloads', ({ list, started }) => {
    state.downloads = list
    const running = list.some((d) => d.state === 'progressing')
    $('#btn-downloads').querySelector('.dot')?.remove()
    if (running) $('#btn-downloads').append(h('span', { class: 'dot' }))
    if (started) toast(`Download gestartet: ${list[0].filename}`)
    refreshPanel('downloads')
  })
  api.on('limiter', (sample) => { state.limiter = sample; refreshPanel('control') })
  api.on('found', (r) => { $('#find-count').textContent = r.matches ? `${r.activeMatchOrdinal}/${r.matches}` : 'Keine Treffer' })
  api.on('zoom', (pct) => { const z = $('#zoom-badge'); z.hidden = pct === 100; z.textContent = `${pct}%` })
  api.on('action', onAction)
  api.on('escape', () => (!$('#findbar').hidden ? closeFind() : state.panel && openPanel(null)))
  api.on('fullscreen', (on) => { document.body.classList.toggle('fullscreen', on); requestAnimationFrame(reportLayout) })
  api.on('password-prompt', showPasswordPrompt)
  api.on('update', onUpdate)
  onUpdate(await api.call('update-state'))
}

boot().catch((err) => {
  $('#viewport-msg').textContent = `Fehler beim Start der Oberfläche: ${err.message}`
})
