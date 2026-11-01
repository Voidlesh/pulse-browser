import { createBackground } from '/shared/effects.js'

const page = window.pulsePage
const $ = (sel) => document.querySelector(sel)
let speedDial = []
let background = null
let icons = {}

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

const originOf = (url) => { try { return new URL(url).origin } catch { return '' } }
const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' } }
function hueFor(text) {
  let hash = 0
  for (const ch of text) hash = (hash * 31 + ch.charCodeAt(0)) | 0
  return Math.abs(hash) % 360
}

function tileIcon(d) {
  const label = (d.title || hostOf(d.url) || '?')[0].toUpperCase()
  const letter = el('div', { className: 'letter' }, label)
  letter.style.setProperty('--hue', hueFor(hostOf(d.url) || label))
  const slot = el('div', { className: 'tile-icon' }, letter)
  const src = icons[originOf(d.url)]
  if (src) {
    const img = el('img', { alt: '', draggable: false })
    img.onload = () => img.naturalWidth > 1 && slot.replaceChildren(img)
    img.src = src
  }
  return slot
}

function renderDial() {
  const tiles = speedDial.map((d, i) => {
    const remove = el('button', { className: 'remove', title: 'Entfernen' }, '×')
    remove.onclick = (e) => {
      e.preventDefault()
      speedDial = speedDial.filter((_, j) => j !== i)
      page.setSpeedDial(speedDial)
      renderDial()
    }
    const tile = el('a', { className: 'tile', href: d.url, title: d.url }, remove, tileIcon(d), el('span', {}, d.title || hostOf(d.url)))
    tile.style.setProperty('--i', i)
    tile.addEventListener('pointermove', (e) => {
      const r = tile.getBoundingClientRect()
      tile.style.setProperty('--px', `${e.clientX - r.left}px`)
      tile.style.setProperty('--py', `${e.clientY - r.top}px`)
      const rx = ((e.clientY - r.top) / r.height - 0.5) * -8
      const ry = ((e.clientX - r.left) / r.width - 0.5) * 8
      tile.style.setProperty('--rx', `${rx}deg`)
      tile.style.setProperty('--ry', `${ry}deg`)
    })
    tile.addEventListener('pointerleave', () => { tile.style.setProperty('--rx', '0deg'); tile.style.setProperty('--ry', '0deg') })
    return tile
  })
  const add = el('div', { className: 'tile add', title: 'Kachel hinzufügen' }, '+')
  add.style.setProperty('--i', tiles.length)
  add.onclick = () => { $('#add-form').hidden = false; $('#add-title').focus() }
  $('#dial').replaceChildren(...tiles, add)
}

async function loadIcons() {
  try {
    icons = await page.favicons(speedDial.map((d) => d.url))
  } catch {
    icons = {}
  }
  renderDial()
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
    loadIcons()
  } catch {
    $('#add-url').focus()
  }
})
$('#add-cancel').onclick = () => { $('#add-form').reset(); $('#add-form').hidden = true }

function applySettings(data) {
  const speedDialChanged = JSON.stringify(data.speedDial) !== JSON.stringify(speedDial)
  speedDial = data.speedDial
  document.documentElement.style.setProperty('--accent', data.accent)
  document.body.className = `anim-${data.animations || 'full'}`
  const bg = $('#bg')
  bg.style.backgroundImage = data.wallpaper ? `url("${data.wallpaper.replace(/"/g, '%22')}")` : ''
  bg.classList.toggle('image', Boolean(data.wallpaper))
  const fx = { type: data.bgEffect || 'none', accent: data.accent, motion: data.animations || 'full' }
  if (background) background.update(fx)
  else background = createBackground($('#fx'), fx)
  if (speedDialChanged) loadIcons()
}

async function init() {
  tick()
  setInterval(tick, 10000)
  applySettings(await page.newtabData())
  page.onSettings(applySettings)
  renderDial()
  requestAnimationFrame(() => document.documentElement.classList.add('ready'))
}

init()
