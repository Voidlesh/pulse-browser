// Modal overlays drawn above the page. The page is frozen behind a screenshot
// (the live view can't be overlapped by HTML), then restored on close.

const api = window.pulse
const root = document.querySelector('#overlay')
const shot = document.querySelector('#overlay-shot')
const content = document.querySelector('#overlay-content')
const CLOSE_MS = 180

let active = null // { kind, cleanup }
let opening = null // kind being opened (screenshot in flight)
// Open/close are async (screenshot, IPC, exit animation); run them strictly in
// order so fast repeated clicks or shortcuts are never dropped or interleaved.
let queue = Promise.resolve()
const enqueue = (job) => {
  queue = queue.then(job, job)
  return queue
}

export const overlayKind = () => (active ? active.kind : opening)

/**
 * Opens an overlay; calling it again for the open kind toggles it closed.
 * @param {string} kind 'palette' | 'snapshot' | 'easy-setup'
 * @param {(content: HTMLElement, close: () => Promise<void>, shotImg: HTMLImageElement) => (void|(() => void))} render
 */
export function openOverlay(kind, render) {
  return enqueue(async () => {
    if (active) {
      const same = active.kind === kind
      await doClose()
      if (same) return
    }
    opening = kind
    let image = ''
    try {
      image = await api.call('overlay-begin')
    } finally {
      opening = null
    }
    shot.src = image || ''
    shot.hidden = !image
    root.dataset.kind = kind
    root.hidden = false
    content.replaceChildren()
    active = { kind, cleanup: null }
    try {
      active.cleanup = render(content, closeOverlay, shot) || null
    } catch (err) {
      console.error('[pulse] Overlay konnte nicht geöffnet werden:', err)
      await doClose()
      return
    }
    requestAnimationFrame(() => root.classList.add('open'))
  })
}

export function closeOverlay() {
  return enqueue(doClose)
}

async function doClose() {
  if (!active) return
  const { cleanup } = active
  active = null
  root.classList.remove('open')
  try {
    if (cleanup) cleanup()
  } finally {
    await new Promise((r) => setTimeout(r, document.body.classList.contains('anim-off') ? 0 : CLOSE_MS))
    root.hidden = true
    content.replaceChildren()
    shot.removeAttribute('src')
    await api.call('overlay-end')
  }
}

document.querySelector('#overlay-scrim').addEventListener('mousedown', () => closeOverlay())
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && active) {
    e.preventDefault()
    closeOverlay()
  }
})
