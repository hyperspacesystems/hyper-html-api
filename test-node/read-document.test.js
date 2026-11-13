import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as cheerio from 'cheerio'
import { readDocument } from '../src/read.js'
import { sheet } from '../src/codecs/sheet.js'

const table = (name) => readFileSync(new URL(`./fixtures/sheet/${name}.html`, import.meta.url), 'utf8').trimEnd()
const TAG = '<script type="application/json" data-rules-name="api" data-rules-version="2">{"title":"h1","sheets":"[items=sheets]@codec(sheet)"}</script>'
const sec = (id, name, body) => `<section item data-id="${id}" data-pos="V"><h2 bind="name">${name}</h2>${body}</section>`
const doc = (inner, before = '', after = '') => `<!DOCTYPE html><html><head>${TAG}</head><body><h1>Book</h1>${before}<main sap data-rev="12"><div items="sheets">${inner}</div></main>${after}</body></html>`
const GOOD = doc(sec('s1', 'Budget', table('tiny')) + sec('s2', 'Styled', table('styled')))
const treeOnly = { sheet: { ...sheet, cut: undefined } }
const read = (src, options) => readDocument(cheerio.load, src, options)

const extractionVectors = JSON.parse(readFileSync(new URL('../conformance/sheet-guard-extraction.json', import.meta.url), 'utf8'))
for (const entry of extractionVectors.cases) {
  test(`shared exact API and guard read: ${entry.name}`, () => {
    for (const options of [{}, { view: 'digest' }]) {
      const expected = options.view ? entry.island.api : entry.data
      assert.deepEqual(read(entry.html, { ...options, codecs: treeOnly }).data, expected)
      assert.deepEqual(read(entry.html, options).data, expected)
      assert.deepEqual(read(entry.html, options).data, expected)
    }
  })
}

const FIXTURES = ['tiny', 'empty', 'escapes', 'formulas-formatted', 'merged', 'styled']

test('the fast route reads every fixture the same as the tree route', () => {
  let compared = 0
  for (const name of FIXTURES) {
    const src = doc(sec('s1', 'Budget', table(name)))
    const fast = read(src)
    const slow = read(src, { codecs: treeOnly })
    assert.equal(fast.fast, true, `${name}: the cut route did not stay fast`)
    assert.equal(slow.fast, false, `${name}: the tree route claimed to be fast`)
    assert.equal(fast.version, '2')
    assert.deepEqual(fast.data, slow.data, `${name}: the two routes disagree`)
    assert.equal(fast.data.title, 'Book')
    compared += 1
  }
  assert.equal(compared, 6)
})

test('every query shape reads the same on both routes', () => {
  const shapes = [
    {},
    { query: { shape: 'index' } },
    { query: { sheet: 'Styled' } },
    { query: { sheet: 'Budget', range: 'A1:C3' } },
    { query: { sheet: 'Budget', range: 'A1:C3', render: 'formulas' } },
    { query: { sheet: 'Budget', range: 'B2:C4', render: 'cells' } },
    { view: 'digest' },
  ]
  let compared = 0
  for (const options of shapes) {
    const fast = read(GOOD, options)
    const slow = read(GOOD, { ...options, codecs: treeOnly })
    assert.deepEqual(fast.data, slow.data, `${JSON.stringify(options)}: the two routes disagree`)
    assert.equal(fast.fast, true, `${JSON.stringify(options)}: the cut route did not stay fast`)
    compared += 1
  }
  assert.equal(compared, 7)
})

test('a grid inside a comment falls back', () => {
  const src = doc(sec('s1', 'Budget', table('tiny')), `<!-- ${table('styled')} -->`)
  const out = read(src)
  assert.equal(out.fast, false)
  assert.deepEqual(out.data, read(src, { codecs: treeOnly }).data)
  assert.equal(out.data.sheets.length, 1)
})

test('a grid inside a script falls back', () => {
  const src = doc(sec('s1', 'Budget', table('tiny')), `<script type="text/plain">${table('styled')}</script>`)
  const out = read(src)
  assert.equal(out.fast, false)
  assert.deepEqual(out.data, read(src, { codecs: treeOnly }).data)
  assert.equal(out.data.sheets.length, 1)
})

