import { h, icon, hostOf, toast } from './util.js'
import { siteIcon } from './site-icons.js'
import { state } from './app.js'
import { DATA_PANELS } from './panels-data.js'

const api = window.pulse

export const PANEL_TITLES = {
  control: 'Control',
  bookmarks: 'Lesezeichen',
  history: 'Verlauf',
  downloads: 'Downloads',
  passwords: 'Passwörter',
  extensions: 'Erweiterungen',
  settings: 'Einstellungen',
  import: 'Daten importieren',
}

const ACCENTS = ['#fa1e4e', '#ff6a00', '#ffd400', '#3ddc97', '#00e5ff', '#2f7bff', '#8b5cf6', '#ff3cac', '#ffffff']

const PANELS = { control: renderControl, settings: renderSettings, import: renderImport, ...DATA_PANELS }

/**
 * @param {string} name
 * @param {HTMLElement} root
 * @param {HTMLElement} tools
 * @param {{refresh?: boolean}} opts refresh = data update while the panel is open
 */
export function renderPanel(name, root, tools, opts = {}) {
  const render = PANELS[name]
  if (!render) return
  // Don't wipe inputs the user is typing into on background refreshes.
  if (opts.refresh && root.contains(document.activeElement) && document.activeElement.matches('input, select, textarea')) {
    if (render.live) render.live(root)
    return
  }
  if (opts.refresh && render.live) return render.live(root)
  render(root, tools)
}

// ---------------------------------------------------------------- Control (RAM/CPU/network limiter)
function renderControl(root) {
  root.replaceChildren(
    h('div', { id: 'ctl-ram' }),
    h('div', { id: 'ctl-cpu' }),
    h('div', { id: 'ctl-net' }),
    h('div', { class: 'section-title' }, 'Werbeblocker'),
    h('div', { class: 'card', id: 'ctl-adb' }),
    h('div', { class: 'section-title' }, 'Hot Tabs – größte Verbraucher'),
    h('div', { id: 'ctl-tabs' }),
  )
  renderControl.live(root)
}

renderControl.live = (root) => {
  const s = state.settings.limiter
  const sample = state.limiter || { totalMb: 0, totalCpu: 0, history: [], tabs: [], adsBlocked: 0 }
  const set = (patch) => api.call('settings-set', { limiter: patch })

  root.querySelector('#ctl-ram').replaceChildren(limiterCard({
    title: 'RAM-Limiter', value: sample.totalMb, unit: 'MB', limit: s.ram.limitMb, enabled: s.ram.enabled,
    history: sample.history.map((p) => p.ram), min: 512, max: 16384, step: 256,
    onToggle: (enabled) => set({ ram: { enabled } }),
    onLimit: (limitMb) => set({ ram: { limitMb } }),
    extra: h('label', { class: 'row', style: { marginTop: '8px' } },
      toggle(s.ram.hard, (hard) => set({ ram: { hard } })),
      h('span', { class: 'grow' }, 'Hartes Limit – Hintergrund-Tabs automatisch schlafen legen')),
  }))
  root.querySelector('#ctl-cpu').replaceChildren(limiterCard({
    title: 'CPU-Limiter', value: sample.totalCpu, unit: '%', limit: s.cpu.limitPercent, enabled: s.cpu.enabled,
    history: sample.history.map((p) => p.cpu), min: 5, max: 100, step: 5,
    onToggle: (enabled) => set({ cpu: { enabled } }),
    onLimit: (limitPercent) => set({ cpu: { limitPercent } }),
    extra: h('div', { class: 'muted', style: { marginTop: '6px', fontSize: '11px' } }, 'Drosselt Hintergrund-Tabs, sobald die CPU-Last über dem Limit liegt. 100 % = ein voller Kern.'),
  }))
  root.querySelector('#ctl-net').replaceChildren(limiterCard({
    title: 'Netzwerk-Limiter', value: null, unit: 'KB/s', limit: Math.round(s.network.limitKbps / 8), enabled: s.network.enabled,
    history: [], min: 16, max: 12800, step: 16,
    onToggle: (enabled) => set({ network: { enabled } }),
    onLimit: (kbs) => set({ network: { limitKbps: kbs * 8 } }),
    extra: h('div', { class: 'muted', style: { marginTop: '6px', fontSize: '11px' } }, 'Begrenzt Download und Upload aller Tabs – praktisch beim Zocken oder Streamen.'),
  }))

  root.querySelector('#ctl-adb').replaceChildren(
    h('div', { class: 'row' },
      h('div', { class: 'grow' }, h('div', { class: 'big-num' }, sample.adsBlocked.toLocaleString('de-DE'), h('small', {}, 'blockiert')), h('div', { class: 'muted' }, 'Werbung & Tracker in dieser Sitzung')),
      toggle(state.settings.adblock, (adblock) => api.call('settings-set', { adblock }))),
  )

  const tabs = sample.tabs.filter((t) => !t.discarded).slice(0, 12)
  root.querySelector('#ctl-tabs').replaceChildren(...(tabs.length ? tabs.map((t) => h('div', { class: 'list-item' },
    siteIcon(t.url, { size: 18, src: t.favicon }),
    h('div', { class: 'main clickable', onclick: () => api.call('limiter-tab', t.windowId, t.id, 'activate') },
      h('div', { class: 't' }, t.title), h('div', { class: 's' }, `${t.memoryMb} MB · ${t.cpu} % CPU${t.audible ? ' · spielt Audio' : ''}`)),
    h('div', { class: 'actions' },
      h('button', { class: 'icon-btn small', title: 'Schlafen legen', icon: 'moon', onclick: () => api.call('limiter-tab', t.windowId, t.id, 'discard') }),
      h('button', { class: 'icon-btn small', title: 'Schließen', icon: 'close', onclick: () => api.call('limiter-tab', t.windowId, t.id, 'close') })),
  )) : [h('div', { class: 'empty' }, 'Messe Ressourcen …')]))
}

