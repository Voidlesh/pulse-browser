import { h, icon, hostOf, toast, formatBytes } from './util.js'
import { siteIcon } from './site-icons.js'
import { state } from './app.js'
import { DATA_PANELS } from './panels-data.js'

const api = window.pulse

export const PANEL_TITLES = {
  control: 'Control',
  focus: 'Fokus-Modus',
  notes: 'Notizen',
  bookmarks: 'Lesezeichen',
  history: 'Verlauf',
  downloads: 'Downloads',
  extensions: 'Erweiterungen',
}

const PANELS = { control: renderControl, focus: renderFocus, notes: renderNotes, ...DATA_PANELS }

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
    h('div', { class: 'section-title' }, 'Cleaner'),
    cleanerCard(),
    h('div', { class: 'section-title' }, 'Hot Tabs – größte Verbraucher'),
    h('div', { id: 'ctl-tabs' }),
  )
  renderControl.live(root)
}

// ---------------------------------------------------------------- Cleaner (part of Control)
const CLEANER_ITEMS = [
  ['cache', 'Cache', (r) => formatBytes(r.cache.bytes)],
  ['cookies', 'Cookies & Websitedaten', (r) => `${r.cookies.count} Cookies`, 'Du wirst auf Websites abgemeldet.'],
  ['history', 'Verlauf', (r) => `${r.history.count} Einträge`],
  ['downloadList', 'Download-Liste', (r) => `${r.downloadList.count} Einträge`],
  ['downloadFiles', 'Heruntergeladene Dateien', (r) => `${r.downloadFiles.count} Dateien · ${formatBytes(r.downloadFiles.bytes)}`, 'Dateien wandern in den Papierkorb.'],
]

function cleanerCard() {
  const picked = { cache: true, cookies: false, history: false, downloadList: true, downloadFiles: false }
  const rows = h('div')
  const total = h('span', { class: 'muted' })
  const run = h('button', { class: 'btn primary' }, icon('trash'), 'Jetzt säubern')
  let scan = null

  const draw = () => {
    rows.replaceChildren(...CLEANER_ITEMS
      .filter(([key]) => !state.isPrivate || key === 'cache' || key === 'cookies')
      .map(([key, label, detail, warn]) => h('label', { class: 'row cleaner-row' },
        h('input', { type: 'checkbox', checked: picked[key], onchange: (e) => { picked[key] = e.target.checked; updateTotal() } }),
        h('span', { class: 'grow' }, label, warn && h('span', { class: 'cleaner-warn' }, warn)),
        h('span', { class: 'muted' }, scan ? detail(scan) : '…'))))
  }
  const updateTotal = () => {
    if (!scan) return
    const bytes = (picked.cache ? scan.cache.bytes : 0) + (picked.downloadFiles ? scan.downloadFiles.bytes : 0)
    total.textContent = `Freizugeben: ${formatBytes(bytes)}`
  }
  const rescan = async () => {
    try {
      scan = await api.call('cleaner-scan')
    } catch {
      scan = null
    }
    draw()
    updateTotal()
  }
  run.onclick = async () => {
    if (!Object.values(picked).some(Boolean)) return toast('Nichts ausgewählt')
    if (picked.downloadFiles && !confirm('Heruntergeladene Dateien in den Papierkorb verschieben?')) return
    run.disabled = true
    try {
      const r = await api.call('cleaner-clean', picked)
      toast(r.trashed ? `Gesäubert – ${r.trashed} Dateien im Papierkorb` : 'Gesäubert')
    } finally {
      run.disabled = false
      rescan()
    }
  }
  draw()
  rescan()
  return h('div', { class: 'card' }, rows, h('div', { class: 'row', style: { marginTop: '10px' } }, total, h('span', { class: 'grow' }), run))
}

// ---------------------------------------------------------------- Focus mode
const FOCUS_PRESETS = [15, 25, 45, 60, 90]

