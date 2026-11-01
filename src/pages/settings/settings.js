// Pulse settings page (pulse://settings). Every option of the browser lives
// here, grouped like in Opera; quick design changes stay in the "Design"
// drawer of the browser window.

const api = window.pulseSettings
const $ = (sel) => document.querySelector(sel)

let S = null // public settings
let meta = { isPrivate: false, version: '', update: { status: 'idle' }, platform: '' }

const SECTIONS = [
  ['start', 'Start & Startseite'],
  ['search', 'Suchmaschine'],
  ['appearance', 'Darstellung'],
  ['sound', 'Sound & Musik'],
  ['privacy', 'Datenschutz & Sicherheit'],
  ['passwords', 'Passwörter & Autofill'],
  ['downloads', 'Downloads'],
  ['tabs', 'Tabs'],
  ['sidebar', 'Seitenleiste'],
  ['focus', 'Fokus-Modus'],
  ['system', 'System & Standardbrowser'],
  ['import', 'Daten importieren'],
]

// ---------------------------------------------------------------- helpers
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag)
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue
    if (key === 'class') el.className = value
    else if (key.startsWith('on')) el.addEventListener(key.slice(2).toLowerCase(), value)
    else if (key in el) el[key] = value
    else el.setAttribute(key, value === true ? '' : value)
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue
    el.append(child instanceof Node ? child : document.createTextNode(String(child)))
  }
  return el
}

const set = (patch) => api.call('set', patch)

// Lists that can change outside this page are refreshed when the tab is shown again.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !S) return
  cache.delete('perms')
  render()
})

// Parts that load data (password list, address book, permissions, import
// sources …) are built once and reused, so a settings change doesn't reload
// them or reset what the user has open (revealed passwords, forms in edit).
const cache = new Map()
const once = (key, create) => {
  if (!cache.has(key)) cache.set(key, create())
  return cache.get(key)
}
const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url } }

let toastTimer = null
function toast(text) {
  const el = $('#toast')
  el.textContent = text
  el.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400)
}

function switchEl(checked, onChange, label) {
  const input = h('input', { type: 'checkbox', checked, 'aria-label': label })
  input.addEventListener('change', () => onChange(input.checked))
  return h('label', { class: 'switch' }, input, h('span'))
}

function row(label, desc, control) {
  return h('div', { class: 'row', 'data-search': `${label} ${desc || ''}`.toLowerCase() },
    h('div', { class: 'label' }, h('div', {}, label), desc && h('div', { class: 'desc' }, desc)), control)
}

const toggleRow = (label, desc, key) => row(label, desc, switchEl(Boolean(S[key]), (v) => set({ [key]: v }), label))

function selectRow(label, desc, value, options, onChange) {
  const select = h('select', { class: 'field', 'aria-label': label, onchange: (e) => onChange(e.target.value) },
    ...options.map(([v, text]) => h('option', { value: String(v), selected: String(v) === String(value) }, text)))
  return row(label, desc, select)
}

function rangeRow(label, desc, value, min, max, step, onChange, unit = '%') {
  const out = h('span', { class: 'range-val' }, `${value}${unit}`)
  const input = h('input', { type: 'range', min, max, step, value, 'aria-label': label })
  input.addEventListener('input', () => { out.textContent = `${input.value}${unit}` })
  input.addEventListener('change', () => onChange(Number(input.value)))
  return row(label, desc, h('div', { class: 'btns', style: 'align-items:center' }, input, out))
}

const card = (title, ...rows) => h('div', { class: 'card' }, title && h('h3', {}, title), ...rows)
const section = (id, ...cards) => h('section', { class: 'group', id }, h('h2', {}, SECTIONS.find((s) => s[0] === id)[1]), ...cards)

/** Text field that saves on change (Enter / blur). */
function textRow(label, desc, value, placeholder, onSave) {
  const input = h('input', { class: 'field', value: value || '', placeholder, 'aria-label': label })
  input.addEventListener('change', () => onSave(input.value.trim(), input))
  return row(label, desc, input)
}

