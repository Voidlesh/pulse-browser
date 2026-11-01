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
  check('settings page has all sections', sections === 14, `sections=${sections}`)
  const shortcutRows = await st.wc.executeJavaScript('document.querySelectorAll("#shortcuts .row").length')
  check('settings lists shortcuts', shortcutRows > 25, `rows=${shortcutRows}`)
  const generated = await st.wc.executeJavaScript('new Promise((r) => setTimeout(() => r(document.querySelector("#passwords input.mono").value), 400))')
  check('settings password generator', generated.length === 18, `len=${generated.length}`)
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

  // ---- attack pages: redirect to pulse://, hidden autofill fields
  const http = require('node:http')
  const PAGES = {
    '/redir': [302, { Location: 'pulse://settings/#passwords' }, ''],
    '/login': [200, { 'Content-Type': 'text/html' }, '<form><input id="u" name="username" style="width:200px;height:30px"><input id="p" type="password" style="position:absolute;left:-9999px;width:200px;height:30px"></form>'],
    '/login3': [200, { 'Content-Type': 'text/html' }, '<form><input id="u" name="username" style="width:200px;height:30px"><input id="p" type="password" style="width:200px;height:30px;opacity:.02"></form>'],
    '/login4': [200, { 'Content-Type': 'text/html' }, '<form><input id="u" name="username" style="width:200px;height:30px"><span style="position:relative;display:inline-block"><input id="p" type="password" style="width:200px;height:30px"><span style="position:absolute;inset:0;background:#fff"></span></span></form>'],
    '/login5': [200, { 'Content-Type': 'text/html' }, '<form><input id="u" name="username" style="width:200px;height:30px"><span style="position:relative;display:inline-block"><input id="p" type="password" style="width:200px;height:30px"><span style="position:absolute;inset:0;background:#fff;pointer-events:none"></span></span></form>'],
    '/material': [200, { 'Content-Type': 'text/html' }, '<form><span style="position:relative;display:inline-block"><input id="u" name="username" style="width:200px;height:40px"><span style="position:absolute;left:8px;top:10px;pointer-events:none">E-Mail</span></span><span style="position:relative;display:inline-block"><input id="p" type="password" style="width:200px;height:40px"><span style="position:absolute;left:8px;top:10px;pointer-events:none">Passwort</span></span></form>'],
    '/login2': [200, { 'Content-Type': 'text/html' }, '<form><input id="u" name="username" style="width:200px;height:30px"><input id="p" type="password" style="width:200px;height:30px"></form>'],
    '/article': [200, { 'Content-Type': 'text/html' }, `<title>Testartikel</title><nav><a href="/">Start</a><a href="/x">Menü</a></nav><article><h1>Ein langer Testartikel</h1>${Array.from({ length: 8 }, (_, i) => `<p>Absatz ${i + 1}: ${'Pulse liest diesen Text in der Leseansicht vor und zeigt ihn ruhig an. '.repeat(4)}</p>`).join('')}<script>window.evil = 1</script></article><footer>Impressum</footer>`],
    '/signup': [200, { 'Content-Type': 'text/html' }, '<form><input name="email" style="width:200px;height:30px"><input id="p1" type="password" autocomplete="new-password" style="width:200px;height:30px"><input id="p2" type="password" style="width:200px;height:30px"></form>'],
    '/change': [200, { 'Content-Type': 'text/html' }, '<form><input id="c" type="password" autocomplete="current-password" style="width:200px;height:30px"><input id="n" type="password" autocomplete="new-password" style="width:200px;height:30px"><input id="r" type="password" style="width:200px;height:30px"></form>'],
    '/video': [200, { 'Content-Type': 'text/html' }, '<video id="v" muted width="320" height="180"></video><script>const c=document.createElement("canvas");c.width=320;c.height=180;const x=c.getContext("2d");setInterval(()=>{x.fillStyle="#"+Math.floor(Math.random()*16777215).toString(16).padStart(6,"0");x.fillRect(0,0,320,180)},100);const v=document.getElementById("v");v.srcObject=c.captureStream(10);v.play()</script>'],
    '/addr': [200, { 'Content-Type': 'text/html' }, '<form><input id="email" name="email" style="width:200px;height:30px"><input id="n" name="name" style="width:200px;height:30px"><input id="city" name="city" style="position:absolute;left:-9999px;width:200px;height:30px"><input id="street" name="street" style="width:200px;height:30px;clip-path:inset(50%)"></form>'],
  }
  const server = http.createServer((req, res) => {
    const [status, headers, body] = PAGES[req.url] || [404, {}, '']
    res.writeHead(status, headers)
    res.end(body)
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  ctrl.navigate(`${base}/redir`)
  await wait(2000)
  check('server redirect cannot reach pulse://settings', !ctrl.tabs.active.url.startsWith('pulse:'), ctrl.tabs.active.url)

  const clickInto = async (wc, selector) => {
    const r = await wc.executeJavaScript(`(() => { const b = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: Math.round(b.left + 10), y: Math.round(b.top + 10) } })()`)
    wc.focus()
    wc.sendInputEvent({ type: 'mouseDown', x: r.x, y: r.y, button: 'left', clickCount: 1 })
    wc.sendInputEvent({ type: 'mouseUp', x: r.x, y: r.y, button: 'left', clickCount: 1 })
    await wait(800)
  }
  browser.passwords.save({ origin: base, username: 'bob', password: 'S3cret' })
  ctrl.navigate(`${base}/login`)
  await wait(1500)
  await clickInto(ctrl.tabs.active.wc, '#u')
  const leaked = await ctrl.tabs.active.wc.executeJavaScript('document.querySelector("#p").value')
  check('password autofill skips hidden password field', leaked === '', `value=${leaked}`)
  for (const variant of ['login3', 'login4', 'login5']) {
    ctrl.navigate(`${base}/${variant}`)
    await wait(1500)
    await clickInto(ctrl.tabs.active.wc, '#u')
    const v = await ctrl.tabs.active.wc.executeJavaScript('document.querySelector("#p").value')
    const label = { login3: 'near-transparent', login4: 'covered', login5: 'click-through covered' }[variant]
    check(`password autofill skips ${label} field`, v === '', `value=${v}`)
  }
  ctrl.navigate(`${base}/material`)
  await wait(1500)
  await clickInto(ctrl.tabs.active.wc, '#u')
  const material = await ctrl.tabs.active.wc.executeJavaScript('document.querySelector("#u").value + "|" + document.querySelector("#p").value')
  check('password autofill works with floating labels', material === 'bob|S3cret', material)
  ctrl.navigate(`${base}/login2`)
  await wait(1500)
  await clickInto(ctrl.tabs.active.wc, '#u')
  const creds = await ctrl.tabs.active.wc.executeJavaScript('document.querySelector("#u").value + "|" + document.querySelector("#p").value')
  check('password autofill fills visible login form', creds === 'bob|S3cret', creds)

  browser.addresses.save({ name: 'Levi Test', email: 'levi@test.de', city: 'Berlin', street: 'Hauptstr 1' })
  ctrl.navigate(`${base}/addr`)
  await wait(1500)
  await clickInto(ctrl.tabs.active.wc, '#email')
  const filled = await ctrl.tabs.active.wc.executeJavaScript('["email", "n", "city", "street"].map((id) => document.getElementById(id).value).join("|")')
  check('address autofill fills visible fields only', filled === 'levi@test.de|Levi Test||', filled)
  // ---- reader view
  ctrl.navigate(`${base}/article`)
  await wait(1500)
  ctrl.runAction('reader')
  await wait(2000)
  check('reader view opens', ctrl.tabs.active.url.startsWith('pulse://newtab/reader.html#'), ctrl.tabs.active.url)
  const reader = await ctrl.tabs.active.wc.executeJavaScript('({ title: document.querySelector("#title").textContent, paras: document.querySelectorAll("#body p").length, nav: document.body.textContent.includes("Impressum") })')
  check('reader view shows only the article', reader.title === 'Ein langer Testartikel' && reader.paras === 8 && !reader.nav, JSON.stringify(reader))
  await shot(ctrl, '10-reader')
  ctrl.runAction('reader')
  await wait(1500)
  check('reader view toggles back to original', ctrl.tabs.active.url === `${base}/article`, ctrl.tabs.active.url)

  // ---- picture in picture without a video gives a hint instead of failing
  const toasts = []
  ctrl.ui.on('console-message', () => {})
  await ctrl.ui.executeJavaScript('window.__toasts = []; new MutationObserver((m) => m.forEach((r) => r.addedNodes.forEach((n) => n.classList && n.classList.contains("toast") && window.__toasts.push(n.textContent)))).observe(document.body, { childList: true }); 1')
  await browser.togglePip(ctrl)
  await wait(300)
  toasts.push(...await ctrl.ui.executeJavaScript('window.__toasts'))
  check('picture-in-picture reports missing video', toasts.some((t) => t.includes('kein Video')), toasts.join('|'))

  // ---- password generator on a sign-up form
  ctrl.navigate(`${base}/signup`)
  await wait(1500)
  await clickInto(ctrl.tabs.active.wc, '#p1')
  await wait(400)
  check('generator offer appears for new-password field', await js('!document.querySelector("#infobar").hidden && document.querySelector("#infobar").textContent.includes("Sicheres Passwort")'))
  await js('[...document.querySelectorAll("#infobar .btn")].find((b) => b.textContent.includes("verwenden")).click()')
  await wait(800)
  const gen = await ctrl.tabs.active.wc.executeJavaScript('[document.querySelector("#p1").value, document.querySelector("#p2").value]')
  check('generated password fills both fields', gen[0].length === 18 && gen[0] === gen[1], `len=${gen[0].length}`)

  // ---- change-password form: current password stays untouched
  ctrl.navigate(`${base}/change`)
  await wait(1500)
  await clickInto(ctrl.tabs.active.wc, '#n')
  await wait(400)
  await js('[...document.querySelectorAll("#infobar .btn")].find((b) => b.textContent.includes("verwenden"))?.click()')
  await wait(800)
  const change = await ctrl.tabs.active.wc.executeJavaScript('["c", "n", "r"].map((id) => document.getElementById(id).value.length)')
  check('generator fills new + repeat, not current password', change.join(',') === '0,18,18', change.join(','))

  // ---- muted video shows the picture-in-picture button
  ctrl.navigate(`${base}/video`)
  await wait(2500)
  check('picture-in-picture button for muted video', !(await js('document.querySelector("#btn-pip").hidden')))

  // ---- private window: ad blocker works, generator shows the unsaved password
  const priv = browser.createWindow({ isPrivate: true, url: `${base}/signup` })
  await wait(3000)
  check('private window opens with ad blocker on', browser.adblock.blocker.isBlockingEnabled(priv.session) && browser.adblock.blocker.isBlockingEnabled(browser.mainSession))
  browser.fillGeneratedPassword(priv.tabs.active.wc, priv.tabs.active.wc.mainFrame.origin)
  await wait(600)
  check('private window shows generated password instead of losing it', await priv.ui.executeJavaScript('!document.querySelector("#infobar").hidden && !!document.querySelector("#infobar .gen-pw")'))
  priv.win.close()
  await wait(800)
  check('closing private window keeps blocking in main session', browser.adblock.blocker.isBlockingEnabled(browser.mainSession) && !browser.adblock.sessions.has(priv.session) && require('electron').ipcMain._invokeHandlers.has('@ghostery/adblocker/inject-cosmetic-filters'))

  // ---- page translation
  ctrl.runAction('translate-page')
  await wait(800)
  check('translate page goes through Google Translate', /translate\.(google\.com|goog)/.test(ctrl.tabs.active.url) || ctrl.tabs.active.wc.getURL().includes('translate'), ctrl.tabs.active.url)

  // ---- custom shortcuts
  browser.settings.update((st) => ({ ...st, shortcuts: { reader: ['Alt+R'] } }))
  const { matchShortcut } = require('../src/main/lib/shortcuts')
  check('custom shortcut is used', matchShortcut({ type: 'keyDown', key: 'r', alt: true, control: false, shift: false, meta: false }, browser.settings.get().shortcuts) === 'reader')
  browser.settings.update((st) => ({ ...st, shortcuts: {} }))
  server.close()

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
