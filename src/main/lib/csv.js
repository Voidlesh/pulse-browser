'use strict'

/**
 * RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF, newlines in quotes).
 * @param {string} text
 * @returns {string[][]}
 */
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  const src = String(text).replace(/^﻿/, '')

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i++ }
      else if (ch === '"') inQuotes = false
      else field += ch
    } else if (ch === '"') inQuotes = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(field); rows.push(row); row = []; field = ''
    } else field += ch
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.some((c) => c !== ''))
}

/** Parses a CSV with a header row into objects keyed by lower-case header names. */
function parseCsvObjects(text) {
  const [header, ...rows] = parseCsv(text)
  if (!header) return []
  const keys = header.map((h) => h.trim().toLowerCase())
  return rows.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ''])))
}

function toCsv(header, rows) {
  const esc = (v) => {
    const s = String(v ?? '')
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n'
}

module.exports = { parseCsv, parseCsvObjects, toCsv }
