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
const check = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail })

async function shot(ctrl, name) {
  const ui = await ctrl.ui.capturePage()
  fs.writeFileSync(path.join(OUT, `${name}-ui.png`), ui.toPNG())
  const tab = ctrl.tabs.active
  if (tab && tab.wc) fs.writeFileSync(path.join(OUT, `${name}-page.png`), (await tab.wc.capturePage()).toPNG())
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

  const uiReady = await ctrl.ui.executeJavaScript('document.querySelectorAll(".tab").length')
  check('tab strip rendered', uiReady === 1, `tabs=${uiReady}`)
  const newtab = await ctrl.tabs.active.wc.executeJavaScript('document.querySelectorAll(".tile").length')
  check('new tab speed dial', newtab >= 6, `tiles=${newtab}`)
  await shot(ctrl, '1-newtab')

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

  const failed = results.filter((r) => !r.ok)
  for (const r of results) process.stdout.write(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}\n`)
  process.stdout.write(`\n${results.length - failed.length}/${results.length} bestanden\n`)
  app.exit(failed.length ? 1 : 0)
}

run().catch((err) => {
  process.stdout.write(`SMOKE ERROR ${err.stack}\n`)
  app.exit(2)
})