function limiterCard({ title, value, unit, limit, enabled, history, min, max, step, onToggle, onLimit, extra }) {
  const over = value !== null && value > limit
  const slider = h('input', { type: 'range', min, max, step, value: limit })
  const label = h('span', { class: 'muted' }, `Limit: ${limit} ${unit}`)
  slider.addEventListener('input', () => { label.textContent = `Limit: ${slider.value} ${unit}` })
  slider.addEventListener('change', () => onLimit(Number(slider.value)))
  const canvas = history.length ? sparkline(history, limit, enabled) : null
  return h('div', { class: 'card' },
    h('div', { class: 'row' },
      h('div', { class: 'grow' }, h('div', { style: { fontWeight: 650 } }, title),
        value !== null && h('div', { class: 'big-num' }, value.toLocaleString('de-DE'), h('small', {}, unit))),
      toggle(enabled, onToggle)),
    value !== null && h('div', { class: `meter${over && enabled ? ' over' : ''}` }, h('div', { style: { width: `${Math.min(100, (value / limit) * 100)}%` } })),
    canvas,
    h('div', { style: { marginTop: '10px' } }, label, slider),
    extra)
}

function sparkline(values, limit, showLimit) {
  const canvas = h('canvas', { class: 'spark', width: 340, height: 46 })
  const ctx = canvas.getContext('2d')
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
  const max = Math.max(limit, ...values) * 1.1 || 1
  const x = (i) => (i / Math.max(1, values.length - 1)) * canvas.width
  const y = (v) => canvas.height - (v / max) * canvas.height
  ctx.beginPath()
  values.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))))
  ctx.strokeStyle = accent
  ctx.lineWidth = 2
  ctx.shadowColor = accent
  ctx.shadowBlur = 6
  ctx.stroke()
  ctx.lineTo(canvas.width, canvas.height)
  ctx.lineTo(0, canvas.height)
  ctx.closePath()
  ctx.globalAlpha = 0.12
  ctx.fillStyle = accent
  ctx.fill()
  if (showLimit) {
    ctx.globalAlpha = 0.6
    ctx.shadowBlur = 0
    ctx.setLineDash([4, 4])
    ctx.strokeStyle = '#ff4d6d'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, y(limit))
    ctx.lineTo(canvas.width, y(limit))
    ctx.stroke()
  }
  return canvas
}

export function toggle(checked, onChange) {
  const input = h('input', { type: 'checkbox', checked })
  input.addEventListener('change', () => onChange(input.checked))
  return h('label', { class: 'switch' }, input, h('span'))
}