// ---------------------------------------------------------------- sections
function startSection() {
  const pages = h('textarea', { class: 'field', placeholder: 'https://example.com\nhttps://…', value: S.startupPages.join('\n') })
  pages.addEventListener('change', () => {
    const urls = pages.value.split(/\s+/).filter(Boolean).map((u) => (u.includes('://') ? u : `https://${u}`))
    set({ startupPages: urls })
    toast('Startseiten gespeichert')
  })
  return section('start',
    card('Beim Start von Pulse',
      selectRow('Beim Start', 'Was Pulse nach dem Öffnen anzeigt', S.startup, [
        ['restore', 'Letzte Sitzung wiederherstellen'], ['newtab', 'Startseite öffnen'], ['pages', 'Bestimmte Seiten öffnen'],
      ], (startup) => set({ startup })),
      S.startup === 'pages' && h('div', { class: 'row stack', 'data-search': 'bestimmte seiten startseiten' }, h('div', {}, 'Seiten (eine Adresse pro Zeile)'), pages)),
    card('Startseite',
      textRow('Startseite / Home-Button', 'Leer lassen für die Pulse-Startseite mit Speed Dial', S.homepage, 'https://…', (v, input) => {
        const url = !v ? '' : v.includes('://') ? v : `https://${v}`
        set({ homepage: url })
        input.value = url
        toast(url ? 'Startseite gespeichert' : 'Pulse-Startseite aktiv')
      }),
      toggleRow('Home-Button in der Symbolleiste', '', 'showHomeButton'),
      toggleRow('„Oft besucht“-Vorschläge', 'Seiten, die du häufig und kürzlich besucht hast, unter dem Speed Dial', 'newtabSuggestions'),
      S.hiddenSuggestions.length > 0 && row('Ausgeblendete Vorschläge', `${S.hiddenSuggestions.length} Seiten ausgeblendet`,
        h('button', { class: 'btn small', onclick: () => set({ hiddenSuggestions: [] }) }, 'Wieder anzeigen')),
      toggleRow('Uhr & Datum anzeigen', '', 'newtabClock')))
}

function searchSection() {
  const options = [...S.searchEngines.map((e) => [e.id, e.name]), ['custom', 'Eigene Suchmaschine …']]
  return section('search',
    card('',
      selectRow('Suchmaschine', 'Wird für die Adressleiste und die Startseite verwendet', S.searchEngine, options, (searchEngine) => set({ searchEngine })),
      S.searchEngine === 'custom' && textRow('Name', '', S.customSearch.name, 'z. B. Kagi', (name) => set({ customSearch: { ...S.customSearch, name } })),
      S.searchEngine === 'custom' && textRow('Such-Adresse', '%s steht für den Suchbegriff', S.customSearch.url, 'https://suche.example/?q=%s', (url) => {
        if (url && !url.includes('%s')) return toast('Die Adresse muss %s enthalten')
        set({ customSearch: { ...S.customSearch, url } })
        toast('Suchmaschine gespeichert')
      })))
}

function appearanceSection() {
  return section('appearance',
    card('Design',
      row('Themes, Akzentfarbe, Hintergrund & Animationen', 'Mit Live-Vorschau im Design-Fenster (oben rechts, Strg+Umschalt+E)',
        h('button', { class: 'btn primary', onclick: () => api.call('easy-setup') }, 'Design öffnen'))),
    card('Oberfläche',
      toggleRow('Lesezeichenleiste anzeigen', 'Strg+Umschalt+B · erscheint nur, wenn es Lesezeichen gibt', 'showBookmarksBar'),
      toggleRow('Seitenleiste anzeigen', 'Control, Web-Apps, Verlauf, Downloads …', 'showSidebar'),
      toggleRow('Erweiterungen in der Symbolleiste einklappen', '', 'extensionsCollapsed'),
      selectRow('Standard-Zoom', 'Gilt für alle Seiten, die du nicht selbst gezoomt hast', S.defaultZoom,
        [50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200].map((z) => [z, `${z} %`]), (v) => set({ defaultZoom: Number(v) }))))
}

function soundSection() {
  return section('sound',
    card('Oberflächen-Sounds',
      toggleRow('Klick-Sounds', 'Dezente Töne beim Tab-Wechsel, Öffnen von Panels usw.', 'uiSounds'),
      S.uiSounds && rangeRow('Lautstärke', '', S.uiSoundVolume, 0, 100, 5, (uiSoundVolume) => set({ uiSoundVolume }))),
    card('Hintergrundmusik',
      toggleRow('Ambient-Musik', 'Ruhige, generierte Klangfläche. Pausiert automatisch, wenn ein Tab Audio abspielt.', 'ambientMusic'),
      S.ambientMusic && rangeRow('Lautstärke', '', S.ambientVolume, 0, 100, 5, (ambientVolume) => set({ ambientVolume }))))
}

