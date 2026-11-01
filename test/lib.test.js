'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { resolveInput, originOf, displayUrl, NEW_TAB_URL } = require('../src/main/lib/urls')
const { parseCsv, parseCsvObjects, toCsv } = require('../src/main/lib/csv')
const { flattenBookmarks, chromeTimeToMs, newestVersion, isBrowserInternalExtension } = require('../src/main/lib/chromium-data')
const { tabsToDiscard, tabsToThrottle, throttleRate } = require('../src/main/lib/limiter-policy')
const { matchShortcut } = require('../src/main/lib/shortcuts')
const { JsonStore, mergeDefaults } = require('../src/main/store')

const { pickIconCandidates, parseManifestIcons } = require('../src/main/lib/icon-candidates')

const SEARCH = 'https://search.test/?q=%s'

test('pickIconCandidates prefers big apple-touch and svg icons over tiny favicons', () => {
  const html = `<head><base href="/app/">
    <link rel="icon" href="favicon-16.png" sizes="16x16">
    <link rel='apple-touch-icon' href='/apple.png'>
    <link rel="icon" type="image/svg+xml" href="logo.svg?v=2&amp;x=1">
    <link rel="mask-icon" href="mask.svg">
    <link rel="manifest" href="/site.webmanifest">
    <link rel="icon" href="javascript:alert(1)">`
  const { icons, manifest } = pickIconCandidates(html, 'https://ex.com/start')
  const best = [...icons].sort((a, b) => b.score - a.score).map((i) => i.url)
  assert.deepEqual(best, ['https://ex.com/app/logo.svg?v=2&x=1', 'https://ex.com/apple.png', 'https://ex.com/app/favicon-16.png'])
  assert.equal(manifest, 'https://ex.com/site.webmanifest')
})

test('parseManifestIcons ranks large non-maskable icons', () => {
  const icons = parseManifestIcons({ icons: [
    { src: 'i-192.png', sizes: '192x192' },
    { src: 'i-512.png', sizes: '512x512', purpose: 'maskable' },
    { src: 'mono.png', sizes: '512x512', purpose: 'monochrome' },
  ] }, 'https://ex.com/m/manifest.json')
  const best = [...icons].sort((a, b) => b.score - a.score)[0]
  assert.equal(best.url, 'https://ex.com/m/i-192.png')
  assert.equal(icons.length, 2)
})

test('resolveInput: URLs, hosts, localhost and searches', () => {
  assert.equal(resolveInput('https://example.com/a', SEARCH), 'https://example.com/a')
  assert.equal(resolveInput('example.com', SEARCH), 'https://example.com/')
  assert.equal(resolveInput('sub.example.co.uk/path?x=1', SEARCH), 'https://sub.example.co.uk/path?x=1')
  assert.equal(resolveInput('localhost:3000', SEARCH), 'http://localhost:3000/')
  assert.equal(resolveInput('192.168.0.1', SEARCH), 'http://192.168.0.1/')
  assert.equal(resolveInput('wie spät ist es', SEARCH), 'https://search.test/?q=wie%20sp%C3%A4t%20ist%20es')
  assert.equal(resolveInput('katzen', SEARCH), 'https://search.test/?q=katzen')
  assert.equal(resolveInput('', SEARCH), NEW_TAB_URL)
})

test('resolveInput: refuses dangerous schemes', () => {
  assert.equal(resolveInput('javascript:alert(1)', SEARCH), 'https://search.test/?q=javascript%3Aalert(1)')
  assert.match(resolveInput('data:text/html,<b>x</b>', SEARCH), /^https:\/\/search\.test/)
})

test('originOf and displayUrl', () => {
  assert.equal(originOf('https://a.b.com/x?y'), 'https://a.b.com')
  assert.equal(originOf('not a url'), '')
  assert.equal(originOf('data:text/plain,x'), '')
  assert.equal(displayUrl(NEW_TAB_URL), '')
  assert.equal(displayUrl('https://x.de/'), 'https://x.de/')
})

