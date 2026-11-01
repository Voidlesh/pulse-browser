import { createBackground } from '/shared/effects.js'

const page = window.pulsePage
const $ = (sel) => document.querySelector(sel)
let speedDial = []
let suggestions = []
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
    return tile
  })
  const add = el('div', { className: 'tile add', title: 'Kachel hinzufügen' }, '+')
  add.style.setProperty('--i', tiles.length)
  add.onclick = () => { $('#add-form').hidden = false; $('#add-title').focus() }
  $('#dial').replaceChildren(...tiles, add)
  renderSuggestions()
}

/** "Oft besucht": frequently visited sites below the speed dial. */
function renderSuggestions() {
  const section = $('#suggestions')
  section.hidden = !suggestions.length
  $('#suggest-list').replaceChildren(...suggestions.map((d) => {
    const pin = el('button', { className: 'mini', title: 'Zum Speed Dial hinzufügen' }, '+')
    pin.onclick = (e) => {
      e.preventDefault()
      speedDial = [...speedDial, { title: d.title, url: d.url }]
      suggestions = suggestions.filter((x) => x.url !== d.url)
      page.setSpeedDial(speedDial)
      renderDial()
    }
    const hide = el('button', { className: 'mini', title: 'Nicht mehr vorschlagen' }, '×')
    hide.onclick = (e) => {
      e.preventDefault()
      suggestions = suggestions.filter((x) => x.url !== d.url)
      page.hideSuggestion(d.url)
      renderSuggestions()
    }
    return el('a', { className: 'suggest', href: d.url, title: d.url }, tileIcon(d), el('span', {}, d.title || hostOf(d.url)), pin, hide)
  }))
}

async function loadIcons() {
  try {
    icons = await page.favicons([...speedDial, ...suggestions].map((d) => d.url))
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
  const speedDialChanged = JSON.stringify(data.speedDial) !== JSON.stringify(speedDial) || JSON.stringify(data.suggestions) !== JSON.stringify(suggestions)
  speedDial = data.speedDial
  suggestions = data.suggestions || []
  $('#clock').hidden = data.clock === false
  $('#date').hidden = data.clock === false
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
