'use strict'

// End-to-end smoke test: `npm run smoke`. Starts Pulse with a throwaway
// profile, drives a few real flows and writes screenshots to test/output/.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { app } = require('electron')

const OUT = path.join(__dirname, 'output')
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-smoke-')))
process.env.PULSE_NO_RESTORE = '1'

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
let step = 'start'
const check = (name, ok, detail = '') => { step = name; results.push({ name, ok: Boolean(ok), detail }) }

async function shot(ctrl, name) {
  try {
    await capture(ctrl, name)
  } catch (err) {
    // Capturing fails when the window is occluded on the desktop; screenshots are diagnostics only.
    process.stdout.write(`(Screenshot ${name} übersprungen: ${err.message})
`)
  }
}

async function capture(ctrl, name) {
  const ui = await ctrl.ui.capturePage()
  fs.writeFileSync(path.join(OUT, `${name}-ui.png`), ui.toPNG())
  const tab = ctrl.tabs.active
  // A page hidden behind an overlay has no surface to capture.
  if (tab && tab.wc && !ctrl.tabs.hidden) fs.writeFileSync(path.join(OUT, `${name}-page.png`), (await tab.wc.capturePage()).toPNG())
}

async function run() {
  fs.mkdirSync(OUT, { recursive: true })
  require('../src/main/main')
  await app.whenReady()
  await wait(6000)
  const { BrowserWindow } = require('electron')
  const browser = global.__pulse
  const ctrl = [...browser.windows.values()][0]
  check('window created', ctrl && BrowserWindow.getAllWindows().length >= 1)

  const uiErrors = []
  ctrl.ui.on('console-message', (e) => { if (e.level === 'error') uiErrors.push(e.message) })
  const uiReady = await ctrl.ui.executeJavaScript('document.querySelectorAll(".tab").length')
  check('tab strip rendered', uiReady === 1, `tabs=${uiReady}`)
  const newtab = await ctrl.tabs.active.wc.executeJavaScript('document.querySelectorAll(".tile").length')
  check('new tab speed dial', newtab >= 6, `tiles=${newtab}`)
  await wait(6000)
  const realIcons = await ctrl.tabs.active.wc.executeJavaScript('document.querySelectorAll(".tile-icon img").length')
  check('speed dial shows real site icons', realIcons >= 4, `icons=${realIcons}`)
  const fx = await ctrl.tabs.active.wc.executeJavaScript('document.querySelector("#fx").width')
  check('background effect canvas running', fx > 0, `width=${fx}`)
  await shot(ctrl, '1-newtab')

  const js = (code) => ctrl.ui.executeJavaScript(code)
  await js('document.querySelector("#tt-palette").click()')
  await wait(900)
  check('palette opens over frozen page', await js('!document.querySelector("#overlay").hidden && !!document.querySelector(".pal-input")'))
  check('palette lists commands', (await js('document.querySelectorAll(".pal-item").length')) >= 5)
  check('page view hidden behind overlay', ctrl.tabs.hidden === true)
  await shot(ctrl, '4-palette')
  await js('document.querySelector(".pal-input").value = "einst"; document.querySelector(".pal-input").dispatchEvent(new Event("input"))')
  await wait(500)
  const first = await js('document.querySelector(".pal-item.selected .t")?.textContent || ""')
  check('palette filters', first.includes('Einstellungen'), first)
  await js('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))')
  await wait(600)
  check('overlay closes and page returns', (await js('document.querySelector("#overlay").hidden')) && ctrl.tabs.hidden === false)

  await js('document.querySelector("#tt-easy").click()')
  await wait(1200)
  check('easy setup drawer', (await js('document.querySelectorAll(".es-theme").length')) === 8)
  await js('document.querySelectorAll(".es-theme")[1].click()')
  await wait(800)
  check('theme preset applies', browser.settings.get().accent === '#00e5ff' && browser.settings.get().bgEffect === 'grid', browser.settings.get().accent)
  await shot(ctrl, '5-easy-setup')
  await js('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))')
  await wait(600)
  const ntAccent = await ctrl.tabs.active.wc.executeJavaScript('getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()')
  check('start page follows theme live', ntAccent === '#00e5ff', ntAccent)
  await wait(1500)
  await shot(ctrl, '6-newtab-cyber')

  ctrl.navigate(browser.resolveInput('example.com'))
  await wait(4000)
  check('navigation', ctrl.tabs.active.url.startsWith('https://example.com'), ctrl.tabs.active.url)
  check('history recorded', browser.history.search('example').length >= 1)
  const addr = await ctrl.ui.executeJavaScript('document.querySelector("#address").value')
  check('address bar shows url', addr.startsWith('https://example.com'), addr)

  browser.bookmarks.toggle({ title: 'Example', url: ctrl.tabs.active.url })
  check('bookmark added', browser.bookmarks.find(ctrl.tabs.active.url))

  const firstId = ctrl.tabs.activeId
  ctrl.newTab('https://example.org/', { active: false })
  await wait(3000)
  check('second tab', ctrl.tabs.order.length === 2)
  check('background tab stays in background', ctrl.tabs.activeId === firstId)
  const bg = ctrl.tabs.order.find((id) => id !== ctrl.tabs.activeId)
  check('discard background tab', ctrl.tabs.discard(bg) && ctrl.tabs.tabs.get(bg).discarded)
  ctrl.tabs.activate(bg)
  await wait(3000)
  check('restore discarded tab', !ctrl.tabs.tabs.get(bg).discarded && ctrl.tabs.tabs.get(bg).url.includes('example.org'), ctrl.tabs.tabs.get(bg).url)

  await ctrl.ui.executeJavaScript('document.querySelector(\'.side-btn[data-panel="control"]\').click()')
  await wait(4500)
  const ram = await ctrl.ui.executeJavaScript('document.querySelector("#ctl-ram .big-num")?.textContent || ""')
  check('control panel shows RAM', /\d/.test(ram), ram)
  await shot(ctrl, '2-control')

  const vault = browser.passwords
  vault.save({ origin: 'https://login.test', username: 'levi', password: 'geheim123' })
  check('password vault encrypt/decrypt', vault.forOrigin('https://login.test')[0].password === 'geheim123')
  vault.store.flush()
  const onDisk = fs.readFileSync(path.join(app.getPath('userData'), 'passwords.json'), 'utf8')
  check('password not stored in plaintext', !onDisk.includes('geheim123') && onDisk.includes('passwordEnc'))

  await ctrl.ui.executeJavaScript('document.querySelector(\'.side-btn[data-panel="settings"]\').click()')
  await wait(800)
  await shot(ctrl, '3-settings')
  check('extensions api ready', Array.isArray(browser.extensions.list()))
  check('adblock engine loaded', Boolean(browser.adblock.blocker))

  await js('document.querySelector("#tt-snapshot").click()')
  await wait(900)
  check('snapshot tool opens', await js('!!document.querySelector(".snap-stage")'))
  await js('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))')
  await wait(500)

  browser.settings.update((s) => ({ ...s, extensionsCollapsed: true }))
  browser.applySettings()
  await wait(300)
  check('extensions collapse', await js('document.body.classList.contains("ext-collapsed")'))
  check('no UI errors', uiErrors.length === 0, uiErrors.slice(0, 3).join(' | '))

  const failed = results.filter((r) => !r.ok)
  for (const r of results) process.stdout.write(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}\n`)
  process.stdout.write(`\n${results.length - failed.length}/${results.length} bestanden\n`)
  app.exit(failed.length ? 1 : 0)
}

run().catch((err) => {
  for (const r of results) process.stdout.write(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}\n`)
  process.stdout.write(`SMOKE ERROR after "${step}": ${err.stack}\n`)
  app.exit(2)
})
