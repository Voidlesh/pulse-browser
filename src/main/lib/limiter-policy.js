'use strict'

/**
 * Pure decision logic for the resource limiter (testable without Electron).
 *
 * @typedef {{ id: number, active: boolean, discarded: boolean, audible: boolean,
 *   pinned: boolean, lastActive: number, memoryMb: number, cpu: number }} TabSample
 */

/**
 * Which background tabs to discard so total RAM drops below the limit.
 * Least recently used first; never the active, audible or pinned tab.
 * @param {TabSample[]} tabs
 * @param {number} totalMb
 * @param {number} limitMb
 * @returns {number[]} tab ids
 */
function tabsToDiscard(tabs, totalMb, limitMb) {
  if (totalMb <= limitMb) return []
  const candidates = tabs
    .filter((t) => !t.active && !t.discarded && !t.audible && !t.pinned)
    .sort((a, b) => a.lastActive - b.lastActive)
  const picked = []
  let remaining = totalMb
  for (const tab of candidates) {
    if (remaining <= limitMb) break
    picked.push(tab.id)
    remaining -= tab.memoryMb
  }
  return picked
}

/**
 * Which tabs should be CPU-throttled. Background tabs are throttled while the
 * total CPU usage is above the limit; the active and audible tabs never are.
 * @param {TabSample[]} tabs
 * @param {number} totalCpu
 * @param {number} limitPercent
 * @returns {Set<number>}
 */
function tabsToThrottle(tabs, totalCpu, limitPercent) {
  if (totalCpu <= limitPercent) return new Set()
  return new Set(tabs.filter((t) => !t.active && !t.discarded && !t.audible).map((t) => t.id))
}

/** CDP throttling factor: heavier slowdown the further we are above the limit. */
function throttleRate(totalCpu, limitPercent) {
  if (limitPercent <= 0 || totalCpu <= limitPercent) return 1
  return Math.min(20, Math.max(2, Math.round((totalCpu / limitPercent) * 2)))
}

module.exports = { tabsToDiscard, tabsToThrottle, throttleRate }
