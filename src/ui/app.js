import { h, icon, hostOf, toast } from './util.js'
import { renderPanel, PANEL_TITLES } from './panels.js'
import { renderTabStrip } from './tabstrip.js'
import { siteIcon } from './site-icons.js'
import { setMotion, setLoading, stagger } from './motion.js'
import { overlayKind, closeOverlay } from './overlay.js'
import { openPalette } from './palette.js'
import { openSnapshot } from './snapshot.js'
import { openEasySetup } from './easy-setup.js'
import { configureSounds, playSound, setMediaPlaying } from './sounds.js'

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
  extensionCount: 0,
  focus: null,
  noteKeys: new Set(),
}
const settingsListeners = new Set()

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

// ---------------------------------------------------------------- tabs & toolbar
const activeTab = () => state.tabs.tabs.find((t) => t.id === state.tabs.activeId)

function renderTabs() {
  renderTabStrip(state.tabs)
  setMediaPlaying(state.tabs.tabs.some((t) => t.audible && !t.muted && t.volume > 0))
  const tab = activeTab()
  document.title = tab ? `${tab.title} – Pulse` : 'Pulse'
  renderToolbar()
}

function renderToolbar() {
  const tab = activeTab()
  $('#btn-back').disabled = !tab || !tab.canGoBack
  $('#btn-forward').disabled = !tab || !tab.canGoForward
  const reload = $('#btn-reload')
  const loading = Boolean(tab && tab.loading)
  if (reload.dataset.loading !== String(loading)) {
    reload.replaceChildren(icon(loading ? 'stop' : 'reload'))
    reload.dataset.loading = String(loading)
    reload.title = loading ? 'Stopp' : 'Neu laden (F5)'
  }
  setLoading(loading)

  const url = tab ? tab.url : ''
  if (!state.editingAddress) $('#address').value = url.startsWith('pulse://newtab') ? '' : url
  const secure = url.startsWith('https:')
  const siteIconEl = $('#site-icon')
  const kind = secure ? 'lock' : url.startsWith('pulse:') ? 'search' : 'globe'
  if (siteIconEl.dataset.kind !== kind) {
    siteIconEl.className = secure ? 'secure' : ''
    siteIconEl.replaceChildren(icon(kind, 14))
    siteIconEl.dataset.kind = kind
  }

  const adb = $('#adblock-badge')
  const blocked = tab ? tab.blocked : 0
  adb.className = state.settings && !state.settings.adblock ? 'off' : blocked ? 'active' : ''
  const count = String(blocked || '')
  if (adb.dataset.count !== count) {
    adb.replaceChildren(icon('shield', 14), h('span', { class: 'count' }, count))
    adb.dataset.count = count
    if (blocked) adb.classList.add('bump')
  }
  updateBookmarkStar()
  updateNoteButton()
  $('#btn-home').hidden = Boolean(state.settings && state.settings.showHomeButton === false)
  const split = state.tabs.split
  $('#btn-split').hidden = !(split && split.includes(state.tabs.activeId))
}

/** Same key the main process uses: origin + path without query/hash. */
function noteKeyOf(url) {
  try {
    const u = new URL(url)
    if (!/^https?:$/.test(u.protocol)) return ''
    return `${u.origin}${u.pathname.replace(/\/$/, '') || '/'}`
  } catch {
    return ''
  }
}

function updateNoteButton() {
  const tab = activeTab()
  const key = tab ? noteKeyOf(tab.url) : ''
  const btn = $('#btn-note')
  btn.hidden = !key || state.isPrivate
  btn.classList.toggle('on', Boolean(key && state.noteKeys.has(key)))
}

async function refreshNoteKeys() {
  state.noteKeys = new Set(await api.call('notes-keys'))
  updateNoteButton()
}
$('#adblock-badge').addEventListener('animationend', (e) => e.currentTarget.classList.remove('bump'))

function updateBookmarkStar() {
  const tab = activeTab()
  const on = Boolean(tab && state.bookmarks.some((b) => b.url === tab.url))
  const btn = $('#btn-bookmark')
  if (btn.classList.contains('on') !== on) {
    btn.classList.toggle('on', on)
    if (on) btn.classList.add('pop')
  }
}
$('#btn-bookmark').addEventListener('animationend', (e) => e.currentTarget.classList.remove('pop'))

