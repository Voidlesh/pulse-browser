// Block page shown while focus mode is active. Once focus ends, the blocked
// site can be opened with one click.
const page = window.pulsePage
const params = new URLSearchParams(location.search)
const site = (params.get('site') || '').replace(/[^a-z0-9.-]/gi, '')
document.querySelector('#site').textContent = site || 'Diese Seite'
let state = { active: false }
let timer = null

function draw() {
  const left = Math.max(0, (state.endsAt || 0) - Date.now())
  document.querySelector('#left').textContent = state.active ? `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}` : '✓'
  const open = document.querySelector('#open')
  open.hidden = state.active || !site
  if (site) open.href = `https://${site}/`
  document.querySelector('#hint').textContent = state.active
    ? 'Die Seite ist wieder erreichbar, sobald die Fokus-Zeit vorbei ist.'
    : 'Die Fokus-Zeit ist vorbei.'
}

function apply(next) {
  state = next || { active: false }
  clearInterval(timer)
  draw()
  if (state.active) timer = setInterval(draw, 1000)
}

page.onFocus(apply)
page.focusState().then(apply)