function privacySection() {
  const perms = once('perms', () => {
    const el = h('div', { class: 'list' }, h('div', { class: 'empty' }, 'Lade …'))
    loadPermissions(el)
    return el
  })
  const exit = S.clearOnExit
  const exitToggle = (key, label) => row(label, '', switchEl(Boolean(exit[key]), (v) => set({ clearOnExit: { ...exit, [key]: v } }), label))
  return section('privacy',
    card('Schutz',
      toggleRow('Werbe- und Trackerblocker', 'EasyList & EasyPrivacy', 'adblock'),
      toggleRow('„Do Not Track“ und Global Privacy Control senden', 'Bittet Websites, dich nicht zu verfolgen', 'doNotTrack'),
      toggleRow('Nur HTTPS', 'Lädt Seiten verschlüsselt; wenn eine Seite kein HTTPS kann, wird einmalig auf HTTP zurückgefallen', 'httpsOnly'),
      S.httpsOnly && row('HTTP-Ausnahmen dieser Sitzung', '', h('button', { class: 'btn small', onclick: async () => { await api.call('https-exceptions-clear'); toast('Ausnahmen zurückgesetzt') } }, 'Zurücksetzen'))),
    card('Browserdaten löschen',
      row('Cache, Cookies, Verlauf & Downloads säubern', 'Der Cleaner sitzt im Control-Panel neben den Limitern – dort siehst du auch, wie viel frei wird',
        h('button', { class: 'btn primary', onclick: () => api.call('open-panel', 'control') }, 'Cleaner öffnen'))),
    card('Beim Beenden automatisch löschen',
      exitToggle('cache', 'Cache'), exitToggle('cookies', 'Cookies & Websitedaten'), exitToggle('history', 'Verlauf'), exitToggle('downloads', 'Download-Liste')),
    card('Website-Berechtigungen', perms))
}

async function loadPermissions(el) {
  const list = await api.call('perm-list')
  el.replaceChildren(...(list.length ? list.map((p) => h('div', { class: 'item' },
    h('div', { class: 'main' }, h('div', { class: 't' }, hostOf(p.origin)), h('div', { class: 's' }, `${p.permission}: ${p.allowed ? 'erlaubt' : 'blockiert'}`)),
    h('button', { class: 'btn small', onclick: async () => { await api.call('perm-reset', p.origin, p.permission); loadPermissions(el) } }, 'Zurücksetzen')))
    : [h('div', { class: 'empty' }, 'Noch keine gespeicherten Berechtigungen. Pulse fragt, wenn eine Seite z. B. Kamera oder Standort möchte.')]))
}

function passwordsSection() {
  const { list, search, url, user, pw } = once('passwords', () => {
    const parts = {
      list: h('div', { class: 'list' }),
      search: h('input', { class: 'field', type: 'search', placeholder: 'Passwörter durchsuchen', style: 'width:100%' }),
      url: h('input', { class: 'field', placeholder: 'Website (https://…)' }),
      user: h('input', { class: 'field', placeholder: 'Benutzername / E-Mail' }),
      pw: h('input', { class: 'field', type: 'password', placeholder: 'Passwort', autocomplete: 'new-password' }),
    }
    parts.search.addEventListener('input', () => drawPasswords(parts.list, parts.search.value))
    drawPasswords(parts.list, '')
    return parts
  })
  const addresses = once('addresses', () => {
    const el = h('div', { class: 'list' })
    drawAddresses(el)
    return el
  })
  return section('passwords',
    card('Passwörter',
      toggleRow('Speichern von Passwörtern anbieten', 'Nach dem Login fragt Pulse, ob es das Passwort speichern soll', 'savePasswords'),
      toggleRow('Passwörter automatisch ausfüllen', 'Erst wenn du in ein Login-Feld klickst – Seiten können sie nicht heimlich auslesen', 'autofillPasswords'),
      h('div', { class: 'row stack', 'data-search': 'passwörter liste gespeichert' }, search, list),
      h('div', { class: 'row stack', 'data-search': 'passwort hinzufügen manuell' },
        h('div', {}, 'Passwort manuell hinzufügen'),
        h('div', { class: 'grid2' }, url, user, pw,
          h('button', { class: 'btn primary', onclick: async () => {
            try {
              await api.call('pw-add', { url: url.value.includes('://') ? url.value : `https://${url.value}`, username: user.value, password: pw.value })
              url.value = ''; user.value = ''; pw.value = ''
              toast('Gespeichert')
              drawPasswords(list, search.value)
            } catch { toast('Bitte gültige Website und Passwort angeben') }
          } }, 'Speichern'))),
      row('Import & Export', 'CSV im Opera-/Chrome-Format', h('div', { class: 'btns' },
        h('button', { class: 'btn', onclick: async () => {
          const r = await api.call('pw-import-csv')
          if (r) { toast(`${r.added} Passwörter importiert${r.skipped ? `, ${r.skipped} übersprungen` : ''}`); drawPasswords(list, search.value) }
        } }, 'CSV importieren'),
        h('button', { class: 'btn', onclick: async () => {
          if (!confirm('Passwörter werden UNVERSCHLÜSSELT als CSV gespeichert. Fortfahren?')) return
          if (await api.call('pw-export-csv')) toast('Exportiert – lösche die Datei nach Gebrauch')
        } }, 'Exportieren')))),
    card('Adressen & Kontaktdaten',
      toggleRow('Adressen automatisch ausfüllen', 'Füllt Formulare (Name, E-Mail, Adresse …) aus, wenn du in ein passendes Feld klickst', 'autofillAddresses'),
      h('div', { class: 'row stack', 'data-search': 'adresse profil name email telefon' }, addresses)))
}

