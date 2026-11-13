import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as cheerio from 'cheerio'
import adapter from '../src/adapters/cheerio.js'
import { extract } from '../src/engine/index.js'
import { sheet, QueryRefused, grid } from '../src/codecs/sheet.js'
import { CodecRefused } from '../src/engine/errors.js'

const FIXTURES = ['tiny', 'empty', 'escapes', 'formulas-formatted', 'merged', 'styled']
const RULES = { sheets: '[items=sheets]@codec(sheet)' }
const table = (name) => readFileSync(new URL(`./fixtures/sheet/${name}.html`, import.meta.url), 'utf8').trimEnd()
const section = (id, name, body) => `<section item data-id="${id}" data-pos="V"><h2 bind="name">${name}</h2>${body}</section>`
const documentOf = (...sections) => `<!DOCTYPE html><html><body><main sap data-rev="12"><div items="sheets">${sections.join('\n')}</div></main></body></html>`
const read = (html, extra = {}) => extract(adapter, cheerio.load(html).root(), RULES, { version: '2', codecs: { sheet }, ...extra })

test('the tree route and the byte route read every fixture the same', () => {
  let compared = 0
  for (const name of FIXTURES) {
    let calls = 0
    const region = () => {
      calls += 1
      return table(name)
    }
    const html = documentOf(section('s1', 'Budget', table(name)))
    const tree = read(html)
    const bytes = read(html, { region })
    assert.deepEqual(tree, bytes, `${name}: the two routes disagree`)
    assert.equal(tree.sheets.length, 1)
    assert.equal(tree.sheets[0].id, 's1')
    assert.equal(tree.sheets[0].name, 'Budget')
    assert.equal(calls, 1, `${name}: the byte route ran ${calls} times`)
    compared += 1
  }
  assert.equal(compared, 6)
})

test('the byte route reads what lane A reads', () => {
  const region = () => table('tiny')
  const bytes = read(documentOf(section('s1', 'Budget', table('tiny'))), { region })
  const { id, name, ...rest } = bytes.sheets[0]
  assert.equal(id, 's1')
  assert.equal(name, 'Budget')
  assert.deepEqual(rest, grid.tabJson(grid.gridModel(table('tiny'), 0)))
})

test('a hand-edited table reads through the tree', () => {
  const edited = table('tiny').replace(/(<td[^>]*>)([^<]*)(<\/td>)/, '$1<b>$2</b>$3')
  assert.notEqual(edited, table('tiny'))
  assert.throws(() => grid.scanGrid(edited, 0), grid.CodecMiss)
  assert.deepEqual(
    read(documentOf(section('s1', 'Budget', edited))),
    read(documentOf(section('s1', 'Budget', table('tiny')))),
  )
})

const twoTabs = () => documentOf(section('s1', 'Budget', table('tiny')), section('s2', 'Styled', table('styled')))

test('the index shape counts every tab', () => {
  const html = twoTabs()
  assert.deepEqual(read(html, { query: { shape: 'index' } }).sheets, [
    { id: 's1', name: 'Budget', ...grid.tabIndex(grid.gridModel(table('tiny'), 0)) },
    { id: 's2', name: 'Styled', ...grid.tabIndex(grid.gridModel(table('styled'), 0)) },
  ])
})

test('one tab is found by name and by id', () => {
  const html = twoTabs()
  const whole = read(html)
  for (const wanted of ['Styled', 's2']) {
    const tab = read(html, { query: { sheet: wanted } }).sheets
    assert.equal(tab.id, 's2')
    assert.equal(tab.name, 'Styled')
    assert.deepEqual(tab.cols, whole.sheets[1].cols)
  }
})

test('a range renders as values, formulas and cells', () => {
  const html = twoTabs()
  for (const render of ['values', 'formulas', 'cells']) {
    const got = read(html, { query: { sheet: 'Budget', range: 'A1:C3', render } }).sheets
    const want = { sheet: 'Budget', range: 'A1:C3', ...grid.readRange(grid.gridModel(table('tiny'), 0), 'A1:C3', render) }
    assert.deepEqual(got, want, `render ${render}`)
  }
  const single = read(html, { query: { range: 'B2' } }).sheets
  assert.equal(single.sheet, 'Budget')
  assert.ok(Array.isArray(single.values))
})

test('a query the codec cannot answer is refused', () => {
  const html = twoTabs()
  const refuses = (extra, code) => {
    assert.throws(
      () => read(html, extra),
      (err) => {
        assert.ok(err instanceof QueryRefused, `${JSON.stringify(extra)} threw ${err.name}`)
        assert.equal(err.code, code)
        return true
      },
    )
  }
  refuses({ query: { sheet: 'Nope' } }, 'unknown_sheet')
  refuses({ query: { sheet: 'Budget', range: 'A0' } }, 'bad_range')
  refuses({ query: { range: 'A1', render: 'html' } }, 'bad_render')
  assert.throws(
    () => read(documentOf(), { query: { range: 'A1' } }),
    (err) => {
      assert.ok(err instanceof QueryRefused)
      assert.equal(err.code, 'unknown_sheet')
      return true
    },
  )
})

test('the digest view digests every tab', () => {
  const html = twoTabs()
  const digest = read(html, { view: 'digest' }).sheets
  assert.deepEqual(digest, [
    { id: 's1', name: 'Budget', ...grid.tabDigest(grid.gridModel(table('tiny'), 0)) },
    { id: 's2', name: 'Styled', ...grid.tabDigest(grid.gridModel(table('styled'), 0)) },
  ])
  assert.ok(Array.isArray(digest[0].rows) && digest[0].rows.length > 0)
  assert.deepEqual(digest[0].cols, grid.columnIds(grid.gridModel(table('tiny'), 0)))
  assert.ok(digest[0].cols.length > 0)
})

test('no match reads null and a tab name is never trimmed', () => {
  assert.equal(read('<html><body><p>no sheet</p></body></html>').sheets, null)
  const spaced = read(documentOf(section('s1', '  Spaced  ', table('tiny'))))
  assert.equal(spaced.sheets[0].name, '  Spaced  ')
})

test('writing is refused for now', () => {
  assert.throws(
    () => sheet.write(adapter, null, []),
    (err) => err instanceof CodecRefused && err.code === 'sheet-write-unavailable',
  )
  assert.equal(sheet.same([{ a: 1 }], [{ a: 1 }]), true)
  assert.equal(sheet.same([{ a: 1 }], [{ a: 2 }]), false)
  assert.ok(Array.isArray(sheet.styles) && sheet.styles.length > 0)
})