test('CSV: quotes, commas, newlines and BOM round-trip', () => {
  const text = '﻿name,url,username,password\r\n"a, b",https://a.com,"user ""x""","line1\nline2"\r\n\r\n'
  assert.deepEqual(parseCsv(text), [['name', 'url', 'username', 'password'], ['a, b', 'https://a.com', 'user "x"', 'line1\nline2']])
  const [obj] = parseCsvObjects(text)
  assert.equal(obj.password, 'line1\nline2')
  const back = parseCsv(toCsv(['a', 'b'], [['x,y', 'q"z']]))
  assert.deepEqual(back, [['a', 'b'], ['x,y', 'q"z']])
})

test('flattenBookmarks keeps folder paths and skips non-http urls', () => {
  const json = {
    roots: {
      bookmark_bar: { name: 'Bar', children: [
        { type: 'url', name: 'Site', url: 'https://site.com/', date_added: '13300000000000000' },
        { type: 'folder', name: 'Games', children: [{ type: 'url', name: 'Steam', url: 'https://store.steampowered.com/' }] },
        { type: 'url', name: 'Bad', url: 'javascript:void(0)' },
      ] },
      other: { name: 'Andere', children: [{ type: 'url', name: 'O', url: 'http://o.org/' }] },
    },
  }
  const out = flattenBookmarks(json)
  assert.deepEqual(out.map((b) => [b.folder, b.url]), [
    ['Lesezeichenleiste', 'https://site.com/'],
    ['Lesezeichenleiste/Games', 'https://store.steampowered.com/'],
    ['Andere', 'http://o.org/'],
  ])
  assert.ok(out[0].added > Date.UTC(2020, 0, 1))
  assert.equal(chromeTimeToMs(0), 0)
})

test('newestVersion compares numerically', () => {
  assert.equal(newestVersion(['1.9.0_0', '1.10.2_0', '1.10.1_0']), '1.10.2_0')
  assert.equal(newestVersion([]), undefined)
})

test('isBrowserInternalExtension detects Opera-only components', () => {
  assert.equal(isBrowserInternalExtension({ permissions: ['storage', 'operaBrowserPrivate'] }), true)
  assert.equal(isBrowserInternalExtension({ permissions: ['storage', 'tabs', { origins: [] }] }), false)
  assert.equal(isBrowserInternalExtension({}), false)
})

const tab = (id, extra) => ({ id, active: false, discarded: false, audible: false, pinned: false, lastActive: id, memoryMb: 300, cpu: 5, ...extra })

test('tabsToDiscard frees least-recently-used background tabs only', () => {
  const tabs = [tab(1, { active: true }), tab(2), tab(3, { audible: true }), tab(4), tab(5, { pinned: true })]
  assert.deepEqual(tabsToDiscard(tabs, 1000, 2000), [])
  assert.deepEqual(tabsToDiscard(tabs, 2200, 2000), [2])
  assert.deepEqual(tabsToDiscard(tabs, 2500, 2000), [2, 4])
  assert.deepEqual(tabsToDiscard(tabs, 9000, 2000), [2, 4])
})

test('tabsToThrottle and throttleRate', () => {
  const tabs = [tab(1, { active: true }), tab(2), tab(3, { audible: true })]
  assert.deepEqual([...tabsToThrottle(tabs, 40, 50)], [])
  assert.deepEqual([...tabsToThrottle(tabs, 80, 50)], [2])
  assert.equal(throttleRate(40, 50), 1)
  assert.equal(throttleRate(100, 50), 4)
  assert.equal(throttleRate(5000, 50), 20)
})

