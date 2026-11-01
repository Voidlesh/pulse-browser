// Global motion: animation level classes, the cursor spotlight on the title
// bar, the page loading bar and staggered entrance of panel content.

const body = document.body
const titlebar = document.querySelector('#titlebar')
const loadbar = document.querySelector('#loadbar')
let level = 'full'
let loadingSince = 0
let doneTimer = null

/** @param {'full'|'reduced'|'off'} next */
export function setMotion(next) {
  level = next
  body.classList.toggle('anim-full', next === 'full')
  body.classList.toggle('anim-reduced', next === 'reduced')
  body.classList.toggle('anim-off', next === 'off')
}

titlebar.addEventListener('pointermove', (e) => {
  if (level !== 'full') return
  const r = titlebar.getBoundingClientRect()
  titlebar.style.setProperty('--mx', `${e.clientX - r.left}px`)
  titlebar.style.setProperty('--my', `${e.clientY - r.top}px`)
}, { passive: true })

/** Thin progress line under the toolbar while the active tab loads. */
export function setLoading(loading) {
  if (loading && !loadbar.classList.contains('loading')) {
    clearTimeout(doneTimer)
    loadbar.classList.remove('done')
    loadbar.classList.add('loading')
    loadingSince = performance.now()
  } else if (!loading && loadbar.classList.contains('loading')) {
    // Very fast loads don't flash the bar.
    const shown = performance.now() - loadingSince
    loadbar.classList.remove('loading')
    if (shown > 120) {
      loadbar.classList.add('done')
      doneTimer = setTimeout(() => loadbar.classList.remove('done'), 450)
    }
  }
}

/** Fades/slides children of an element in one after another. */
export function stagger(el) {
  if (level === 'off') return
  ;[...el.children].forEach((child, i) => {
    child.style.setProperty('--i', Math.min(i, 14))
    child.classList.remove('stagger-in')
    void child.offsetWidth
    child.classList.add('stagger-in')
  })
}