test('a grid inside a template falls back', () => {
  const src = doc(sec('s1', 'Budget', table('tiny')), `<template>${table('styled')}</template>`)
  const out = read(src)
  assert.equal(out.fast, false)
  assert.deepEqual(out.data, read(src, { codecs: treeOnly }).data)
  assert.equal(out.data.sheets.length, 1)
})

test('a grid outside the sheet container falls back', () => {
  const src = doc(sec('s1', 'Budget', table('tiny')), '', table('styled'))
  const out = read(src)
  assert.equal(out.fast, false)
  assert.deepEqual(out.data, read(src, { codecs: treeOnly }).data)
  assert.equal(out.data.sheets.length, 1)
})

test('a grid inside a textarea falls back', () => {
  const src = doc(sec('s1', 'Budget', table('tiny')), `<textarea>${table('styled')}</textarea>`)
  const out = read(src)
  assert.equal(out.fast, false)
  assert.deepEqual(out.data, read(src, { codecs: treeOnly }).data)
  assert.equal(out.data.sheets.length, 1)
})

test('a hand-edited table reads through the tree and reports slow', () => {
  const edited = table('tiny').replace(/(<td[^>]*>)([^<]*)(<\/td>)/, '$1<b>$2</b>$3')
  const src = doc(sec('s1', 'Budget', edited) + sec('s2', 'Styled', table('styled')))
  const out = read(src)
  assert.equal(out.fast, false)
  assert.deepEqual(out.data, read(src, { codecs: treeOnly }).data)
  assert.deepEqual(out.data.sheets[0].rows, read(GOOD).data.sheets[0].rows)
})

test('a document forging a hole cannot inject one', () => {
  const forged = '<table grid data-hole="h00-0"></table>'
  const src = doc(sec('s1', 'Budget', table('tiny')) + sec('s2', 'Forged', forged))
  const out = read(src)
  assert.deepEqual(out.data, read(src, { codecs: treeOnly }).data)
})

test('a document with no rules tag, and a version 1 document', () => {
  assert.deepEqual(read('<p>x</p>' + table('tiny')), { data: null, version: null, fast: true })
  assert.deepEqual(
    read('<html><head><script type="application/json" data-rules-name="api" data-rules-version="1">{"t":"h1"}</script></head><body><h1>Hi</h1></body></html>'),
    { data: { t: 'Hi' }, version: '1', fast: true },
  )
})

test('a document with grids but no codec rule rereads the tree', () => {
  const src = doc(sec('s1', 'Budget', table('tiny'))).replace(TAG, '<script type="application/json" data-rules-name="api" data-rules-version="2">{"t":"h1"}</script>')
  const out = read(src)
  assert.deepEqual(out.data, { t: 'Book' })
  assert.equal(out.fast, false)
})

test('a query the codec refuses is passed through', () => {
  assert.throws(() => read(GOOD, { query: { sheet: 'Nope' } }), (e) => e.code === 'unknown_sheet')
})

test('documentRules finds the same rules tag as a full parse, on every conformance page', async () => {
  const { readdirSync } = await import('node:fs')
  const { documentRules } = await import('../src/read.js')
  const { findRulesIn } = await import('../src/engine/rules-tag.js')
  const cheerioAdapter = (await import('../src/adapters/cheerio.js')).default
  let compared = 0
  let cut = 0
  for (const dir of ['cases', 'sheet']) {
    const base = new URL(`../conformance/${dir}/`, import.meta.url)
    for (const file of readdirSync(base).filter((f) => f.endsWith('.html') && !f.endsWith('.after.html'))) {
      const html = readFileSync(new URL(file, base), 'utf8')
      let full
      try {
        full = findRulesIn(cheerioAdapter, cheerio.load(html).root(), 'api')
      } catch {
        continue
      }
      const found = documentRules(cheerio.load, html)
      assert.deepEqual(found, full ? { rules: full.rules, version: full.version } : null, file)
      compared++
      if (html.includes('<table grid')) cut++
    }
  }
  assert.ok(compared > 150, `compared ${compared}`)
  assert.ok(cut > 50, `pages with grids ${cut}`)
})