function renderBookmarksBar() {
  const bar = $('#bookmarks-bar')
  const show = Boolean(state.settings && state.settings.showBookmarksBar && !state.isPrivate)
  bar.hidden = !show
  if (!show) return reportLayout()
  // No bookmarks at all: the whole bar disappears instead of showing an empty hint.
  if (!state.bookmarks.length) {
    bar.hidden = true
    return reportLayout()
  }
  const items = state.bookmarks.filter((b) => b.folder === 'Lesezeichenleiste' || b.folder.endsWith('/Lesezeichenleiste'))
  bar.replaceChildren(...(items.length ? items : state.bookmarks.slice(0, 30)).slice(0, 40).map((b) => h('button', {
    class: 'bm-chip', title: `${b.title}\n${b.url}`,
    onclick: (e) => api.call('open', b.url, { newTab: e.ctrlKey }),
    onauxclick: (e) => e.button === 1 && api.call('open', b.url, { newTab: true }),
  }, siteIcon(b.url, { size: 14 }), h('span', { class: 't' }, b.title))))
  reportLayout()
}

// ---------------------------------------------------------------- extensions (collapsible)
async function refreshExtensionCount() {
  try {
    state.extensionCount = (await api.call('ext-list')).length
  } catch {
    state.extensionCount = 0
  }
  renderExtensionToggle()
}

function renderExtensionToggle() {
  const collapsed = Boolean(state.settings && state.settings.extensionsCollapsed)
  document.body.classList.toggle('ext-collapsed', collapsed)
  const btn = $('#btn-ext')
  btn.hidden = state.isPrivate || state.extensionCount === 0
  btn.title = collapsed ? `Erweiterungen anzeigen (${state.extensionCount})` : 'Erweiterungen einklappen'
  btn.replaceChildren(icon('puzzle'), collapsed ? h('span', { class: 'ext-count' }, String(state.extensionCount)) : '')
}
$('#btn-ext').onclick = () => api.call('settings-set', { extensionsCollapsed: !state.settings.extensionsCollapsed })
$('#btn-ext').oncontextmenu = (e) => { e.preventDefault(); openPanel('extensions') }
window.addEventListener('focus', refreshExtensionCount)

// ---------------------------------------------------------------- sidebar & panels
function renderSidebar() {
  $('#sidebar').hidden = Boolean(state.settings && state.settings.showSidebar === false)
  const apps = (state.settings && state.settings.sidebarApps) || []
  const key = apps.map((a) => a.id).join('|')
  const container = $('#side-apps')
  if (container.dataset.key !== key) {
    container.replaceChildren(...apps.map((app) => h('button', {
      class: 'side-btn', title: app.title, dataset: undefined,
      onclick: () => togglePanel(`app:${app.id}`),
      oncontextmenu: (e) => {
        e.preventDefault()
        if (confirm(`„${app.title}“ aus der Seitenleiste entfernen?`)) api.call('sidebar-remove', app.id)
      },
    }, siteIcon(app.url, { size: 20, label: app.title }))))
    container.dataset.key = key
    ;[...container.children].forEach((btn, i) => { btn.dataset.app = apps[i].id })
  }
  for (const btn of container.children) btn.classList.toggle('active', state.panel === `app:${btn.dataset.app}`)
  for (const btn of document.querySelectorAll('.side-btn[data-panel]')) btn.classList.toggle('active', state.panel === btn.dataset.panel)
}

export function togglePanel(name) {
  openPanel(state.panel === name ? null : name)
}

export function openPanel(name) {
  const wasOpen = Boolean(state.panel)
  if (name !== state.panel) playSound(name ? 'open' : 'close')
  state.panel = name
  const panel = $('#panel')
  const isApp = Boolean(name && name.startsWith('app:'))
  panel.hidden = !name
  panel.classList.toggle('web', isApp)
  if (name && !wasOpen) { panel.classList.remove('slide-in'); void panel.offsetWidth; panel.classList.add('slide-in') }
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
    Promise.resolve(renderPanel(name, $('#panel-content'), tools)).then(() => stagger($('#panel-content')))
    if (name === 'extensions') refreshExtensionCount()
  }
  tools.append(h('button', { class: 'icon-btn small', title: 'Schließen', icon: 'close', onclick: () => openPanel(null) }))
  requestAnimationFrame(reportLayout)
}

