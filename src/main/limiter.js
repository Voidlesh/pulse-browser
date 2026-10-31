'use strict'

const { app, session } = require('electron')
const { tabsToDiscard, tabsToThrottle, throttleRate } = require('./lib/limiter-policy')

const SAMPLE_INTERVAL_MS = 2000
const HISTORY_POINTS = 60

/**
 * "Control" panel backend: samples RAM/CPU per process, enforces RAM/CPU
 * limits on background tabs and applies a session-wide network limit.
 */
class ResourceLimiter {
  /**
   * @param {{ getSettings: () => object, getWindows: () => import('./window').BrowserWindowController[],
   *   onSample: (sample: object) => void }} deps
   */
  constructor(deps) {
    this.deps = deps
    this.history = []
    this.throttled = new Map() // webContents id -> rate
    this.timer = null
    this.lastWarning = 0
  }

  start() {
    this.applyNetworkLimit()
    this.timer = setInterval(() => this.tick().catch((err) => console.error('[limiter]', err)), SAMPLE_INTERVAL_MS)
  }

  stop() {
    clearInterval(this.timer)
  }

  applyNetworkLimit() {
    const { network } = this.deps.getSettings().limiter
    const sessions = [session.defaultSession, ...this.deps.getWindows().map((w) => w.session)]
    for (const ses of new Set(sessions)) {
      if (network.enabled && network.limitKbps > 0) {
        const bytesPerSecond = (network.limitKbps * 1024) / 8
        ses.enableNetworkEmulation({ latency: 0, downloadThroughput: bytesPerSecond, uploadThroughput: bytesPerSecond })
      } else {
        ses.disableNetworkEmulation()
      }
    }
  }

  async tick() {
    const metrics = app.getAppMetrics()
    const byPid = new Map(metrics.map((m) => [m.pid, m]))
    const totalMb = metrics.reduce((sum, m) => sum + m.memory.workingSetSize, 0) / 1024
    const totalCpu = metrics.reduce((sum, m) => sum + m.cpu.percentCPUUsage, 0)

    const tabs = []
    for (const win of this.deps.getWindows()) {
      for (const id of win.tabs.order) {
        const tab = win.tabs.tabs.get(id)
        const m = tab.wc && !tab.wc.isDestroyed() ? byPid.get(tab.wc.getOSProcessId()) : null
        tabs.push({
          id: tab.id, win, title: tab.title, url: tab.url, favicon: tab.favicon,
          active: win.tabs.activeId === tab.id && win.isFocusedOrVisible(),
          discarded: tab.discarded, audible: tab.audible, pinned: tab.pinned, lastActive: tab.lastActive,
          memoryMb: m ? m.memory.workingSetSize / 1024 : 0, cpu: m ? m.cpu.percentCPUUsage : 0,
        })
      }
    }

    const { limiter } = this.deps.getSettings()
    const actions = this.enforceRam(limiter.ram, tabs, totalMb)
    await this.enforceCpu(limiter.cpu, tabs, totalCpu)

    this.history = [...this.history, { t: Date.now(), ram: Math.round(totalMb), cpu: Math.round(totalCpu) }].slice(-HISTORY_POINTS)
    this.deps.onSample({
      totalMb: Math.round(totalMb), totalCpu: Math.round(totalCpu * 10) / 10,
      history: this.history, actions,
      tabs: tabs
        .map(({ win, ...t }) => ({ ...t, windowId: win.id, memoryMb: Math.round(t.memoryMb), cpu: Math.round(t.cpu * 10) / 10 }))
        .sort((a, b) => b.memoryMb + b.cpu * 20 - (a.memoryMb + a.cpu * 20)),
    })
  }

  enforceRam(ram, tabs, totalMb) {
    if (!ram.enabled || totalMb <= ram.limitMb) return []
    if (!ram.hard) {
      const now = Date.now()
      if (now - this.lastWarning < 60000) return []
      this.lastWarning = now
      return [{ type: 'ram-warning', totalMb: Math.round(totalMb), limitMb: ram.limitMb }]
    }
    return tabsToDiscard(tabs, totalMb, ram.limitMb)
      .map((id) => tabs.find((t) => t.id === id))
      .filter((t) => t.win.tabs.discard(t.id))
      .map((t) => ({ type: 'discarded', title: t.title }))
  }

  async enforceCpu(cpu, tabs, totalCpu) {
    const wanted = cpu.enabled ? tabsToThrottle(tabs, totalCpu, cpu.limitPercent) : new Set()
    const rate = throttleRate(totalCpu, cpu.limitPercent)
    for (const t of tabs) {
      const tab = t.win.tabs.tabs.get(t.id)
      if (!tab || !tab.wc || tab.wc.isDestroyed()) continue
      const current = this.throttled.get(tab.wc.id) || 1
      const target = wanted.has(t.id) ? rate : 1
      if (current !== target) await this.setCpuRate(tab.wc, target)
    }
  }

  async setCpuRate(wc, rate) {
    try {
      if (!wc.debugger.isAttached()) {
        if (rate === 1) return
        wc.debugger.attach('1.3')
        wc.once('destroyed', () => this.throttled.delete(wc.id))
      }
      await wc.debugger.sendCommand('Emulation.setCPUThrottlingRate', { rate })
      if (rate === 1) {
        this.throttled.delete(wc.id)
        wc.debugger.detach()
      } else {
        this.throttled.set(wc.id, rate)
      }
    } catch {
      // DevTools open or page navigating; try again on the next tick.
    }
  }
}

module.exports = { ResourceLimiter }