test('matchShortcut maps common browser keys', () => {
  const k = (key, mods = {}) => matchShortcut({ type: 'keyDown', key, control: false, shift: false, alt: false, meta: false, ...mods })
  assert.equal(k('t', { control: true }), 'new-tab')
  assert.equal(k('T', { control: true, shift: true }), 'reopen-tab')
  assert.equal(k('3', { control: true }), 'tab-3')
  assert.equal(k('k', { control: true }), 'palette')
  assert.equal(k('S', { control: true, shift: true }), 'snapshot')
  assert.equal(k('E', { control: true, shift: true }), 'easy-setup')
  assert.equal(k('ArrowLeft', { alt: true }), 'back')
  assert.equal(k('F5'), 'reload')
  assert.equal(k('a'), null)
  assert.equal(matchShortcut({ type: 'keyUp', key: 't', control: true }), null)
})

test('JsonStore persists immutable updates and merges new defaults', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-test-'))
  const file = path.join(dir, 's.json')
  const store = new JsonStore(file, { a: 1, nested: { x: 1 } })
  const before = store.get()
  store.update((s) => ({ ...s, a: 2 }))
  assert.equal(before.a, 1)
  store.flush()
  const reloaded = new JsonStore(file, { a: 1, b: 'neu', nested: { x: 1, y: 2 } })
  assert.deepEqual(reloaded.get(), { a: 2, b: 'neu', nested: { x: 1, y: 2 } })
  assert.deepEqual(mergeDefaults({ list: [1] }, { list: [] }), { list: [] })
  fs.rmSync(dir, { recursive: true, force: true })
})

// ---------------------------------------------------------------- 1.2
const { validatePatch, searchTemplateFor } = require('../src/main/lib/settings-schema')
const { topSites } = require('../src/main/lib/top-sites')
const { noteKey, Notes } = require('../src/main/notes')
const { FocusMode } = require('../src/main/focus')
const { DEFAULT_SETTINGS } = require('../src/main/defaults')

test('validatePatch keeps valid keys, drops garbage and clamps numbers', () => {
  const out = validatePatch({
    startup: 'pages', startupPages: ['https://a.test/', 'javascript:alert(1)', 'https://a.test/'], searchEngine: 'evil',
    defaultZoom: 999, uiSoundVolume: -5, focusBlocklist: ['https://www.YouTube.com/watch', 'nope'], unknownKey: 1,
    clearOnExit: { cache: 1, cookies: 0 }, homepage: 'file:///etc/passwd', autoSleepMinutes: 7,
  }, DEFAULT_SETTINGS)
  assert.deepEqual(out, {
    startup: 'pages', startupPages: ['https://a.test/'], defaultZoom: 200, uiSoundVolume: 0,
    focusBlocklist: ['youtube.com'], clearOnExit: { cache: true, cookies: false, history: false, downloads: false },
  })
  assert.equal(validatePatch({ homepage: '' }, DEFAULT_SETTINGS).homepage, '')
})

test('custom search needs %s and a web URL', () => {
  assert.equal(validatePatch({ customSearch: { name: 'X', url: 'https://x.test/?q=%s' } }, DEFAULT_SETTINGS).customSearch.url, 'https://x.test/?q=%s')
  assert.equal(validatePatch({ customSearch: { name: 'X', url: 'https://x.test/' } }, DEFAULT_SETTINGS).customSearch, undefined)
  assert.equal(searchTemplateFor({ searchEngine: 'custom', customSearch: { url: 'https://x.test/?q=%s' } }), 'https://x.test/?q=%s')
  assert.equal(searchTemplateFor({ searchEngine: 'duckduckgo' }), 'https://duckduckgo.com/?q=%s')
  assert.equal(searchTemplateFor({ searchEngine: 'custom', customSearch: { url: '' } }), 'https://www.google.com/search?q=%s')
})