function refreshPanel(kind) {
  if (state.panel === kind) renderPanel(kind, $('#panel-content'), $('#panel-tools'), { refresh: true })
}

// ---------------------------------------------------------------- info bars
function showBar(bar, children) {
  bar.replaceChildren(...children)
  if (bar.hidden) {
    bar.hidden = false
    bar.classList.remove('bar-in'); void bar.offsetWidth; bar.classList.add('bar-in')
  }
  reportLayout()
}
function hideBar(bar) {
  bar.hidden = true
  reportLayout()
}

function showPasswordPrompt({ token, origin, username }) {
  const bar = $('#infobar')
  const done = (choice) => { api.call('pw-respond', token, choice); hideBar(bar) }
  showBar(bar, [
    icon('key'),
    h('span', { class: 'msg' }, `Passwort für ${hostOf(origin)}${username ? ` (${username})` : ''} in Pulse speichern?`),
    h('button', { class: 'btn primary', onclick: () => { done('save'); toast('Passwort gespeichert') } }, 'Speichern'),
    h('button', { class: 'btn', onclick: () => done('never') }, 'Nie für diese Seite'),
    h('button', { class: 'icon-btn small', icon: 'close', onclick: () => done('dismiss') }),
  ])
}

let updateBarDismissed = false
function onUpdate(update) {
  state.update = update
  const bar = $('#updatebar')
  const show = update.status === 'ready' && !updateBarDismissed
  if (show && bar.hidden) {
    showBar(bar, [
      icon('download'),
      h('span', { class: 'msg' }, `Pulse ${update.next} ist bereit. Es wird automatisch beim Beenden installiert.`),
      h('button', { class: 'btn primary', onclick: () => api.call('update-install') }, 'Jetzt neu starten'),
      h('button', { class: 'icon-btn small', icon: 'close', title: 'Später', onclick: () => { updateBarDismissed = true; hideBar(bar) } }),
    ])
  }
  if (!show && !bar.hidden) hideBar(bar)
}

