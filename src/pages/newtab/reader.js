// Reader view: shows an article prepared by Pulse (text only, no page scripts).
const page = window.pulsePage
const $ = (sel) => document.querySelector(sel)
const PREFS_KEY = 'pulse-reader'
const prefs = { size: 19, theme: 'dark', ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }
let article = null

function applyPrefs() {
  document.documentElement.style.setProperty('--size', `${prefs.size}px`)
  document.body.className = `theme-${prefs.theme}`
  for (const b of document.querySelectorAll('[data-theme]')) b.classList.toggle('active', b.dataset.theme === prefs.theme)
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
}

function el(tag, text) {
  const node = document.createElement(tag)
  if (text) node.textContent = text
  return node
}

function render() {
  if (!article) {
    $('#body').replaceChildren(el('div', 'Dieser Artikel ist nicht mehr verfügbar. Öffne die Seite neu und starte die Leseansicht erneut.'))
    $('#body').firstChild.className = 'empty'
    $('#original').hidden = true
    return
  }
  document.title = article.title || 'Leseansicht'
  $('#title').textContent = article.title
  $('#meta').textContent = [article.site, article.byline, `${article.minutes} Min. Lesezeit`].filter(Boolean).join(' · ')
  const nodes = []
  let list = null
  for (const b of article.blocks) {
    if (b.type === 'li') {
      if (!list) { list = el('ul'); nodes.push(list) }
      list.append(el('li', b.text))
      continue
    }
    list = null
    if (b.type === 'img') {
      const fig = el('figure')
      const img = el('img')
      img.src = b.src
      img.alt = b.text || ''
      img.loading = 'lazy'
      img.referrerPolicy = 'no-referrer'
      fig.append(img)
      if (b.text) fig.append(el('figcaption', b.text))
      nodes.push(fig)
    } else {
      nodes.push(el({ quote: 'blockquote' }[b.type] || b.type, b.text))
    }
  }
  $('#body').replaceChildren(...nodes)
}

$('#original').onclick = () => article && page.readerOriginal(article.url)
$('#smaller').onclick = () => { prefs.size = Math.max(14, prefs.size - 1); applyPrefs() }
$('#bigger').onclick = () => { prefs.size = Math.min(28, prefs.size + 1); applyPrefs() }
for (const b of document.querySelectorAll('[data-theme]')) b.onclick = () => { prefs.theme = b.dataset.theme; applyPrefs() }

applyPrefs()
page.reader(location.hash.slice(1)).then((a) => { article = a; render() })
