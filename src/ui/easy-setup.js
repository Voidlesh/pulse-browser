import { h, icon, toast } from './util.js'
import { openOverlay } from './overlay.js'
import { THEMES } from '/shared/themes.js'
import { EFFECTS, createBackground } from '/shared/effects.js'

// "Easy Setup" drawer (top right): themes, colors, wallpaper, background
// effect and animation level with a live, mouse-reactive preview.

const api = window.pulse
const ACCENTS = ['#fa1e4e', '#ff6a00', '#ffc83d', '#39ff88', '#00e5ff', '#2f7bff', '#9b5cff', '#ff7eb6', '#e8e6f0']
const MOTION = [['full', 'Voll'], ['reduced', 'Reduziert'], ['off', 'Aus']]
const MAX_WALLPAPER_BYTES = 6_000_000

/** @param {{ getSettings: () => object, onSettings: (cb: (s: object) => void) => () => void, openSettings: () => void }} deps */
export function openEasySetup({ getSettings, onSettings, openSettings }) {
  return openOverlay('easy-setup', (root, close) => {
    const set = (patch) => api.call('settings-set', patch)
    const canvas = h('canvas', { class: 'es-preview-canvas' })
    const previewLabel = h('div', { class: 'es-preview-label' })
    const preview = h('div', { class: 'es-preview' }, canvas, previewLabel)
    const body = h('div', { class: 'es-body' })
    const drawer = h('aside', { class: 'es' },
      h('div', { class: 'es-head' }, h('h2', {}, 'Easy Setup'), h('button', { class: 'icon-btn small', icon: 'close', title: 'Schließen', onclick: () => close() })),
      preview, body,
      h('div', { class: 'es-foot' }, h('button', { class: 'btn', onclick: async () => { await close(); openSettings() } }, icon('settings'), 'Alle Einstellungen')))
    root.append(drawer)

    let s = getSettings()
    const bg = createBackground(canvas, { type: s.bgEffect, accent: s.accent, motion: s.animations })

    const fileInput = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: (e) => {
      const file = e.target.files[0]
      e.target.value = ''
      if (!file) return
      if (file.size > MAX_WALLPAPER_BYTES) return toast('Bild ist zu groß (max. 6 MB)')
      const reader = new FileReader()
      reader.onload = () => { set({ wallpaper: reader.result }); toast('Hintergrundbild gesetzt') }
      reader.readAsDataURL(file)
    } })

    const choice = (active, label, onclick, extra = {}) =>
      h('button', { class: `es-chip${active ? ' active' : ''}`, onclick, ...extra }, label)

    const draw = () => {
      const scroll = body.scrollTop
      previewLabel.textContent = `Startseite · ${EFFECTS[s.bgEffect]?.label || ''}`
      preview.style.backgroundImage = s.wallpaper ? `url("${s.wallpaper.replace(/"/g, '%22')}")` : ''
      body.replaceChildren(
        h('div', { class: 'es-title' }, 'Themes'),
        h('div', { class: 'es-themes' }, ...THEMES.map((t, i) => h('button', {
          class: `es-theme${s.themePreset === t.id ? ' active' : ''}`,
          style: { '--c': t.accent, '--i': i },
          onclick: () => set({ themePreset: t.id, accent: t.accent, bgEffect: t.bgEffect }),
        }, h('span', { class: 'es-theme-swatch' }), h('span', {}, t.name)))),

        h('div', { class: 'es-title' }, 'Akzentfarbe'),
        h('div', { class: 'swatches' },
          ...ACCENTS.map((c) => h('button', { class: `swatch${c === s.accent ? ' active' : ''}`, style: { background: c }, title: c, onclick: () => set({ accent: c, themePreset: 'custom' }) })),
          h('label', { class: 'swatch custom', title: 'Eigene Farbe' },
            h('input', { type: 'color', value: s.accent, onchange: (e) => set({ accent: e.target.value, themePreset: 'custom' }) }))),

        h('div', { class: 'es-title' }, 'Hintergrund-Effekt'),
        h('div', { class: 'es-chips' }, ...Object.entries(EFFECTS).map(([id, e]) => choice(s.bgEffect === id, e.label, () => set({ bgEffect: id })))),
        h('div', { class: 'es-note' }, 'Die Effekte reagieren auf deine Maus.'),

        h('div', { class: 'es-title' }, 'Hintergrundbild'),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn', onclick: () => fileInput.click() }, icon('folder'), s.wallpaper ? 'Anderes Bild' : 'Bild wählen'),
          s.wallpaper && h('button', { class: 'btn', onclick: () => set({ wallpaper: '' }) }, 'Entfernen'),
          fileInput),

        h('div', { class: 'es-title' }, 'Animationen'),
        h('div', { class: 'es-seg' }, ...MOTION.map(([id, label]) => choice(s.animations === id, label, () => set({ animations: id })))),

        h('div', { class: 'es-title' }, 'Oberfläche'),
        row('Lesezeichenleiste', s.showBookmarksBar, (v) => set({ showBookmarksBar: v })),
        row('Erweiterungen einklappen', s.extensionsCollapsed, (v) => set({ extensionsCollapsed: v })),
        row('Werbeblocker', s.adblock, (v) => set({ adblock: v })),
      )
      body.scrollTop = scroll
    }

    draw()
    const off = onSettings((next) => {
      s = next
      bg.update({ type: s.bgEffect, accent: s.accent, motion: s.animations })
      draw()
    })
    return () => { off(); bg.destroy() }
  })
}

function row(label, checked, onChange) {
  const input = h('input', { type: 'checkbox', checked })
  input.addEventListener('change', () => onChange(input.checked))
  return h('label', { class: 'es-row' }, h('span', {}, label), h('span', { class: 'switch' }, input, h('span')))
}