async function drawPasswords(list, query) {
  const q = query.trim().toLowerCase()
  const items = (await api.call('pw-list')).filter((p) => !q || p.origin.includes(q) || p.username.toLowerCase().includes(q))
    .sort((a, b) => hostOf(a.origin).localeCompare(hostOf(b.origin)))
  list.replaceChildren(...(items.length ? items.map((p) => {
    const value = h('div', { class: 's mono' }, '••••••••••')
    let shown = false
    return h('div', { class: 'item' },
      h('div', { class: 'main' }, h('div', { class: 't' }, `${hostOf(p.origin)} · ${p.username || '(ohne Benutzername)'}`), value),
      h('div', { class: 'btns' },
        h('button', { class: 'btn small', onclick: async (e) => {
          shown = !shown
          value.textContent = shown ? await api.call('pw-reveal', p.id) : '••••••••••'
          e.target.textContent = shown ? 'Verbergen' : 'Anzeigen'
        } }, 'Anzeigen'),
        h('button', { class: 'btn small', onclick: async () => { await api.call('pw-copy', p.id); toast('Passwort kopiert') } }, 'Kopieren'),
        h('button', { class: 'btn small danger', onclick: async () => {
          if (!confirm(`Passwort für ${hostOf(p.origin)} löschen?`)) return
          await api.call('pw-delete', p.id)
          drawPasswords(list, query)
        } }, 'Löschen')))
  }) : [h('div', { class: 'empty' }, q ? 'Keine Treffer' : 'Noch keine Passwörter gespeichert. Importiere deine Opera-GX-Passwörter als CSV (siehe „Daten importieren“).')]))
}

const ADDRESS_FIELDS = [['name', 'Name'], ['email', 'E-Mail'], ['phone', 'Telefon'], ['company', 'Firma'], ['street', 'Straße & Hausnummer'], ['zip', 'PLZ'], ['city', 'Ort'], ['country', 'Land']]

async function drawAddresses(el, editing = null) {
  const list = await api.call('addr-list')
  const form = (profile) => {
    const inputs = Object.fromEntries(ADDRESS_FIELDS.map(([key, label]) => [key, h('input', { class: 'field', placeholder: label, value: profile[key] || '' })]))
    return h('div', { class: 'item', style: 'flex-direction:column;align-items:stretch' },
      h('div', { class: 'grid2' }, ...Object.values(inputs)),
      h('div', { class: 'btns' },
        h('button', { class: 'btn primary', onclick: async () => {
          try {
            await api.call('addr-save', { id: profile.id, ...Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value])) })
            toast('Adresse gespeichert')
            drawAddresses(el)
          } catch { toast('Bitte mindestens ein Feld ausfüllen') }
        } }, 'Speichern'),
        h('button', { class: 'btn', onclick: () => drawAddresses(el) }, 'Abbrechen')))
  }
  el.replaceChildren(
    ...list.map((p) => (editing === p.id ? form(p) : h('div', { class: 'item' },
      h('div', { class: 'main' }, h('div', { class: 't' }, p.name || p.email || 'Adresse'), h('div', { class: 's' }, [p.street, [p.zip, p.city].filter(Boolean).join(' '), p.email].filter(Boolean).join(' · '))),
      h('div', { class: 'btns' },
        h('button', { class: 'btn small', onclick: () => drawAddresses(el, p.id) }, 'Bearbeiten'),
        h('button', { class: 'btn small danger', onclick: async () => { await api.call('addr-remove', p.id); drawAddresses(el) } }, 'Löschen'))))),
    editing === 'new' ? form({}) : h('div', { class: 'btns', style: 'padding:8px 0' },
      list.length === 0 && h('span', { class: 'desc', style: 'flex:1' }, 'Noch keine Adresse gespeichert.'),
      h('button', { class: 'btn', onclick: () => drawAddresses(el, 'new') }, '+ Adresse hinzufügen')),
  )
}