// ---------------------------------------------------------------- Settings
function renderSettings(root) {
  const s = state.settings
  const set = (patch) => api.call('settings-set', patch)

  const accentInput = h('input', { type: 'color', value: s.accent, onchange: (e) => set({ accent: e.target.value }) })
  const engines = h('select', { class: 'field', onchange: (e) => set({ searchEngine: e.target.value }) },
    ...s.searchEngines.map((e) => h('option', { value: e, selected: e === s.searchEngine }, e[0].toUpperCase() + e.slice(1))))

  const appTitle = h('input', { class: 'field', placeholder: 'Name (z. B. Reddit)' })
  const appUrl = h('input', { class: 'field', placeholder: 'https://…', style: { marginTop: '6px' } })

  const wallpaperBtn = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: (e) => {
    const file = e.target.files[0]
    if (!file) return
    if (file.size > 6_000_000) return toast('Bild ist zu groß (max. 6 MB)')
    const reader = new FileReader()
    reader.onload = () => set({ wallpaper: reader.result })
    reader.readAsDataURL(file)
  } })

  root.replaceChildren(
    h('div', { class: 'section-title' }, 'Design'),
    h('div', { class: 'card' },
      h('button', { class: 'btn primary', style: { marginBottom: '14px' }, onclick: () => window.dispatchEvent(new CustomEvent('pulse-easy-setup')) }, icon('sliders'), 'Easy Setup: Themes, Effekte & Animationen'),
      h('div', { style: { marginBottom: '8px' } }, 'Akzentfarbe'),
      h('div', { class: 'swatches' },
        ...ACCENTS.map((c) => h('button', { class: `swatch${c === s.accent ? ' active' : ''}`, style: { background: c }, title: c, onclick: () => set({ accent: c }) })),
        h('label', { class: 'swatch', title: 'Eigene Farbe', style: { background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)', position: 'relative', overflow: 'hidden' } },
          h('span', { style: { position: 'absolute', opacity: 0 } }, accentInput))),
      h('div', { style: { margin: '14px 0 8px' } }, 'Hintergrund der Startseite'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', onclick: () => wallpaperBtn.click() }, icon('folder'), 'Bild wählen'),
        s.wallpaper && h('button', { class: 'btn', onclick: () => set({ wallpaper: '' }) }, 'Entfernen'),
        wallpaperBtn)),

    h('div', { class: 'section-title' }, 'Allgemein'),
    h('div', { class: 'card' },
      h('div', { style: { marginBottom: '6px' } }, 'Suchmaschine'), engines,
      settingRow('Sitzung beim Start wiederherstellen', s.restoreSession, (v) => set({ restoreSession: v })),
      settingRow('Lesezeichenleiste anzeigen (Strg+Umschalt+B)', s.showBookmarksBar, (v) => set({ showBookmarksBar: v })),
      settingRow('Werbe- und Trackerblocker', s.adblock, (v) => set({ adblock: v }))),

    h('div', { class: 'section-title' }, 'Seitenleiste'),
    h('div', { class: 'card' },
      ...s.sidebarApps.map((a) => h('div', { class: 'list-item' },
        siteIcon(a.url, { size: 18, label: a.title }),
        h('div', { class: 'main' }, h('div', { class: 't' }, a.title), h('div', { class: 's' }, hostOf(a.url))),
        h('div', { class: 'actions' }, h('button', { class: 'icon-btn small', icon: 'trash', title: 'Entfernen', onclick: () => api.call('sidebar-remove', a.id) })))),
      h('div', { style: { marginTop: '10px' } }, appTitle, appUrl),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', onclick: async () => {
        try {
          await api.call('sidebar-add', { title: appTitle.value, url: appUrl.value.includes('://') ? appUrl.value : `https://${appUrl.value}` })
          toast('Zur Seitenleiste hinzugefügt')
        } catch { toast('Ungültige Adresse') }
      } }, icon('plus'), 'Web-App hinzufügen'))),

    h('div', { class: 'section-title' }, 'Datenschutz'),
    h('div', { class: 'card' },
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', onclick: () => clearData(['cache'], 'Cache geleert') }, 'Cache leeren'),
        h('button', { class: 'btn', onclick: () => confirm('Alle Cookies und Website-Daten löschen? Du wirst überall abgemeldet.') && clearData(['cookies'], 'Cookies gelöscht') }, 'Cookies & Websitedaten'),
        h('button', { class: 'btn danger', onclick: () => confirm('Gesamten Verlauf löschen?') && clearData(['history'], 'Verlauf gelöscht') }, 'Verlauf löschen')),
      h('div', { id: 'perm-list', style: { marginTop: '10px' } })),

    h('div', { class: 'section-title' }, 'Über Pulse'),
    h('div', { class: 'card' }, updateInfo()),

    h('div', { class: 'section-title' }, 'Import'),
    h('div', { class: 'card' }, h('button', { class: 'btn primary', onclick: () => window.dispatchEvent(new CustomEvent('pulse-open-panel', { detail: 'import' })) }, icon('import'), 'Aus Opera GX / Chrome importieren')),
  )
  loadPermissions(root.querySelector('#perm-list'))
}

