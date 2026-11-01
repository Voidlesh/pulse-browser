'use strict'

// End-to-end smoke test: `npm run smoke`. Starts Pulse with a throwaway
// profile, drives a few real flows and writes screenshots to test/output/.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { app } = require('electron')

const OUT = path.join(__dirname, 'output')
const NEW_TAB = 'pulse://newtab/'
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-smoke-')))
process.env.PULSE_NO_RESTORE = '1'
// Linux CI has no OS key store; the basic backend still lets safeStorage encrypt.
if (process.platform === 'linux') app.commandLine.appendSwitch('password-store', 'basic')

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
let step = 'start'
const check = (name, ok, detail = '') => {
  step = name
  results.push({ name, ok: Boolean(ok), detail })
  if (process.env.SMOKE_VERBOSE) process.stdout.write(`${ok ? 'pass' : 'FAIL'}  ${name}\n`)
}

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
  const { safeStorage } = require('electron')
  if (process.platform === 'linux' && !safeStorage.isEncryptionAvailable() && safeStorage.setUsePlainTextEncryption) safeStorage.setUsePlainTextEncryption(true)
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
  check('empty bookmarks bar is hidden', await ctrl.ui.executeJavaScript('document.querySelector("#bookmarks-bar").hidden'))
  const realIcons = await ctrl.tabs.active.wc.executeJavaScript('document.querySelectorAll("#dial .tile-icon img").length')
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
  browser.broadcast('bookmarks', browser.bookmarks.list())
  check('bookmark added', browser.bookmarks.find(ctrl.tabs.active.url))
  await wait(300)
  check('bookmarks bar appears with a bookmark', !(await js('document.querySelector("#bookmarks-bar").hidden')))

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

  const cleanerRows = await js('document.querySelectorAll(".cleaner-row").length')
  check('control panel has cleaner', cleanerRows === 5, `rows=${cleanerRows}`)

  // ---- split screen & per-tab volume
  const [left, right] = ctrl.tabs.order
  ctrl.tabs.activate(left)
  ctrl.tabs.splitWith(right)
  await wait(1500)
  const lb = ctrl.tabs.tabs.get(left).view.getBounds()
  const rb = ctrl.tabs.tabs.get(right).view.getBounds()
  check('split screen shows two panes side by side', ctrl.win.contentView.children.includes(ctrl.tabs.tabs.get(right).view) && rb.x > lb.x + lb.width - 1 && Math.abs(lb.width - rb.width) <= 2, `${lb.width}/${rb.width}`)
  check('split pane can be focused', (ctrl.tabs.focusSplitPane(right), ctrl.tabs.activeId === right))
  check('split button visible', !(await js('document.querySelector("#btn-split").hidden')))
  await shot(ctrl, '7-split')
  ctrl.tabs.unsplit()
  check('split screen ends', ctrl.tabs.split === null && !ctrl.win.contentView.children.includes(ctrl.tabs.tabs.get(left).view))
  await ctrl.tabs.active.wc.executeJavaScript('document.body.append(Object.assign(document.createElement("audio"), { id: "a" })); 1')
  ctrl.tabs.setVolume(ctrl.tabs.activeId, 25)
  await wait(400)
  const vol = await ctrl.tabs.active.wc.executeJavaScript('document.querySelector("#a").volume')
  check('per-tab volume applies to media', Math.abs(vol - 0.25) < 0.01, `volume=${vol}`)

  // ---- notes
  browser.notes.set(ctrl.tabs.active.url, 'Example', 'Meine Notiz')
  browser.broadcast('notes', null)
  await wait(400)
  check('note button lights up', await js('document.querySelector("#btn-note").classList.contains("on")'))
  await js('document.querySelector("#btn-note").click()')
  await wait(800)
  check('notes panel shows the note', (await js('document.querySelector(".note-area")?.value || ""')) === 'Meine Notiz')

  // ---- focus mode
  browser.startFocus(25)
  ctrl.navigate(browser.resolveInput('https://www.youtube.com/'))
  await wait(2500)
  check('focus mode blocks distracting site', ctrl.tabs.active.url.startsWith('pulse://newtab/focus.html'), ctrl.tabs.active.url)
  check('focus badge shows countdown', !(await js('document.querySelector("#focus-badge").hidden')))
  await shot(ctrl, '8-focus')
  browser.focus.stop()
  await wait(300)

  // ---- settings page (one place for all settings)
  await js('document.querySelector("#side-settings").click()')
  await wait(2500)
  const st = ctrl.tabs.active
  check('settings open as own page', st.url.startsWith('pulse://settings/'), st.url)
  const sections = await st.wc.executeJavaScript('document.querySelectorAll("section.group").length')
  check('settings page has all sections', sections === 12, `sections=${sections}`)
  check('settings page lists saved password', await st.wc.executeJavaScript('new Promise((r) => setTimeout(() => r(document.body.textContent.includes("login.test")), 500))'))
  await st.wc.executeJavaScript('document.querySelector("#q").value = "autofill"; document.querySelector("#q").dispatchEvent(new Event("input")); 1')
  const visible = await st.wc.executeJavaScript('[...document.querySelectorAll("section.group")].filter((s) => !s.hidden).map((s) => s.id).join(",")')
  check('settings search filters', visible === 'passwords', visible)
  await st.wc.executeJavaScript('document.querySelector("#q").value = ""; document.querySelector("#q").dispatchEvent(new Event("input")); 1')
  await st.wc.executeJavaScript('document.querySelector("#start select").value = "newtab"; document.querySelector("#start select").dispatchEvent(new Event("change")); 1')
  await wait(400)
  check('settings page changes settings', browser.settings.get().startup === 'newtab', browser.settings.get().startup)
  await shot(ctrl, '3-settings')
  const tabsBefore = ctrl.tabs.order.length
  await js('document.querySelector("#side-settings").click()')
  await wait(500)
  check('settings tab is reused', ctrl.tabs.order.length === tabsBefore)
  check('settings page cannot be reached by websites', await (async () => {
    ctrl.navigate('https://example.com/')
    await wait(2500)
    await ctrl.tabs.active.wc.executeJavaScript('location.href = "pulse://settings/"; 1').catch(() => {})
    await wait(1200)
    return ctrl.tabs.active.url.startsWith('https://example.com')
  })())

  // ---- start page suggestions
  ctrl.navigate(NEW_TAB)
  await wait(2500)
  const sugg = await ctrl.tabs.active.wc.executeJavaScript('document.querySelectorAll(".suggest").length')
  check('start page suggests visited sites', sugg >= 1, `suggestions=${sugg}`)
  await shot(ctrl, '9-newtab-suggestions')
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
