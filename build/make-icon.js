'use strict'

// Renders build/icon.png (512x512) with Electron: `npx electron build/make-icon.js`.
// electron-builder turns it into the Windows .ico.
const fs = require('node:fs')
const path = require('node:path')
const { app, BrowserWindow } = require('electron')

const SIZE = 512
const html = `<!doctype html><html><body style="margin:0;background:transparent">
<canvas id="c" width="${SIZE}" height="${SIZE}"></canvas>
<script>
  const c = document.getElementById('c').getContext('2d')
  const r = 112
  c.beginPath(); c.roundRect(16, 16, ${SIZE - 32}, ${SIZE - 32}, r)
  const bg = c.createLinearGradient(0, 0, ${SIZE}, ${SIZE})
  bg.addColorStop(0, '#2a1022'); bg.addColorStop(1, '#0d0b12')
  c.fillStyle = bg; c.fill()
  c.lineWidth = 10; c.strokeStyle = '#fa1e4e'; c.shadowColor = '#fa1e4e'; c.shadowBlur = 30; c.stroke()
  c.shadowBlur = 50
  c.fillStyle = '#fa1e4e'
  c.font = '800 330px "Segoe UI", sans-serif'
  c.textAlign = 'center'; c.textBaseline = 'middle'
  c.fillText('P', ${SIZE / 2 + 6}, ${SIZE / 2 + 16})
</script></body></html>`

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: SIZE, height: SIZE, show: false, transparent: true, frame: false, useContentSize: true })
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  await new Promise((r) => setTimeout(r, 300))
  const dataUrl = await win.webContents.executeJavaScript('document.getElementById("c").toDataURL("image/png")')
  fs.writeFileSync(path.join(__dirname, 'icon.png'), Buffer.from(dataUrl.split(',')[1], 'base64'))
  app.quit()
})
