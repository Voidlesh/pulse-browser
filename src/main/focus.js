'use strict'

const { domain } = require('./lib/settings-schema')

/**
 * Focus mode: blocks distracting sites for a fixed time. Navigations to a
 * blocked domain (or its subdomains) are replaced with a calm block page.
 */
class FocusMode {
  /** @param {(state: object) => void} onChange */
  constructor(onChange) {
    this.onChange = onChange
    this.state = { active: false, endsAt: 0, blocklist: [] }
    this.timer = null
  }

  start(minutes, blocklist) {
    clearTimeout(this.timer)
    const endsAt = Date.now() + minutes * 60 * 1000
    this.state = { active: true, endsAt, minutes, blocklist: blocklist.map(domain).filter(Boolean) }
    this.timer = setTimeout(() => this.stop(true), endsAt - Date.now())
    this.onChange(this.state)
  }

  stop(finished = false) {
    clearTimeout(this.timer)
    this.state = { active: false, endsAt: 0, blocklist: [], finished }
    this.onChange(this.state)
  }

  /** @param {string} url */
  isBlocked(url) {
    if (!this.state.active) return false
    let host
    try {
      host = new URL(url).hostname.replace(/^www\./, '')
    } catch {
      return false
    }
    return this.state.blocklist.some((d) => host === d || host.endsWith(`.${d}`))
  }
}

module.exports = { FocusMode }