test('topSites ranks by frecency and skips speed dial, hidden and old entries', () => {
  const now = Date.UTC(2026, 10, 1)
  const day = 86400000
  const history = [
    { url: 'https://news.test/a', title: 'Artikel – News', time: now - 1000 },
    { url: 'https://news.test/', title: 'News', time: now - 2000 },
    { url: 'https://old.test/', title: 'Old', time: now - 120 * day },
    { url: 'https://dial.test/x', title: 'Dial', time: now - 10 },
    { url: 'https://hidden.test/', title: 'Hidden', time: now - 10 },
    { url: 'https://once.test/', title: 'Once', time: now - 10 * day },
    { url: 'pulse://newtab/', title: 'x', time: now },
  ]
  const out = topSites(history, { exclude: ['https://dial.test/'], hidden: ['https://hidden.test/'], now })
  assert.deepEqual(out.map((s) => s.url), ['https://news.test/', 'https://once.test/'])
  assert.equal(out[0].title, 'News')
})

test('notes are keyed per page and empty text deletes', () => {
  assert.equal(noteKey('https://ex.test/a/?q=1#x'), 'https://ex.test/a')
  assert.equal(noteKey('https://ex.test'), 'https://ex.test/')
  assert.equal(noteKey('pulse://newtab/'), '')
  const notes = new Notes(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-notes-')), 'notes.json'))
  notes.set('https://ex.test/a?x', 'A', 'Hallo')
  assert.equal(notes.get('https://ex.test/a#y').text, 'Hallo')
  notes.set('https://ex.test/a', 'A', '   ')
  assert.equal(notes.has('https://ex.test/a'), false)
  assert.throws(() => notes.set('file:///x', '', 'x'))
})

test('focus mode blocks listed domains and subdomains only while active', () => {
  const states = []
  const focus = new FocusMode((s) => states.push(s))
  assert.equal(focus.isBlocked('https://youtube.com/'), false)
  focus.start(25, ['YouTube.com', 'x.com'])
  assert.equal(focus.isBlocked('https://www.youtube.com/watch?v=1'), true)
  assert.equal(focus.isBlocked('https://m.youtube.com/'), true)
  assert.equal(focus.isBlocked('https://notyoutube.com/'), false)
  assert.equal(focus.isBlocked('https://box.com/'), false)
  focus.stop()
  assert.equal(focus.isBlocked('https://youtube.com/'), false)
  assert.equal(states.length, 2)
})

test('Alt+P opens settings', () => {
  assert.equal(matchShortcut({ type: 'keyDown', key: 'p', control: false, shift: false, alt: true, meta: false }), 'settings')
})

// ---------------------------------------------------------------- 1.3
const { validateShortcuts, shortcutTable, comboOf } = require('../src/main/lib/shortcuts')
const { generatePassword, weaknessOf, auditPasswords, hibpHash, hibpCount, checkLeaks } = require('../src/main/lib/password-tools')
const { textTranslateUrl, pageTranslateUrl, deeplEndpoint, translateWithDeepl } = require('../src/main/lib/translate')
const { sanitizeArticle } = require('../src/main/lib/reader')

test('custom shortcuts override defaults and can be switched off', () => {
  const key = (k, mods = {}) => ({ type: 'keyDown', key: k, control: false, shift: false, alt: false, meta: false, ...mods })
  const overrides = { reader: ['Alt+R'], 'new-tab': [] }
  assert.equal(matchShortcut(key('r', { alt: true }), overrides), 'reader')
  assert.equal(matchShortcut(key('F9'), overrides), null)
  assert.equal(matchShortcut(key('t', { control: true }), overrides), null)
  assert.equal(matchShortcut(key('F9')), 'reader')
  assert.equal(matchShortcut(key('3', { control: true }), { 'tab-3': [] }), 'tab-3') // fixed keys stay
  assert.equal(comboOf(key('Control', { control: true })), '')
  assert.equal(comboOf(key('ArrowLeft', { alt: true, shift: true })), 'Alt+Shift+ArrowLeft')
})

test('validateShortcuts drops unknown actions, fixed keys and junk', () => {
  assert.deepEqual(validateShortcuts({ reader: ['Alt+R', 'Alt+R', 'bad combo', 'Ctrl+Shift+X', 'F2'], 'tab-1': ['Alt+1'], evil: ['Ctrl+Q'] }),
    { reader: ['Alt+R', 'Ctrl+Shift+X', 'F2'] })
  assert.equal(validateShortcuts('x'), undefined)
  const row = shortcutTable({ reader: ['Alt+R'] }).find((s) => s.action === 'reader')
  assert.deepEqual(row.combos, ['Alt+R'])
  assert.deepEqual(row.defaults, ['F9'])
})

test('generated passwords are long, varied and random', () => {
  const a = generatePassword()
  assert.equal(a.length, 18)
  assert.match(a, /[a-z]/)
  assert.match(a, /[A-Z]/)
  assert.match(a, /\d/)
  assert.match(a, /[^a-zA-Z\d]/)
  assert.notEqual(a, generatePassword())
  assert.doesNotMatch(generatePassword({ length: 12, symbols: false }), /[^a-zA-Z\d]/)
  assert.equal(generatePassword({ length: 3 }).length, 8)
  assert.deepEqual(weaknessOf(a), [])
})

test('password audit finds weak and reused passwords', () => {
  assert.ok(weaknessOf('hallo123').includes('sehr häufig verwendet'))
  assert.ok(weaknessOf('levi2024!', 'levi@mail.de').includes('enthält den Benutzernamen'))
  const issues = auditPasswords([
    { id: '1', origin: 'https://a.test', username: 'x', password: 'Gl3ich!Gl3ich!Gl3ich' },
    { id: '2', origin: 'https://b.test', username: 'x', password: 'Gl3ich!Gl3ich!Gl3ich' },
    { id: '3', origin: 'https://c.test', username: 'x', password: 'qwertz' },
    { id: '4', origin: 'https://d.test', username: 'x', password: 'v9#Kd2!pQz7&mW4x' },
  ])
  assert.deepEqual(issues.map((i) => i.id), ['1', '2', '3'])
  assert.deepEqual(issues[0].reusedWith, ['https://b.test'])
})

test('leak check only sends hash prefixes and parses counts', async () => {
  const { prefix, suffix } = hibpHash('password')
  assert.equal(prefix, '5BAA6')
  assert.equal(suffix, '1E4C9B93F3F0682250B6CF8331B7EE68FD8')
  assert.equal(hibpCount(`0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n${suffix}:9545824\r\n`, suffix), 9545824)
  const urls = []
  const fake = async (url) => { urls.push(url); return { ok: true, text: async () => `${suffix}:42\nAAAA:0` } }
  const leaked = await checkLeaks([{ id: 'a', password: 'password' }, { id: 'b', password: 'n0t-l3aked-xyz' }], fake)
  assert.deepEqual([...leaked], [['a', 42]])
  assert.ok(urls.every((u) => /^https:\/\/api\.pwnedpasswords\.com\/range\/[0-9A-F]{5}$/.test(u)))
})

test('translation urls and DeepL request', async () => {
  assert.equal(textTranslateUrl('Hallo Welt', 'en'), 'https://translate.google.com/?sl=auto&tl=en&text=Hallo+Welt&op=translate')
  assert.equal(pageTranslateUrl('https://ex.test/a?b=1', 'de'), 'https://translate.google.com/translate?sl=auto&tl=de&u=https%3A%2F%2Fex.test%2Fa%3Fb%3D1')
  assert.throws(() => pageTranslateUrl('file:///x', 'de'))
  assert.equal(deeplEndpoint('abc:fx'), 'https://api-free.deepl.com/v2/translate')
  assert.equal(deeplEndpoint('abc'), 'https://api.deepl.com/v2/translate')
  let sent = null
  const fake = async (url, init) => { sent = { url, init }; return { ok: true, status: 200, json: async () => ({ translations: [{ text: 'Hello', detected_source_language: 'DE' }] }) } }
  assert.deepEqual(await translateWithDeepl('Hallo', 'en', 'k:fx', fake), { text: 'Hello', detected: 'de' })
  assert.equal(sent.init.headers.Authorization, 'DeepL-Auth-Key k:fx')
  assert.deepEqual(JSON.parse(sent.init.body), { text: ['Hallo'], target_lang: 'EN' })
  await assert.rejects(translateWithDeepl('x', 'en', 'k', async () => ({ ok: false, status: 403 })), /ungültig/)
})

test('reader article is reduced to safe text blocks', () => {
  const raw = {
    title: '  Titel ', byline: 'Autor', site: 'Seite',
    blocks: [
      { type: 'p', text: 'Erster   Absatz mit Text.' }, { type: 'script', text: 'alert(1)' },
      { type: 'img', src: 'javascript:alert(1)' }, { type: 'img', src: '/bild.jpg', text: 'Bild' },
      { type: 'p', text: 'Zweiter Absatz.' }, { type: 'p', text: 'Zweiter Absatz.' }, { type: 'h2', text: '<b>Zwischentitel</b>' },
    ],
  }
  const a = sanitizeArticle(raw, 'https://ex.test/artikel')
  assert.equal(a.title, 'Titel')
  assert.deepEqual(a.blocks.map((b) => b.type), ['p', 'img', 'p', 'h2'])
  assert.equal(a.blocks[0].text, 'Erster Absatz mit Text.')
  assert.equal(a.blocks[1].src, 'https://ex.test/bild.jpg')
  assert.equal(a.blocks[3].text, '<b>Zwischentitel</b>') // shown as text, never as HTML
  assert.equal(sanitizeArticle({ blocks: [{ type: 'p', text: 'nur einer' }] }, 'https://ex.test'), null)
  assert.equal(sanitizeArticle(null, 'https://ex.test'), null)
})

test('reader does not repeat the headline', () => {
  const a = sanitizeArticle({ title: 'Titel', blocks: [{ type: 'h2', text: 'Titel' }, { type: 'p', text: 'Eins.' }, { type: 'p', text: 'Zwei.' }] }, 'https://ex.test')
  assert.deepEqual(a.blocks.map((b) => b.type), ['p', 'p'])
})

test('shortcut review fixes: safe combos only, Shift+F-keys, menu accelerators, same-site reuse', () => {
  const { acceleratorFor } = require('../src/main/lib/shortcuts')
  assert.deepEqual(validateShortcuts({ reload: ['Shift+A', 'Escape', 'A', 'Alt+R', 'Ctrl+Shift+Y', 'Shift+F3', 'Ctrl++'] }), { reload: ['Alt+R', 'Ctrl+Shift+Y', 'Shift+F3'].concat([]).slice(0, 3) })
  const key = (k, mods = {}) => ({ type: 'keyDown', key: k, control: false, shift: false, alt: false, meta: false, ...mods })
  assert.equal(matchShortcut(key('F5', { shift: true })), 'reload')
  assert.equal(matchShortcut(key('F11', { shift: true })), 'fullscreen')
  assert.equal(matchShortcut(key('Escape', { shift: true })), 'escape')
  assert.equal(acceleratorFor('zoom-in'), 'Ctrl+Plus')
  assert.equal(acceleratorFor('back'), 'Alt+Left')
  assert.equal(acceleratorFor('new-tab', { 'new-tab': [] }), '')
  const issues = auditPasswords([
    { id: '1', origin: 'https://a.test', username: 'x', password: 'v9#Kd2!pQz7&mW4x' },
    { id: '2', origin: 'https://a.test', username: 'y', password: 'v9#Kd2!pQz7&mW4x' },
  ])
  assert.deepEqual(issues.map((i) => i.reusedWith), [['https://a.test (y)'], ['https://a.test (x)']])
})

test('shortcut validation keeps hardware back/forward keys and protects fixed keys', () => {
  assert.deepEqual(validateShortcuts({ back: ['BrowserBack', 'Alt+ArrowLeft'], reload: ['Ctrl+1', 'Ctrl+Alt+1', 'Escape'] }),
    { back: ['BrowserBack', 'Alt+ArrowLeft'], reload: ['Ctrl+Alt+1'] })
})
