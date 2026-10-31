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

const SEARCH = 'https://search.test/?q=%s'

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
