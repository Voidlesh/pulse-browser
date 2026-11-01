'use strict'

// Translation: without an API key Pulse uses Google Translate's web pages;
// with a DeepL key, selected text is translated right inside Pulse.

const LANGUAGES = {
  de: 'Deutsch', en: 'Englisch', fr: 'Französisch', es: 'Spanisch', it: 'Italienisch', nl: 'Niederländisch',
  pl: 'Polnisch', pt: 'Portugiesisch', ru: 'Russisch', tr: 'Türkisch', uk: 'Ukrainisch', ja: 'Japanisch', zh: 'Chinesisch',
}

const MAX_TEXT = 5000

/** Google Translate page for a piece of text. */
function textTranslateUrl(text, target) {
  const params = new URLSearchParams({ sl: 'auto', tl: target, text: String(text).slice(0, MAX_TEXT), op: 'translate' })
  return `https://translate.google.com/?${params}`
}

/** Whole web page translated through Google's translation proxy (http/https only). */
function pageTranslateUrl(url, target) {
  const parsed = new URL(url)
  if (!/^https?:$/.test(parsed.protocol)) throw new Error('Nur Webseiten können übersetzt werden')
  const params = new URLSearchParams({ sl: 'auto', tl: target, u: parsed.href })
  return `https://translate.google.com/translate?${params}`
}

/** DeepL API endpoint: free keys end with ":fx". */
function deeplEndpoint(key) {
  return String(key).trim().endsWith(':fx') ? 'https://api-free.deepl.com/v2/translate' : 'https://api.deepl.com/v2/translate'
}

/**
 * Translates text with DeepL.
 * @returns {Promise<{text: string, detected: string}>}
 */
async function translateWithDeepl(text, target, key, fetchFn) {
  const res = await fetchFn(deeplEndpoint(key), {
    method: 'POST',
    headers: { Authorization: `DeepL-Auth-Key ${String(key).trim()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: [String(text).slice(0, MAX_TEXT)], target_lang: target.toUpperCase() }),
  })
  if (res.status === 403) throw new Error('DeepL-Schlüssel ungültig')
  if (res.status === 456) throw new Error('DeepL-Kontingent für diesen Monat aufgebraucht')
  if (!res.ok) throw new Error(`DeepL-Fehler ${res.status}`)
  const data = await res.json()
  const first = data.translations && data.translations[0]
  if (!first) throw new Error('Keine Übersetzung erhalten')
  return { text: first.text, detected: String(first.detected_source_language || '').toLowerCase() }
}

module.exports = { LANGUAGES, textTranslateUrl, pageTranslateUrl, deeplEndpoint, translateWithDeepl, MAX_TEXT }