function updateInfo() {
  const u = state.update || { status: 'idle', version: '' }
  const text = {
    dev: 'Entwicklungsversion – automatische Updates nur in der installierten Pulse.exe',
    idle: 'Automatische Updates aktiv',
    checking: 'Suche nach Updates …',
    current: 'Du hast die neueste Version',
    downloading: `Lade Version ${u.next || ''} … ${u.percent || 0} %`,
    ready: `Version ${u.next} wird beim Beenden installiert`,
    error: `Update-Prüfung fehlgeschlagen: ${u.error || ''}`,
  }[u.status]
  return h('div', {},
    h('div', { style: { fontWeight: 650 } }, `Pulse ${u.version}`),
    h('div', { class: 'muted', style: { marginTop: '4px' } }, text),
    h('div', { class: 'btn-row' },
      u.status === 'ready'
        ? h('button', { class: 'btn primary', onclick: () => api.call('update-install') }, 'Jetzt neu starten')
        : h('button', { class: 'btn', disabled: u.status === 'dev' || u.status === 'checking' || u.status === 'downloading', onclick: () => api.call('update-check') }, 'Nach Updates suchen')))
}

async function loadPermissions(el) {
  const list = await api.call('permissions-list')
  if (!list.length) return
  el.replaceChildren(h('div', { style: { margin: '4px 0 6px' } }, 'Gespeicherte Berechtigungen'), ...list.map((p) => h('div', { class: 'list-item' },
    h('div', { class: 'main' }, h('div', { class: 't' }, hostOf(p.origin)), h('div', { class: 's' }, `${p.permission}: ${p.allowed ? 'erlaubt' : 'blockiert'}`)),
    h('div', { class: 'actions' }, h('button', { class: 'icon-btn small', icon: 'trash', title: 'Zurücksetzen', onclick: async () => { await api.call('permissions-reset', p.origin, p.permission); loadPermissions(el) } })))))
}

async function clearData(kinds, message) {
  await api.call('clear-data', kinds)
  toast(message)
}

function settingRow(label, checked, onChange) {
  return h('label', { class: 'row', style: { marginTop: '12px' } }, h('span', { class: 'grow' }, label), toggle(checked, onChange))
}

// ---------------------------------------------------------------- Import
async function renderImport(root) {
  root.replaceChildren(h('div', { class: 'empty' }, 'Suche installierte Browser …'))
  const sources = await api.call('import-sources')
  if (!sources.length) return root.replaceChildren(h('div', { class: 'empty' }, 'Kein Opera-, Chrome-, Edge- oder Brave-Profil gefunden.'))

  const select = h('select', { class: 'field' }, ...sources.map((s) => h('option', { value: s.name }, s.name)))
  const checks = { bookmarks: true, history: true, extensions: true }
  const result = h('div', { style: { marginTop: '12px' } })
  const run = h('button', { class: 'btn primary', onclick: async () => {
    run.disabled = true
    result.replaceChildren(h('div', { class: 'muted' }, 'Importiere …'))
    try {
      const r = await api.call('import-run', select.value, checks)
      result.replaceChildren(
        r.bookmarks !== undefined && h('div', {}, `✔ ${r.bookmarks} Lesezeichen importiert`),
        r.history !== undefined && h('div', {}, `✔ ${r.history} Verlaufseinträge importiert`),
        r.historyError && h('div', { style: { color: 'var(--danger)' } }, r.historyError),
        r.extensions && h('div', {}, `✔ ${r.extensions.length} Erweiterungen geladen${r.extensions.length ? `: ${r.extensions.join(', ')}` : ''}`),
      )
    } catch (err) {
      result.replaceChildren(h('div', { style: { color: 'var(--danger)' } }, `Import fehlgeschlagen: ${err.message}`))
    } finally {
      run.disabled = false
    }
  } }, icon('import'), 'Jetzt importieren')

  root.replaceChildren(
    h('div', { class: 'card' },
      h('div', { style: { marginBottom: '6px' } }, 'Quelle'), select,
      ...Object.entries({ bookmarks: 'Lesezeichen', history: 'Verlauf', extensions: 'Erweiterungen' }).map(([key, label]) =>
        h('label', { class: 'row', style: { marginTop: '12px' } }, h('span', { class: 'grow' }, label), toggle(true, (v) => { checks[key] = v }))),
      h('div', { class: 'btn-row', style: { marginTop: '14px' } }, run),
      result),
    h('div', { class: 'section-title' }, 'Passwörter übernehmen'),
    h('div', { class: 'card' },
      h('ol', { style: { margin: 0, paddingLeft: '18px', lineHeight: 1.7 } },
        h('li', {}, 'In Opera GX opera://password-manager/settings öffnen'),
        h('li', {}, '„Passwörter exportieren“ klicken und die CSV speichern'),
        h('li', {}, 'Hier im Passwort-Panel „CSV importieren“ wählen'),
        h('li', {}, 'Die CSV-Datei danach löschen – sie ist unverschlüsselt')),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: () => window.dispatchEvent(new CustomEvent('pulse-open-panel', { detail: 'passwords' })) }, icon('key'), 'Zum Passwort-Panel'))),
  )
}
