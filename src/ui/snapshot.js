import { h, icon, toast } from './util.js'
import { openOverlay } from './overlay.js'

// Snapshot tool: drag a region over the frozen page, then copy or save it.

const api = window.pulse
const MIN_SIZE = 6

export function openSnapshot() {
  return openOverlay('snapshot', (root, close, shotImg) => {
    if (!shotImg.getAttribute('src') || shotImg.hidden) {
      toast('Auf dieser Seite gibt es nichts aufzunehmen')
      setTimeout(close, 0)
      return
    }
    const sel = h('div', { class: 'snap-sel', hidden: true })
    const size = h('div', { class: 'snap-size' })
    const bar = h('div', { class: 'snap-bar', hidden: true },
      h('button', { class: 'btn primary', onclick: () => finish('copy') }, icon('copy'), 'Kopieren'),
      h('button', { class: 'btn', onclick: () => finish('save') }, icon('download'), 'Speichern'),
      h('button', { class: 'icon-btn small', title: 'Abbrechen', icon: 'close', onclick: () => close() }))
    const hint = h('div', { class: 'snap-hint' }, 'Bereich aufziehen · Enter = ganze Seite · Esc = abbrechen')
    const stage = h('div', { class: 'snap-stage' }, sel, size, bar, hint)
    root.append(stage)

    let start = null
    let rect = null

    const place = (r) => {
      rect = r
      Object.assign(sel.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` })
      sel.hidden = false
      size.textContent = `${Math.round(r.w)} × ${Math.round(r.h)}`
      Object.assign(size.style, { left: `${r.x}px`, top: `${Math.max(0, r.y - 26)}px` })
    }

    stage.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.snap-bar')) return
      const b = stage.getBoundingClientRect()
      start = { x: e.clientX - b.left, y: e.clientY - b.top }
      bar.hidden = true
      hint.hidden = true
      stage.setPointerCapture(e.pointerId)
    })
    stage.addEventListener('pointermove', (e) => {
      if (!start) return
      const b = stage.getBoundingClientRect()
      const x = Math.max(0, Math.min(b.width, e.clientX - b.left))
      const y = Math.max(0, Math.min(b.height, e.clientY - b.top))
      place({ x: Math.min(x, start.x), y: Math.min(y, start.y), w: Math.abs(x - start.x), h: Math.abs(y - start.y) })
    })
    stage.addEventListener('pointerup', () => {
      start = null
      if (!rect || rect.w < MIN_SIZE || rect.h < MIN_SIZE) { sel.hidden = true; hint.hidden = false; return }
      const b = stage.getBoundingClientRect()
      bar.hidden = false
      const top = rect.y + rect.h + 10 + 40 > b.height ? rect.y - 50 : rect.y + rect.h + 10
      Object.assign(bar.style, { left: `${Math.min(b.width - 260, Math.max(8, rect.x + rect.w - 250))}px`, top: `${Math.max(8, top)}px` })
    })
    const onKey = (e) => {
      if (e.key === 'Enter' && !e.target.closest?.('.snap-bar')) {
        const b = stage.getBoundingClientRect()
        place({ x: 0, y: 0, w: b.width, h: b.height })
        finish('copy')
      }
    }
    document.addEventListener('keydown', onKey)

    async function finish(mode) {
      const scale = shotImg.naturalWidth / shotImg.clientWidth
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(rect.w * scale)
      canvas.height = Math.round(rect.h * scale)
      canvas.getContext('2d').drawImage(shotImg, rect.x * scale, rect.y * scale, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height)
      const data = canvas.toDataURL('image/png')
      if (mode === 'copy') {
        await api.call('snapshot-copy', data)
        toast('Snapshot in die Zwischenablage kopiert')
        close()
      } else if (await api.call('snapshot-save', data)) {
        toast('Snapshot gespeichert')
        close()
      }
    }

    return () => document.removeEventListener('keydown', onKey)
  })
}
