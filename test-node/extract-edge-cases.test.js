import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as cheerio from 'cheerio'

import { extract } from '../src/engine/index.js'
import { MaxRuleDepthExceeded } from '../src/engine/errors.js'
import cheerioAdapter from '../src/adapters/cheerio.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixturesDir = path.join(__dirname, '..', 'test', 'fixtures')

function read(name) {
  return fs.readFileSync(path.join(fixturesDir, name), 'utf8')
}

function readJson(name) {
  return JSON.parse(read(name))
}

test('extract throws MaxRuleDepthExceeded at 21 levels', () => {
  const $ = cheerio.load(read('deep.html'))
  const rules = readJson('deep.rules.json')
  assert.throws(() => extract(cheerioAdapter, $.root(), rules), (err) => {
    assert.ok(err instanceof MaxRuleDepthExceeded)
    assert.ok(Array.isArray(err.path))
    assert.ok(err.path.length >= 20)
    return true
  })
})

test('extract on missing selector returns null', () => {
  const $ = cheerio.load('<div>hello</div>')
  assert.equal(extract(cheerioAdapter, $.root(), { x: '.nope' }).x, null)
})

test('extract of . rule returns trimmed text of context', () => {
  const $ = cheerio.load('<p>  hello  </p>')
  const ctx = $('p').first()
  assert.equal(extract(cheerioAdapter, ctx, '.'), 'hello')
})

test('extract of selector[] on empty matches returns []', () => {
  const $ = cheerio.load('<div></div>')
  assert.deepEqual(extract(cheerioAdapter, $.root(), { tags: '.tag[]' }).tags, [])
})
