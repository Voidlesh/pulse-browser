'use strict'

const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, protocol, net, session } = require('electron')
const { Browser } = require('./browser')
const { registerIpc } = require('./ipc')

app.setName('Pulse')
app.setAppUserModelId('dev.pulse.browser')

// Present as plain Chrome so sites (WhatsApp Web, Google login …) don't block us.
app.userAgentFallback = app.userAgentFallback.replace(/ (Electron|pulse-browser|Pulse)\/\S+/g, '')

protocol.registerSchemesAsPrivileged([
  { scheme: 'pulse', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false } },
])

const ROOTS = {
  app: path.join(__dirname, '..', 'ui'),
  newtab: path.join(__dirname, '..', 'pages', 'newtab'),
}

const SHARED_ROOT = path.join(__dirname, '..', 'shared')

const protocolSessions = new WeakSet()

function registerInternalProtocol(ses) {
  if (protocolSessions.has(ses)) return
  protocolSessions.add(ses)
  ses.protocol.handle('pulse', (request) => {
    const url = new URL(request.url)
    if (!Object.hasOwn(ROOTS, url.hostname)) return new Response('Nicht gefunden', { status: 404 })
    // Modules shared by all internal pages (effects, themes) are served same-origin under /shared/.
    const shared = url.pathname.startsWith('/shared/')
    const root = shared ? SHARED_ROOT : ROOTS[url.hostname]
    const rel = decodeURIComponent(shared ? url.pathname.slice('/shared'.length) : url.pathname === '/' ? '/index.html' : url.pathname)
    const file = path.resolve(root, `.${rel}`)
    if (!file.startsWith(root + path.sep)) return new Response('Verboten', { status: 403 })
    return net.fetch(pathToFileURL(file).href)
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  let browser = null

  app.on('second-instance', (_event, argv) => {
    if (!browser) return
    const url = argv.find((a) => /^https?:\/\//.test(a))
    const ctrl = browser.focusedWindow()
    if (ctrl) {
      if (url) ctrl.newTab(url)
      if (ctrl.win.isMinimized()) ctrl.win.restore()
      ctrl.win.focus()
    } else {
      browser.createWindow({ url })
    }
  })

  app.on('session-created', (ses) => registerInternalProtocol(ses))

  app.whenReady().then(async () => {
    registerInternalProtocol(session.defaultSession)
    browser = new Browser()
    global.__pulse = browser
    registerIpc(browser)
    await browser.init()

    const startUrl = process.argv.slice(1).find((a) => /^https?:\/\//.test(a))
    if (startUrl) browser.createWindow({ url: startUrl })
    else if (process.env.PULSE_NO_RESTORE) browser.createWindow()
    else browser.restoreOrCreate()

    app.on('activate', () => browser.windows.size === 0 && browser.createWindow())
  }).catch((err) => {
    console.error('[pulse] Start fehlgeschlagen:', err)
    app.exit(1)
  })

  app.on('before-quit', () => browser && browser.shutdown())
  app.on('window-all-closed', () => app.quit())
}
