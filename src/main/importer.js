'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { flattenBookmarks, chromeTimeToMs, newestVersion, isBrowserInternalExtension } = require('./lib/chromium-data')

const HISTORY_IMPORT_LIMIT = 20000

/** Known Chromium-family profile roots on Windows (Opera GX first). */
function candidateProfiles() {
  const roaming = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
  return [
    { name: 'Opera GX', dir: path.join(roaming, 'Opera Software', 'Opera GX Stable') },
    { name: 'Opera', dir: path.join(roaming, 'Opera Software', 'Opera Stable') },
    { name: 'Chrome', dir: path.join(local, 'Google', 'Chrome', 'User Data') },
    { name: 'Edge', dir: path.join(local, 'Microsoft', 'Edge', 'User Data') },
    { name: 'Brave', dir: path.join(local, 'BraveSoftware', 'Brave-Browser', 'User Data') },
  ]
    .map((p) => ({ ...p, profile: resolveProfileDir(p.dir) }))
    .filter((p) => p.profile)
}

/** Opera keeps data in "Default" (newer) or directly in the root (older). */
function resolveProfileDir(root) {
  for (const dir of [path.join(root, 'Default'), root]) {
    if (fs.existsSync(path.join(dir, 'Bookmarks')) || fs.existsSync(path.join(dir, 'History'))) return dir
  }
  return null
}

function readBookmarks(profileDir) {
  const file = path.join(profileDir, 'Bookmarks')
  if (!fs.existsSync(file)) return []
  return flattenBookmarks(JSON.parse(fs.readFileSync(file, 'utf8')))
}

/** Copies the (possibly locked) History DB to a temp file and reads it. */
function readHistory(profileDir) {
  const file = path.join(profileDir, 'History')
  if (!fs.existsSync(file)) return []
  const tmp = path.join(os.tmpdir(), `pulse-history-${process.pid}-${Date.now()}.db`)
  fs.copyFileSync(file, tmp)
  try {
    const { DatabaseSync } = require('node:sqlite')
    const db = new DatabaseSync(tmp, { readOnly: true })
    try {
      const rows = db.prepare(
        'SELECT url, title, last_visit_time FROM urls WHERE hidden = 0 ORDER BY last_visit_time DESC LIMIT ?',
      ).all(HISTORY_IMPORT_LIMIT)
      return rows.map((r) => ({ url: r.url, title: r.title || r.url, time: chromeTimeToMs(r.last_visit_time) }))
    } finally {
      db.close()
    }
  } finally {
    fs.rmSync(tmp, { force: true })
  }
}

/**
 * Copies unpacked extensions (newest version each) into our own folder.
 * @returns {string[]} copied extension directories
 */
function copyExtensions(profileDir, targetDir, skipIds = new Set()) {
  const source = path.join(profileDir, 'Extensions')
  if (!fs.existsSync(source)) return []
  fs.mkdirSync(targetDir, { recursive: true })
  const copied = []
  for (const id of fs.readdirSync(source)) {
    if (!/^[a-p]{32}$/.test(id) || skipIds.has(id)) continue
    const versions = fs.readdirSync(path.join(source, id)).filter((v) => fs.existsSync(path.join(source, id, v, 'manifest.json')))
    const version = newestVersion(versions)
    if (!version) continue
    if (isBrowserInternalExtension(readManifest(path.join(source, id, version)))) continue
    const dest = path.join(targetDir, id)
    fs.rmSync(dest, { recursive: true, force: true })
    // Chromium refuses to load unpacked extensions that still carry the store signature folder.
    fs.cpSync(path.join(source, id, version), dest, { recursive: true, filter: (src) => path.basename(src) !== '_metadata' })
    copied.push(dest)
  }
  return copied
}

function readManifest(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8').replace(/^﻿/, ''))
  } catch {
    return {}
  }
}

module.exports = { readManifest, candidateProfiles, readBookmarks, readHistory, copyExtensions }
