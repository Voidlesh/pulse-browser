'use strict'

const page = window.pulsePage
const $ = (sel) => document.querySelector(sel)
let speedDial = []

function tick() {
  const now = new Date()
  $('#clock').textContent = now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  $('#date').textContent = now.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })
}

function el(tag, props, ...children) {
  const node = Object.assign(document.createElement(tag), props)
  node.append(...children)
  return node
}

function renderDial() {
  const tiles = speedDial.map((d, i) => {
    const host = (() => { try { return new URL(d.url).hostname } catch { return '' } })()
    const img = el('img', { src: `${new URL(d.url).origin}/favicon.ico`, alt: '' })
    img.onerror = () => img.replaceWith(el('div', { className: 'letter' }, (d.title || host || '?')[0].toUpperCase()))
    const remove = el('button', { className: 'remove', title: 'Entfernen' }, '×')
    remove.onclick = (e) => {
      e.preventDefault()
      speedDial = speedDial.filter((_, j) => j !== i)
      page.setSpeedDial(speedDial)
      renderDial()
    }
    return el('a', { className: 'tile', href: d.url, title: d.url }, remove, img, el('span', {}, d.title || host))
  })
  const add = el('div', { className: 'tile add', title: 'Kachel hinzufügen' }, '+')
  add.onclick = () => { $('#add-form').hidden = false; $('#add-title').focus() }
  $('#dial').replaceChildren(...tiles, add)
}

$('#search-form').addEventListener('submit', (e) => {
  e.preventDefault()
  const text = $('#search').value.trim()
  if (text) page.search(text)
})

$('#add-form').addEventListener('submit', (e) => {
  e.preventDefault()
  const raw = $('#add-url').value.trim()
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`).href
    speedDial = [...speedDial, { title: $('#add-title').value.trim() || new URL(url).hostname, url }]
    page.setSpeedDial(speedDial)
    $('#add-form').reset()
    $('#add-form').hidden = true
    renderDial()
  } catch {
    $('#add-url').focus()
  }
})
$('#add-cancel').onclick = () => { $('#add-form').reset(); $('#add-form').hidden = true }

async function init() {
  tick()
  setInterval(tick, 10000)
  const data = await page.newtabData()
  speedDial = data.speedDial
  document.documentElement.style.setProperty('--accent', data.accent)
  if (data.wallpaper) {
    const bg = $('#bg')
    bg.style.backgroundImage = `url("${data.wallpaper.replace(/"/g, '%22')}")`
    bg.classList.add('image')
  }
  renderDial()
}

init()