function downloadsSection() {
  const dir = h('span', { class: 'desc' }, S.downloadDir || '…')
  if (!S.downloadDir) api.call('download-dir-default').then((d) => { dir.textContent = `${d} (Standard)` })
  return section('downloads',
    card('',
      row('Speicherort', '', h('div', { class: 'btns' },
        h('button', { class: 'btn', onclick: async () => { const d = await api.call('choose-download-dir'); if (d) toast('Ordner gespeichert') } }, 'Ändern'),
        S.downloadDir && h('button', { class: 'btn', onclick: () => set({ downloadDir: '' }) }, 'Standard'))),
      h('div', { class: 'row', 'data-search': 'ordner pfad' }, dir),
      toggleRow('Vor jedem Download fragen, wo gespeichert werden soll', '', 'askDownloadLocation')))
}

function tabsSection() {
  return section('tabs',
    card('',
      selectRow('Neue Tabs öffnen', '', S.newTabPosition, [['afterActive', 'Neben dem aktuellen Tab'], ['end', 'Am Ende der Tab-Leiste']], (newTabPosition) => set({ newTabPosition })),
      selectRow('Inaktive Tabs schlafen legen', 'Spart RAM; angeheftete und Audio-Tabs bleiben wach', S.autoSleepMinutes,
        [[0, 'Nie'], [15, 'Nach 15 Minuten'], [30, 'Nach 30 Minuten'], [60, 'Nach 1 Stunde'], [120, 'Nach 2 Stunden']], (v) => set({ autoSleepMinutes: Number(v) })),
      row('Split Screen', 'Rechtsklick auf einen Tab → „Neben aktivem Tab anzeigen“', h('span', { class: 'badge' }, 'Tipp')),
      row('Lautstärke pro Tab', 'Rechtsklick auf einen Tab → „Lautstärke“', h('span', { class: 'badge' }, 'Tipp'))))
}

function sidebarSection() {
  const title = h('input', { class: 'field', placeholder: 'Name (z. B. Reddit)' })
  const url = h('input', { class: 'field', placeholder: 'https://…' })
  return section('sidebar',
    card('Web-Apps',
      ...S.sidebarApps.map((a) => h('div', { class: 'item' },
        h('div', { class: 'main' }, h('div', { class: 't' }, a.title), h('div', { class: 's' }, hostOf(a.url))),
        h('button', { class: 'btn small danger', onclick: () => api.call('sidebar-remove', a.id) }, 'Entfernen'))),
      h('div', { class: 'row stack', 'data-search': 'web-app hinzufügen' }, h('div', { class: 'grid2' }, title, url,
        h('button', { class: 'btn primary', onclick: async () => {
          try {
            await api.call('sidebar-add', { title: title.value, url: url.value.includes('://') ? url.value : `https://${url.value}` })
            toast('Zur Seitenleiste hinzugefügt')
          } catch { toast('Ungültige Adresse') }
        } }, '+ Web-App hinzufügen')))))
}

function focusSection() {
  const list = h('textarea', { class: 'field', value: S.focusBlocklist.join('\n'), placeholder: 'youtube.com' })
  list.addEventListener('change', () => {
    set({ focusBlocklist: list.value.split(/[\s,]+/).filter(Boolean) })
    toast('Liste gespeichert')
  })
  return section('focus',
    card('',
      rangeRow('Standard-Dauer', 'Starten über das Fokus-Symbol in der Seitenleiste', S.focusMinutes, 5, 120, 5, (focusMinutes) => set({ focusMinutes }), ' min'),
      h('div', { class: 'row stack', 'data-search': 'blockiert ablenkung liste seiten' }, h('div', {}, 'Blockierte Seiten (eine Domain pro Zeile, Subdomains inklusive)'), list)))
}

