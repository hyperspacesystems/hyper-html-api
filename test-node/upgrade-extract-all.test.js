import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as cheerio from 'cheerio'

import { extractAllFrom } from '../src/upgrade/extract-all.js'
import { collectRulesTags, normalizeName } from '../src/upgrade/rules-tags.js'
import { UnknownRulesVersion } from '../src/engine/errors.js'
import cheerioAdapter from '../src/adapters/cheerio.js'

function load(html) {
  return cheerio.load(html)
}

function captureWarn(fn) {
  const original = console.warn
  const calls = []
  console.warn = (...args) => calls.push(args)
  try {
    return { result: fn(), calls }
  } finally {
    console.warn = original
  }
}

const API_TAG =
  '<script data-rules-name="api" data-rules-version="1">{"title":"h1"}</script>'
const SETTINGS_TAG =
  '<script data-rules-name="settings" data-rules-version="1">{"owner":".owner"}</script>'

test('extractAllFrom: one entry per rules tag, keyed by name', () => {
  const $ = load(`${API_TAG}${SETTINGS_TAG}<h1>Hello</h1><div class="owner">David</div>`)
  const data = extractAllFrom(cheerioAdapter, $.root())
  assert.deepEqual(data, {
    api: { title: 'Hello' },
    settings: { owner: 'David' },
  })
})

test('extractAllFrom: zero tags yields an empty map', () => {
  const $ = load('<h1>Hello</h1>')
  assert.deepEqual(extractAllFrom(cheerioAdapter, $.root()), {})
})

test('collectRulesTags: duplicate name warns and keeps the first', () => {
  const $ = load(
    '<script data-rules-name="api" data-rules-version="1">{"title":"h1"}</script>' +
      '<script data-rules-name="api" data-rules-version="1">{"title":".other"}</script>',
  )
  const { result, calls } = captureWarn(() => collectRulesTags(cheerioAdapter, $.root()))
  assert.equal(result.length, 1)
  assert.deepEqual(result[0].rules, { title: 'h1' })
  assert.equal(calls.length, 1)
  assert.match(calls[0][0], /duplicate rules tag name "api"/)
})

test('collectRulesTags: unsupported data-rules-version throws', () => {
  const $ = load('<script data-rules-name="api" data-rules-version="3">{"title":"h1"}</script>')
  assert.throws(() => collectRulesTags(cheerioAdapter, $.root()), UnknownRulesVersion)
})

test('collectRulesTags: empty name attribute is skipped', () => {
  const $ = load('<script data-rules-name="  " data-rules-version="1">{"title":"h1"}</script>')
  assert.deepEqual(collectRulesTags(cheerioAdapter, $.root()), [])
})

test('normalizeName: trims and collapses whitespace', () => {
  assert.equal(normalizeName('  api   settings '), 'api settings')
  assert.equal(normalizeName(null), '')
})
