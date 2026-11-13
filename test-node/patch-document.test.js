import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as cheerio from 'cheerio'
import { patchDocument, NOT_CANONICAL_MESSAGE } from '../src/write.js'
import { readDocument } from '../src/read.js'
import { CodecRefused, NoRulesTag, RulesParseError } from '../src/engine/errors.js'
import { QueryRefused } from '../src/codecs/sheet.js'

const table = (name) => readFileSync(new URL(`./fixtures/sheet/${name}.html`, import.meta.url), 'utf8').trimEnd()
const TAG = '<script type="application/json" data-rules-name="api" data-rules-version="2">{"title":"h1","sheets":"[items=sheets]@codec(sheet)"}</script>'
const sec = (id, name, body) => `<section item data-id="${id}" data-pos="V"><h2 bind="name">${name}</h2>${body}</section>`
const doc = (inner, before = '', tag = TAG) => `<!DOCTYPE html><html><head>${tag}</head><body><h1>Book</h1>${before}<main sap data-rev="12"><div items="sheets">${inner}</div></main></body></html>`
const SRC = doc(sec('s1', 'Budget', table('tiny')) + sec('s2', 'Styled', table('styled')))
const EDITED_TINY = table('tiny').replace(/(<td[^>]*>)([^<]*)(<\/td>)/, '$1<b>$2</b>$3')
const patch = (src, ops) => patchDocument(cheerio.load, src, ops)
const range = (html, sheet, r) => readDocument(cheerio.load, html, { query: { sheet, range: r } }).data.sheets.values

test("a range write changes one cell and only that table's rows", () => {
  const out = patch(SRC, [{ sheet: 'Budget', range: 'B3', values: [[450]] }])
  assert.deepEqual(range(out.html, 'Budget', 'B3'), [[450]])
  assert.deepEqual(range(out.html, 'Budget', 'A1:C2'), range(SRC, 'Budget', 'A1:C2'))
  assert.deepEqual(out.changed, { cells: 1, rows: 0 })
  assert.equal(out.stale, true)
  assert.equal(out.html.includes(table('styled')), true)
  assert.equal(out.html.slice(0, out.html.indexOf('<main')), SRC.slice(0, SRC.indexOf('<main')))
})

test('the patched tab reads stale and the other does not', () => {
  const out = patch(SRC, [{ sheet: 'Budget', range: 'B3', values: [[450]] }])
  const read = readDocument(cheerio.load, out.html)
  assert.equal(read.data.sheets[0].stale, true)
  assert.equal(read.data.sheets[1].stale, undefined)
  assert.equal(read.fast, true)
})

test('append adds rows at the end', () => {
  const before = readDocument(cheerio.load, SRC, { query: { shape: 'index' } }).data.sheets[0].rows
  const out = patch(SRC, [{ sheet: 's1', append: [['Porto', 12], ['Lisbon', 7]] }])
  const after = readDocument(cheerio.load, out.html, { query: { shape: 'index' } }).data.sheets[0].rows
  assert.equal(after, before + 2)
  const rows = readDocument(cheerio.load, out.html, { query: { sheet: 'Budget' } }).data.sheets.rows
  const last = rows.slice(-2)
  assert.deepEqual(last[0].cells, ['Porto', 12])
  assert.deepEqual(last[1].cells, ['Lisbon', 7])
  assert.equal(typeof last[0].id, 'string')
  assert.equal(typeof last[1].id, 'string')
  assert.notEqual(last[0].id, last[1].id)
  assert.deepEqual(out.changed, { cells: 4, rows: 2 })
})

test('ops on two tabs in one call', () => {
  const out = patch(SRC, [
    { sheet: 'Budget', range: 'A2', values: [['Rent2']] },
    { sheet: 'Styled', range: 'A2', values: [['x']] },
  ])
  assert.deepEqual(range(out.html, 'Budget', 'A2'), [['Rent2']])
  assert.deepEqual(range(out.html, 'Styled', 'A2'), [['x']])
  assert.equal(out.changed.cells, 2)
})

test('no sheet means the first tab', () => {
  const out = patch(SRC, [{ range: 'A2', values: [['First']] }])
  assert.deepEqual(range(out.html, 'Budget', 'A2'), [['First']])
})