function systemSection() {
  const { state, makeDefault } = once('default-browser', () => {
    const parts = { state: h('span', { class: 'badge' }, '…'), makeDefault: h('button', { class: 'btn primary' }, 'Als Standard festlegen') }
    const draw = (d) => {
      parts.state.className = `badge${d.isDefault ? ' ok' : ''}`
      parts.state.textContent = d.isDefault ? 'Pulse ist Standardbrowser' : 'Nicht Standard'
      parts.makeDefault.hidden = d.isDefault
    }
    parts.makeDefault.onclick = async () => draw(await api.call('default-browser-set'))
    api.call('default-browser').then(draw)
    // Changed outside Pulse (e.g. in the Windows settings): re-check when the tab is shown again.
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && api.call('default-browser').then(draw))
    return parts
  })
  const u = meta.update || { status: 'idle' }
  const updateText = {
    dev: 'Entwicklungsversion – automatische Updates nur in der installierten Pulse.exe',
    idle: 'Automatische Updates aktiv', checking: 'Suche nach Updates …', current: 'Du hast die neueste Version',
    downloading: `Lade Version ${u.next || ''} … ${u.percent || 0} %`, ready: `Version ${u.next} wird beim Beenden installiert`,
    error: `Update-Prüfung fehlgeschlagen: ${u.error || ''}`,
  }[u.status] || ''
  return section('system',
    card('Standardbrowser',
      row('Pulse als Standardbrowser verwenden', meta.platform === 'win32' ? 'Windows öffnet danach die Standard-Apps – dort Pulse als Webbrowser wählen' : '', h('div', { class: 'btns', style: 'align-items:center' }, state, makeDefault))),
    card('Leistung',
      row('Hardwarebeschleunigung', 'Nutzt die Grafikkarte. Ausschalten hilft bei Grafikfehlern. Wirkt nach Neustart.',
        h('div', { class: 'btns', style: 'align-items:center' },
          h('button', { class: 'btn small', onclick: () => api.call('relaunch') }, 'Neu starten'),
          switchEl(S.hardwareAcceleration, (v) => set({ hardwareAcceleration: v }), 'Hardwarebeschleunigung')))),
    card('Über Pulse',
      row(`Pulse ${meta.version}`, updateText, u.status === 'ready'
        ? h('button', { class: 'btn primary', onclick: () => api.call('update-install') }, 'Jetzt neu starten')
        : h('button', { class: 'btn', disabled: u.status === 'dev' || u.status === 'checking' || u.status === 'downloading', onclick: () => api.call('update-check') }, 'Nach Updates suchen')),
      row('Einstellungen zurücksetzen', 'Speed Dial und Web-Apps bleiben erhalten; Passwörter, Lesezeichen und Verlauf werden nicht angetastet',
        h('button', { class: 'btn danger', onclick: async () => { if (confirm('Alle Einstellungen auf Standard zurücksetzen?')) { cache.delete('perms'); cache.delete('import'); await api.call('reset'); toast('Zurückgesetzt') } } }, 'Zurücksetzen'))))
}

function importSection() {
  const body = once('import', () => {
    const el = h('div', { class: 'list' }, h('div', { class: 'empty' }, 'Suche installierte Browser …'))
    loadImport(el)
    return el
  })
  return section('import',
    card('Lesezeichen, Verlauf & Erweiterungen', body),
    card('Passwörter aus Opera GX übernehmen',
      h('ol', { style: 'margin:12px 0;padding-left:20px;line-height:1.8', 'data-search': 'passwörter opera export csv' },
        h('li', {}, 'In Opera GX opera://password-manager/settings öffnen'),
        h('li', {}, '„Passwörter exportieren“ klicken und die CSV speichern'),
        h('li', {}, 'Oben unter „Passwörter & Autofill“ → „CSV importieren“ wählen'),
        h('li', {}, 'Die CSV-Datei danach löschen – sie ist unverschlüsselt'))))
}

