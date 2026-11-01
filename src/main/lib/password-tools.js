'use strict'

const crypto = require('node:crypto')

// Password generator and password check (weak / reused / leaked).

const SETS = {
  lower: 'abcdefghijkmnopqrstuvwxyz', // no l (looks like 1/I)
  upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ', // no I, O
  digits: '23456789', // no 0, 1
  symbols: '!#$%&*+-=?@_~',
}

/**
 * Cryptographically random password containing every character class.
 * @param {{ length?: number, symbols?: boolean }} opts
 */
function generatePassword({ length = 18, symbols = true } = {}) {
  const len = Math.max(8, Math.min(64, Math.round(length)))
  const classes = [SETS.lower, SETS.upper, SETS.digits, ...(symbols ? [SETS.symbols] : [])]
  const all = classes.join('')
  const pick = (set) => set[crypto.randomInt(set.length)]
  const chars = [...classes.map(pick), ...Array.from({ length: len - classes.length }, () => pick(all))]
  // Fisher–Yates so the guaranteed characters aren't always at the start.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

const COMMON = new Set([
  '123456', '123456789', '12345678', 'password', 'passwort', 'qwerty', 'qwertz', '111111', '123123', 'abc123',
  'iloveyou', 'admin', 'welcome', 'hallo', 'hallo123', 'letmein', 'monkey', 'dragon', 'football', 'fussball',
  'master', 'sunshine', 'princess', 'shadow', 'baseball', 'superman', 'trustno1', 'schatz', 'geheim', '000000',
])

/**
 * Rough strength rating. Returns the reasons a password is weak ([] = ok).
 * @param {string} password
 * @param {string} [username]
 */
function weaknessOf(password, username = '') {
  const pw = String(password)
  const lower = pw.toLowerCase()
  const reasons = []
  if (COMMON.has(lower) || COMMON.has(lower.replace(/\d+$/, ''))) reasons.push('sehr häufig verwendet')
  if (pw.length < 10) reasons.push('kürzer als 10 Zeichen')
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z\d]/].filter((r) => r.test(pw)).length
  if (classes < 3 && pw.length < 16) reasons.push('zu wenig Zeichenarten')
  if (/^(.)\1+$/.test(pw) || /^(0123|1234|2345|3456|4567|5678|6789|abcd|qwer|asdf)/i.test(pw)) reasons.push('leicht zu erraten')
  const user = String(username).toLowerCase().split('@')[0]
  if (user.length >= 3 && lower.includes(user)) reasons.push('enthält den Benutzernamen')
  return reasons
}

/**
 * Finds weak and reused passwords.
 * @param {{id: string, origin: string, username: string, password: string}[]} entries
 * @returns {{id: string, origin: string, username: string, weak: string[], reusedWith: string[]}[]} only entries with problems
 */
function auditPasswords(entries) {
  const byPassword = new Map()
  for (const e of entries) byPassword.set(e.password, [...(byPassword.get(e.password) || []), e])
  return entries
    .map((e) => ({
      id: e.id, origin: e.origin, username: e.username,
      weak: weaknessOf(e.password, e.username),
      reusedWith: byPassword.get(e.password).filter((o) => o.id !== e.id).map((o) => (o.origin === e.origin ? `${o.origin} (${o.username || 'anderes Konto'})` : o.origin)),
    }))
    .filter((r) => r.weak.length || r.reusedWith.length)
}

/** SHA-1 split for the Have I Been Pwned k-anonymity range API. */
function hibpHash(password) {
  const sha1 = crypto.createHash('sha1').update(String(password), 'utf8').digest('hex').toUpperCase()
  return { prefix: sha1.slice(0, 5), suffix: sha1.slice(5) }
}

/** How often the suffix occurs in a range API response (0 = not leaked). */
function hibpCount(responseText, suffix) {
  for (const line of String(responseText).split(/\r?\n/)) {
    const [hash, count] = line.trim().split(':')
    if (hash === suffix) return Number(count) || 0
  }
  return 0
}

/**
 * Checks passwords against Have I Been Pwned. Only the first 5 characters
 * of each SHA-1 hash leave the computer; padding hides the response size.
 * @param {{id: string, password: string}[]} entries
 * @param {(url: string, init: object) => Promise<{ok: boolean, text: () => Promise<string>}>} fetchFn
 * @returns {Promise<Map<string, number>>} id -> leak count (only leaked ones)
 */
async function checkLeaks(entries, fetchFn) {
  const byPrefix = new Map()
  for (const e of entries) {
    const { prefix, suffix } = hibpHash(e.password)
    byPrefix.set(prefix, [...(byPrefix.get(prefix) || []), { id: e.id, suffix }])
  }
  const leaked = new Map()
  for (const [prefix, items] of byPrefix) {
    const res = await fetchFn(`https://api.pwnedpasswords.com/range/${prefix}`, { headers: { 'Add-Padding': 'true' } })
    if (!res.ok) throw new Error('Have I Been Pwned ist nicht erreichbar')
    const text = await res.text()
    for (const { id, suffix } of items) {
      const count = hibpCount(text, suffix)
      if (count > 0) leaked.set(id, count)
    }
  }
  return leaked
}

module.exports = { generatePassword, weaknessOf, auditPasswords, hibpHash, hibpCount, checkLeaks }