test('typed input', () => {
  const out = patch(SRC, [{ sheet: 'Budget', range: 'A2:C2', values: [['02134', true, null]] }])
  assert.deepEqual(range(out.html, 'Budget', 'A2:C2'), [['02134', true, null]])
})

test('a hand-edited table is refused with 409s error and nothing is returned', () => {
  const src = doc(sec('s1', 'Budget', EDITED_TINY) + sec('s2', 'Styled', table('styled')))
  assert.throws(
    () => patch(src, [{ sheet: 'Budget', range: 'B3', values: [[1]] }]),
    (e) => e instanceof CodecRefused && e.code === 'sheet-not-canonical' && e.message === NOT_CANONICAL_MESSAGE,
  )
  assert.equal(patch(src, [{ sheet: 'Styled', range: 'A2', values: [['x']] }]).changed.cells, 1)
  assert.throws(
    () => patch(src, [
      { sheet: 'Budget', range: 'B3', values: [[1]] },
      { sheet: 'Styled', range: 'A2', values: [['x']] },
    ]),
    (e) => e instanceof CodecRefused && e.code === 'sheet-not-canonical',
  )
})

test('the fallback route patches correctly', () => {
  const src = doc(sec('s1', 'Budget', table('tiny')), `<!-- ${table('styled')} -->`)
  const out = patch(src, [{ range: 'A2', values: [['Z']] }])
  assert.deepEqual(range(out.html, 'Budget', 'A2'), [['Z']])
  assert.equal(out.html.includes(`<!-- ${table('styled')} -->`), true)
})

test('patch refusals carry lane As codes', () => {
  const cases = [
    [[], 'bad_patch'],
    [[{ sheet: 'Nope', range: 'A1', values: [[1]] }], 'unknown_sheet'],
    [[{ sheet: 'Budget', range: 'Z99', values: [[1]] }], 'outside_sheet'],
    [[{ sheet: 'Budget', range: 'A1' }], 'bad_patch'],
    [[{ sheet: 'Budget', range: 'A0', values: [[1]] }], 'bad_range'],
    [[{ sheet: 'Budget', range: 'A1', values: [[{ x: 1 }]] }], 'bad_value'],
    [['nope'], 'bad_patch'],
  ]
  for (const [ops, code] of cases) {
    assert.throws(
      () => patch(SRC, ops),
      (e) => e instanceof QueryRefused && e.code === code,
      `${JSON.stringify(ops)} did not refuse with ${code}`,
    )
  }
})

test('documents that cannot hold a sheet', () => {
  assert.throws(() => patch('<p>x</p>' + table('tiny'), [{ range: 'A1', values: [[1]] }]), NoRulesTag)
  const v1 = TAG.replace('data-rules-version="2"', 'data-rules-version="1"')
  assert.throws(
    () => patch(doc(sec('s1', 'Budget', table('tiny')), '', v1), [{ range: 'A2', values: [['x']] }]),
    RulesParseError,
  )
  const noCodec = '<script type="application/json" data-rules-name="api" data-rules-version="2">{"title":"h1"}</script>'
  assert.throws(
    () => patch(doc(sec('s1', 'Budget', table('tiny')), '', noCodec), [{ range: 'A2', values: [['x']] }]),
    (e) => e instanceof CodecRefused && e.code === 'no-sheet',
  )
})

test('a patched document can be patched again', () => {
  const once = patch(SRC, [{ sheet: 'Budget', range: 'B3', values: [[450]] }])
  const twice = patch(once.html, [{ sheet: 'Budget', range: 'C3', values: [[9]] }])
  assert.deepEqual(range(twice.html, 'Budget', 'B3'), [[450]])
  assert.deepEqual(range(twice.html, 'Budget', 'C3'), [[9]])
  assert.equal(readDocument(cheerio.load, twice.html).fast, true)
})

test('the fallback route also refuses a hand-edited table', () => {
  const src = doc(
    sec('s1', 'Budget', EDITED_TINY) + sec('s2', 'Styled', table('styled')),
    `<!-- ${table('styled')} -->`,
  )
  assert.throws(
    () => patch(src, [{ sheet: 'Budget', range: 'B3', values: [[1]] }]),
    (e) => e instanceof CodecRefused && e.code === 'sheet-not-canonical',
  )
  const out = patch(src, [{ sheet: 'Styled', range: 'A2', values: [['x']] }])
  assert.deepEqual(range(out.html, 'Styled', 'A2'), [['x']])
})