// ---------------------------------------------------------------- find bar
let findText = ''
function openFind() {
  const bar = $('#findbar')
  if (bar.hidden) showBar(bar, [...bar.children])
  const input = $('#find-input')
  input.focus()
  input.select()
}
function closeFind() {
  hideBar($('#findbar'))
  findText = ''
  $('#find-count').textContent = ''
  api.call('find-stop')
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

// ---------------------------------------------------------------- overlays (top-right tools)
const COMMANDS = [
  { id: 'new-tab', label: 'Neuer Tab', icon: 'plus', keys: 'Strg+T', run: () => api.call('tab-new') },
  { id: 'new-window', label: 'Neues Fenster', icon: 'plus', keys: 'Strg+N', run: () => api.call('action', 'new-window') },
  { id: 'private', label: 'Neues privates Fenster', icon: 'moon', keys: 'Strg+⇧+N', hint: 'inkognito', run: () => api.call('action', 'private-window') },
  { id: 'reopen', label: 'Geschlossenen Tab wiederherstellen', icon: 'history', keys: 'Strg+⇧+T', run: () => api.call('action', 'reopen-tab') },
  { id: 'easy', label: 'Design – Theme & Effekte', icon: 'sliders', keys: 'Strg+⇧+E', hint: 'design farbe hintergrund animation', run: () => showEasySetup() },
  { id: 'snapshot', label: 'Snapshot aufnehmen', icon: 'camera', keys: 'Strg+⇧+S', hint: 'screenshot', run: () => openSnapshot() },
  { id: 'control', label: 'Control: RAM / CPU / Netzwerk', icon: 'gauge', hint: 'limiter leistung', run: () => openPanel('control') },
  { id: 'cleaner', label: 'Cleaner: Cache, Cookies & Downloads säubern', icon: 'trash', hint: 'aufräumen löschen speicher', run: () => openPanel('control') },
  { id: 'focus', label: 'Fokus-Modus', icon: 'timer', hint: 'ablenkung blockieren pomodoro', run: () => openPanel('focus') },
  { id: 'notes', label: 'Notizen', icon: 'note', hint: 'notiz seite', run: () => openPanel('notes') },
  { id: 'split-close', label: 'Split Screen beenden', icon: 'split', hint: 'geteilt nebeneinander', run: () => api.call('split-close') },
  { id: 'history', label: 'Verlauf', icon: 'history', keys: 'Strg+H', run: () => openPanel('history') },
  { id: 'downloads', label: 'Downloads', icon: 'download', keys: 'Strg+J', run: () => openPanel('downloads') },
  { id: 'bookmarks', label: 'Lesezeichen', icon: 'bookmark', run: () => openPanel('bookmarks') },
  { id: 'passwords', label: 'Passwörter & Autofill', icon: 'key', hint: 'login adressen', run: () => api.call('settings-open', 'passwords') },
  { id: 'extensions', label: 'Erweiterungen', icon: 'puzzle', hint: 'addons extensions', run: () => openPanel('extensions') },
  { id: 'settings', label: 'Einstellungen', icon: 'settings', keys: 'Alt+P', run: () => api.call('settings-open') },
  { id: 'privacy', label: 'Datenschutz & Sicherheit', icon: 'shield', hint: 'cookies tracking https', run: () => api.call('settings-open', 'privacy') },
  { id: 'search-engine', label: 'Suchmaschine ändern', icon: 'search', hint: 'google duckduckgo', run: () => api.call('settings-open', 'search') },
  { id: 'default-browser', label: 'Pulse als Standardbrowser', icon: 'globe', run: () => api.call('settings-open', 'system') },
  { id: 'import', label: 'Daten aus Opera GX importieren', icon: 'import', run: () => api.call('settings-open', 'import') },
  { id: 'bmbar', label: 'Lesezeichenleiste ein/aus', icon: 'bookmark', keys: 'Strg+⇧+B', run: () => ACTIONS['toggle-bookmarks-bar']() },
  { id: 'adblock', label: 'Werbeblocker ein/aus', icon: 'shield', run: () => api.call('settings-set', { adblock: !state.settings.adblock }) },
  { id: 'find', label: 'Auf Seite suchen', icon: 'search', keys: 'Strg+F', run: () => openFind() },
  { id: 'fullscreen', label: 'Vollbild', icon: 'expand', keys: 'F11', run: () => api.call('action', 'fullscreen') },
  { id: 'devtools', label: 'Entwicklertools', icon: 'code', keys: 'F12', run: () => api.call('action', 'devtools') },
  { id: 'cache', label: 'Cache leeren', icon: 'trash', run: async () => { await api.call('clear-data', ['cache']); toast('Cache geleert') } },
]

const showPalette = () => openPalette({ commands: COMMANDS })
function showEasySetup() {
  return openEasySetup({
    getSettings: () => state.settings,
    onSettings: (cb) => { settingsListeners.add(cb); return () => settingsListeners.delete(cb) },
    openSettings: () => api.call('settings-open', 'appearance'),
  })
}

$('#tt-palette').append(icon('search'))
$('#tt-snapshot').append(icon('camera'))
$('#tt-easy').append(icon('sliders'))
$('#tt-palette').onclick = showPalette
$('#tt-snapshot').onclick = () => openSnapshot()
$('#tt-easy').onclick = showEasySetup

// ---------------------------------------------------------------- toolbar wiring
const fill = (id, name) => $(id).append(icon(name))
fill('#btn-back', 'back'); fill('#btn-forward', 'forward'); fill('#btn-home', 'home')
fill('#btn-note', 'note'); fill('#btn-split', 'split')
fill('#btn-bookmark', 'star'); fill('#btn-downloads', 'download'); fill('#btn-menu', 'menu'); fill('#new-tab', 'plus')
for (const btn of document.querySelectorAll('.side-btn[data-panel]')) {
  const icons = { control: 'gauge', focus: 'timer', bookmarks: 'bookmark', history: 'history', downloads: 'download', notes: 'note', extensions: 'puzzle' }
  btn.append(icon(icons[btn.dataset.panel], 20))
  btn.addEventListener('click', () => togglePanel(btn.dataset.panel))
}
$('#side-add').append(icon('plus', 18))
$('#side-add').onclick = () => api.call('settings-open', 'sidebar')
$('#side-settings').append(icon('settings', 20))
$('#side-settings').onclick = () => api.call('settings-open')
$('#btn-note').onclick = () => togglePanel('notes')
$('#btn-split').onclick = () => api.call('split-close')
$('#focus-badge').onclick = () => openPanel('focus')

$('#btn-back').onclick = () => api.call('action', 'back')
$('#btn-forward').onclick = () => api.call('action', 'forward')
$('#btn-reload').onclick = () => api.call('action', activeTab() && activeTab().loading ? 'stop' : 'reload')
$('#btn-home').onclick = () => api.call('action', 'home')
$('#btn-menu').onclick = () => api.call('main-menu')
$('#logo').onclick = () => api.call('main-menu')
$('#new-tab').onclick = () => { playSound('tap'); api.call('tab-new') }
$('#btn-downloads').onclick = () => togglePanel('downloads')
$('#btn-bookmark').onclick = async () => {
  const added = await api.call('bookmark-toggle')
  if (added !== null) toast(added ? 'Lesezeichen hinzugefügt' : 'Lesezeichen entfernt')
}
$('#adblock-badge').onclick = () => openPanel('control')
$('#zoom-badge').onclick = () => api.call('action', 'zoom-reset')

// ---------------------------------------------------------------- focus mode badge
let focusTimer = null
function renderFocusBadge() {
  clearInterval(focusTimer)
  const badge = $('#focus-badge')
  const f = state.focus
  badge.hidden = !(f && f.active)
  if (badge.hidden) return
  const draw = () => {
    const left = Math.max(0, f.endsAt - Date.now())
    badge.replaceChildren(icon('timer', 14), h('span', {}, `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}`))
  }
  draw()
  focusTimer = setInterval(draw, 1000)
}
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
  palette: showPalette,
  snapshot: () => openSnapshot(),
  'easy-setup': showEasySetup,
  'toggle-bookmarks-bar': () => api.call('settings-set', { showBookmarksBar: !state.settings.showBookmarksBar }),
}
window.addEventListener('pulse-open-panel', (e) => openPanel(e.detail))
window.addEventListener('pulse-easy-setup', () => showEasySetup())