async function loadImport(el) {
  const sources = await api.call('import-sources')
  if (!sources.length) return el.replaceChildren(h('div', { class: 'empty' }, 'Kein Opera-, Chrome-, Edge- oder Brave-Profil gefunden.'))
  const what = { bookmarks: true, history: true, extensions: true }
  const result = h('div', { class: 'desc', style: 'padding:6px 0 12px' })
  const run = h('button', { class: 'btn primary', onclick: async () => {
    run.disabled = true
    result.textContent = 'Importiere …'
    try {
      const r = await api.call('import-run', source.value, what)
      result.textContent = [
        r.bookmarks !== undefined && `✔ ${r.bookmarks} Lesezeichen`,
        r.history !== undefined && `✔ ${r.history} Verlaufseinträge`,
        r.extensions && `✔ ${r.extensions.length} Erweiterungen`,
        r.historyError,
      ].filter(Boolean).join(' · ')
    } catch (err) {
      result.textContent = `Import fehlgeschlagen: ${err.message}`
    } finally {
      run.disabled = false
    }
  } }, 'Jetzt importieren')
  const source = h('select', { class: 'field' }, ...sources.map((s) => h('option', { value: s.name }, s.name)))
  el.replaceChildren(
    row('Quelle', 'Schließe den anderen Browser, falls der Verlauf nicht gelesen werden kann', source),
    ...Object.entries({ bookmarks: 'Lesezeichen', history: 'Verlauf', extensions: 'Erweiterungen' })
      .map(([key, label]) => row(label, '', switchEl(true, (v) => { what[key] = v }, label))),
    h('div', { class: 'row' }, h('div', { class: 'label' }, result), run))
}

// ---------------------------------------------------------------- render & navigation
const BUILDERS = [startSection, searchSection, appearanceSection, soundSection, privacySection, passwordsSection,
  downloadsSection, tabsSection, sidebarSection, focusSection, systemSection, importSection]

let renderPending = false

function render() {
  const content = $('#content')
  // Background updates must not wipe what the user is typing: render once they leave the field.
  const active = document.activeElement
  if (active && content.contains(active) && active.matches('input:not([type=checkbox]):not([type=range]), textarea, select')) {
    renderPending = true
    return
  }
  renderPending = false
  const scroll = content.scrollTop
  document.documentElement.style.setProperty('--accent', S.accent)
  content.replaceChildren(...BUILDERS.filter((b) => !(meta.isPrivate && b === importSection)).map((b) => b()))
  content.scrollTop = scroll
  applySearch()
}

function renderNav() {
  $('#nav-links').replaceChildren(...SECTIONS.map(([id, label]) => h('a', { href: `#${id}`, 'data-id': id, onclick: (e) => { e.preventDefault(); goTo(id) } }, label)))
}

function goTo(id) {
  const el = document.getElementById(id)
  if (!el) return
  $('#q').value = ''
  applySearch()
  el.scrollIntoView({ block: 'start' })
  history.replaceState(null, '', `#${id}`)
  markNav(id)
}

function markNav(id) {
  for (const a of document.querySelectorAll('#nav-links a')) a.classList.toggle('active', a.dataset.id === id)
}

$('#content').addEventListener('scroll', () => {
  const top = $('#content').getBoundingClientRect().top + 40
  let current = SECTIONS[0][0]
  for (const sec of document.querySelectorAll('section.group')) if (sec.getBoundingClientRect().top <= top) current = sec.id
  markNav(current)
}, { passive: true })

function applySearch() {
  const q = $('#q').value.trim().toLowerCase()
  for (const sec of document.querySelectorAll('section.group')) {
    const title = sec.querySelector('h2').textContent.toLowerCase()
    let any = false
    for (const r of sec.querySelectorAll('[data-search]')) {
      const hit = !q || title.includes(q) || r.dataset.search.includes(q)
      r.hidden = !hit
      any = any || hit
    }
    for (const c of sec.querySelectorAll('.card')) c.hidden = Boolean(q) && !title.includes(q) && !c.querySelector('[data-search]:not([hidden])')
    sec.hidden = Boolean(q) && !any
  }
}
$('#q').addEventListener('input', applySearch)
$('#content').addEventListener('focusout', () => setTimeout(() => renderPending && render(), 0))

async function init() {
  const data = await api.call('get')
  S = data.settings
  meta = data
  renderNav()
  render()
  const hash = location.hash.slice(1)
  if (hash) requestAnimationFrame(() => goTo(hash))
  else markNav(SECTIONS[0][0])
  api.on('settings:changed', (settings) => { S = settings; render() })
  api.on('settings:update', (update) => { meta = { ...meta, update }; render() })
  api.on('settings:section', (id) => goTo(id))
}

init()