function renderFocus(root) {
  renderFocus.live(root)
}
renderFocus.live = (root) => {
  const f = state.focus || { active: false }
  const s = state.settings
  if (f.active) {
    const left = Math.max(0, f.endsAt - Date.now())
    const mins = Math.floor(left / 60000)
    const secs = Math.floor((left % 60000) / 1000)
    root.replaceChildren(h('div', { class: 'card focus-card' },
      h('div', { class: 'focus-time' }, `${mins}:${String(secs).padStart(2, '0')}`),
      h('div', { class: 'muted' }, `${f.blocklist.length} Seiten sind blockiert`),
      h('div', { class: 'meter' }, h('div', { style: { width: `${100 - (left / (f.minutes * 60000)) * 100}%` } })),
      h('div', { class: 'btn-row', style: { justifyContent: 'center', marginTop: '14px' } },
        h('button', { class: 'btn', onclick: () => api.call('focus-stop') }, 'Beenden'))))
    clearTimeout(renderFocus.timer)
    renderFocus.timer = setTimeout(() => state.panel === 'focus' && renderFocus.live(root), 1000)
    return
  }
  let minutes = s.focusMinutes
  const presets = h('div', { class: 'es-seg' })
  const drawPresets = () => presets.replaceChildren(...FOCUS_PRESETS.map((m) => h('button', {
    class: `es-chip${m === minutes ? ' active' : ''}`, onclick: () => { minutes = m; drawPresets() },
  }, `${m} min`)))
  drawPresets()
  root.replaceChildren(
    h('div', { class: 'card' },
      h('div', { style: { marginBottom: '10px' } }, 'Blockiert ablenkende Seiten für eine feste Zeit. Wer sie trotzdem öffnet, landet auf einer ruhigen Hinweisseite.'),
      presets,
      h('div', { class: 'btn-row', style: { marginTop: '14px' } },
        h('button', { class: 'btn primary', onclick: () => { api.call('focus-start', minutes); toast(`Fokus für ${minutes} Minuten`) } }, icon('timer'), 'Fokus starten'))),
    h('div', { class: 'section-title' }, 'Blockierte Seiten'),
    h('div', { class: 'card' },
      h('div', { class: 'chips' }, ...s.focusBlocklist.map((d) => h('span', { class: 'chip' }, d))),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: () => api.call('settings-open', 'focus') }, icon('settings'), 'Liste bearbeiten'))),
  )
}

// ---------------------------------------------------------------- Notes
async function renderNotes(root) {
  const current = await api.call('note-get')
  const all = await api.call('notes-list')
  const editor = current.available ? noteEditor(current) : h('div', { class: 'card muted' },
    state.isPrivate ? 'In privaten Fenstern werden keine Notizen gespeichert.' : 'Öffne eine Webseite, um dir Notizen dazu zu machen.')
  const others = all.filter((n) => !current.note || n.url !== current.note.url)
  root.replaceChildren(
    h('div', { class: 'section-title' }, 'Diese Seite'),
    editor,
    h('div', { class: 'section-title' }, `Alle Notizen (${all.length})`),
    ...(others.length ? others.map((n) => h('div', { class: 'list-item clickable', onclick: (e) => api.call('open', n.url, { newTab: e.ctrlKey }) },
      siteIcon(n.url, { size: 18 }),
      h('div', { class: 'main' }, h('div', { class: 't' }, n.title), h('div', { class: 's' }, n.text.split('\n')[0])))) : [h('div', { class: 'empty' }, 'Noch keine weiteren Notizen')]),
  )
}
renderNotes.live = (root) => { if (!root.contains(document.activeElement)) renderNotes(root) }

function noteEditor({ url, title, note }) {
  const area = h('textarea', { class: 'field note-area', placeholder: 'Notiz zu dieser Seite …', value: note ? note.text : '' })
  const status = h('span', { class: 'muted' }, note ? `Gespeichert ${new Date(note.updated).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}` : '')
  let timer = null
  area.addEventListener('input', () => {
    clearTimeout(timer)
    status.textContent = '…'
    timer = setTimeout(async () => {
      await api.call('note-set', url, title, area.value)
      status.textContent = area.value.trim() ? 'Gespeichert' : 'Gelöscht'
    }, 500)
  })
  return h('div', { class: 'card' }, h('div', { class: 't', style: { marginBottom: '8px', fontWeight: 600 } }, title || hostOf(url)), area, h('div', { class: 'row', style: { marginTop: '6px' } }, status))
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