function onAction(action) {
  if (action.startsWith('panel:')) return openPanel(action.slice(6))
  if (ACTIONS[action]) ACTIONS[action]()
}

function onEscape() {
  if (overlayKind()) return closeOverlay()
  if (!$('#findbar').hidden) return closeFind()
  if (state.panel) openPanel(null)
}

// ---------------------------------------------------------------- theme
function applyTheme() {
  document.documentElement.style.setProperty('--accent', state.settings.accent)
  setMotion(state.settings.animations || 'full')
  configureSounds(state.settings)
  renderExtensionToggle()
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
  state.focus = init.settings.focus
  applyTheme()
  renderFocusBadge()
  refreshNoteKeys()
  renderTabs()
  renderSidebar()
  renderBookmarksBar()
  refreshExtensionCount()
  reportLayout()

  api.on('tabs', (snapshot) => {
    const switched = snapshot.activeId !== state.tabs.activeId
    if (switched && state.tabs.activeId) playSound('switch')
    state.tabs = snapshot
    renderTabs()
    // The frozen screenshot belongs to the old tab.
    if (switched && overlayKind()) closeOverlay()
    if (switched) refreshPanel('notes')
  })
  api.on('settings', (settings) => {
    state.settings = settings
    applyTheme(); renderSidebar(); renderBookmarksBar(); renderToolbar()
    refreshPanel('focus')
    for (const cb of settingsListeners) cb(settings)
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
  api.on('zoom', ({ percent, base }) => { const z = $('#zoom-badge'); z.hidden = percent === base; z.textContent = `${percent}%` })
  api.on('focus', (focus) => {
    state.focus = focus
    renderFocusBadge()
    refreshPanel('focus')
    if (!focus.active && focus.finished) playSound('success')
  })
  api.on('notes', () => { refreshNoteKeys(); refreshPanel('notes') })
  api.on('action', onAction)
  api.on('escape', onEscape)
  api.on('fullscreen', (on) => { document.body.classList.toggle('fullscreen', on); requestAnimationFrame(reportLayout) })
  api.on('password-prompt', showPasswordPrompt)
  api.on('update', onUpdate)
  onUpdate(await api.call('update-state'))
}

boot().catch((err) => {
  $('#viewport-msg').textContent = `Fehler beim Start der Oberfläche: ${err.message}`
})
