import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as cheerio from 'cheerio'
import { patchDocument } from '../src/write.js'
import { readDocument } from '../src/read.js'
import { QueryRefused } from '../src/codecs/sheet.js'
import { CodecRefused, NoRulesTag } from '../src/engine/errors.js'

const TAG = '<script type="application/json" data-rules-name="api" data-rules-version="2">{"sheets":"[items=sheets]@codec(sheet)"}</script>'
const table = '<table grid><colgroup><col data-id="c1" data-pos="V"></colgroup><tbody><tr data-id="r1" data-pos="V"><td n v="7">7</td></tr></tbody></table>'
const section = (id, name, body = table) => `<section item data-id="${id}" data-pos="V"><h2 bind="name">${name}</h2>${body}</section>`
const a = section('s1', 'Budget')
const b = section('s2', 'Notes')
const c = section('s3', 'Archive')
const doc = (inner) => `<!doctype html>\n<html><head>${TAG}</head><body data-note='keep &amp; me'>\n<!-- before -->\n<div items="sheets">\n${inner}\n</div>\n<!-- after -->\n</body></html>`
const src = doc(`${a}\n${b}\n${c}`)
const patch = (html, ops) => patchDocument(cheerio.load, html, ops)
const refuses = (html, ops, code) => assert.throws(() => patch(html, ops), (error) => error instanceof QueryRefused && error.code === code)
const tabs = (html) => readDocument(cheerio.load, html).data.sheets
const row = (id, inner) => `<tr data-id="${id}" data-pos="V">${inner}</tr>`
const formulaTable = (rows) => `<table grid><colgroup><col data-id="c1" data-pos="V"></colgroup><tbody>${rows}</tbody></table>`
const editedTable = '<table grid class="wide" data-q="1"><colgroup><col data-id="c1" data-pos="V"></colgroup><tbody><tr data-id="r1" data-pos="V"><td n v="7"><b>7</b></td></tr></tbody></table>'

const staled = (html) => html.replace('<table grid>', '<table grid stale>')

test('document validation still precedes operation validation', () => {
  assert.throws(() => patch('<p>No rules</p>', [null]), NoRulesTag)
  assert.throws(() => patch('<p>No rules</p>', [{ delete: false }]), NoRulesTag)
})

test('deleting a tab by name removes exactly its section', () => {
  const out = patch(src, [{ sheet: 'Budget', delete: true }])
  assert.equal(out.html, src.replace(a, ''))
  assert.deepEqual(tabs(out.html), tabs(src).filter((tab) => tab.id !== 's1'))
  assert.deepEqual(out.changed, { cells: 0, rows: 0, sheets: 1 })
  assert.equal(out.stale, false)
  assert.equal(out.html.includes("<!-- before -->\n<div items=\"sheets\">\n\n"), true)
  assert.equal(out.html.includes("\n</div>\n<!-- after -->"), true)
  assert.equal(out.html.includes("<body data-note='keep &amp; me'>"), true)
})

test('deleting a tab by id removes exactly its section', () => {
  const out = patch(src, [{ sheet: 's2', delete: true }])
  assert.equal(out.html, src.replace(b, ''))
  assert.deepEqual(tabs(out.html), tabs(src).filter((tab) => tab.id !== 's2'))
  assert.deepEqual(out.changed, { cells: 0, rows: 0, sheets: 1 })
  assert.equal(out.stale, false)
  assert.equal(out.html.includes(a), true)
  assert.equal(out.html.includes(c), true)
})

test('deleting the last tab on the page removes exactly its section', () => {
  const out = patch(src, [{ sheet: 'Archive', delete: true }])
  assert.equal(out.html, src.replace(c, ''))
  assert.deepEqual(tabs(out.html), tabs(src).filter((tab) => tab.id !== 's3'))
  assert.deepEqual(out.changed, { cells: 0, rows: 0, sheets: 1 })
  assert.equal(out.stale, false)
  assert.equal(out.html.includes("\n</div>\n<!-- after -->\n</body></html>"), true)
})

test("a tab's name is matched before another tab's id", () => {
  const named = section('x9', 's1')
  const byId = section('s1', 'Archive')
  const html = doc(`${named}\n${byId}\n${section('s3', 'Notes')}`)
  const out = patch(html, [{ sheet: 's1', delete: true }])
  assert.equal(out.html, html.replace(named, ''))
  assert.deepEqual(tabs(out.html).map((tab) => tab.id), ['s1', 's3'])
  assert.deepEqual(out.changed, { cells: 0, rows: 0, sheets: 1 })
})

test('two deletes in one call leave one tab', () => {
  const out = patch(src, [
    { sheet: 'Budget', delete: true },
    { sheet: 'Archive', delete: true },
  ])
  assert.equal(out.html, src.replace(a, '').replace(c, ''))
  assert.deepEqual(tabs(out.html), tabs(src).filter((tab) => tab.id === 's2'))
  assert.deepEqual(out.changed, { cells: 0, rows: 0, sheets: 2 })
  assert.equal(out.stale, false)
})

test('deleting the only remaining tab refuses last_sheet', () => {
  const one = doc(a)
  refuses(one, [{ sheet: 'Budget', delete: true }], 'last_sheet')
  refuses(one, [{ sheet: 's1', delete: true }], 'last_sheet')
})

test('deleting every tab in one call refuses last_sheet', () => {
  refuses(
    src,
    [
      { sheet: 'Budget', delete: true },
      { sheet: 's2', delete: true },
      { sheet: 'Archive', delete: true },
    ],
    'last_sheet',
  )
})

test('an unknown name or id refuses unknown_sheet', () => {
  refuses(src, [{ sheet: 'Nope', delete: true }], 'unknown_sheet')
  refuses(src, [{ sheet: 's9', delete: true }], 'unknown_sheet')
})

test('a delete mixed with range, append, or values refuses bad_patch', () => {
  for (const extra of [
    { range: 'A1', values: [[1]] },
    { append: [[1]] },
    { values: [[1]] },
    { range: undefined },
    { append: undefined },
    { values: undefined },
  ]) {
    refuses(
      src,
      [{ sheet: 'Budget', delete: true, ...extra }, { sheet: 'Notes', range: 'A1', values: [[9]] }],
      'bad_patch',
    )
  }
})

test('a delete that is not exactly true refuses bad_patch', () => {
  for (const value of [false, null, 1, 'true', undefined]) {
    assert.throws(
      () => patch(src, [{ sheet: 'Budget', delete: value }]),
      (error) =>
        error instanceof QueryRefused && error.code === 'bad_patch' && error.message === 'delete must be exactly true',
      String(value),
    )
  }
})

test('a delete without a sheet refuses bad_patch', () => {
  refuses(src, [{ delete: true }], 'bad_patch')
  refuses(src, [{ sheet: undefined, delete: true }], 'bad_patch')
})

test('another operation on the deleted tab refuses bad_patch', () => {
  const cases = [
    [
      { sheet: 'Budget', range: 'A1', values: [[1]] },
      { sheet: 'Budget', delete: true },
    ],
    [
      { sheet: 'Budget', delete: true },
      { sheet: 's1', range: 'A1', values: [[1]] },
    ],
    [
      { sheet: 's1', append: [[1]] },
      { sheet: 'Budget', delete: true },
    ],
    [
      { sheet: 'Budget', delete: true },
      { sheet: 's1', delete: true },
    ],
    [
      { range: 'A1', values: [[1]] },
      { sheet: 'Budget', delete: true },
    ],
  ]
  for (const ops of cases) {
    assert.throws(
      () => patch(src, ops),
      (error) =>
        error instanceof QueryRefused &&
        error.code === 'bad_patch' &&
        error.message.includes('send the delete on its own'),
      JSON.stringify(ops),
    )
  }
})

test('a delete and a write to a survivor succeed in either order', () => {
  const writeThenDelete = patch(src, [
    { sheet: 'Notes', range: 'A1', values: [['x']] },
    { sheet: 'Budget', delete: true },
  ])
  const deleteThenWrite = patch(src, [
    { sheet: 'Budget', delete: true },
    { sheet: 'Notes', range: 'A1', values: [['x']] },
  ])
  for (const out of [writeThenDelete, deleteThenWrite]) {
    assert.deepEqual(out.changed, { cells: 1, rows: 0, sheets: 1 })
    assert.equal(out.stale, true)
    assert.equal(out.html, writeThenDelete.html)
    assert.equal(out.html.includes(a), false)
    assert.equal(out.html.includes(c), true)
    assert.deepEqual(tabs(out.html), [
      { id: 's2', name: 'Notes', cols: ['c1'], rows: [{ id: 'r1', cells: ['x'] }], stale: true },
      { id: 's3', name: 'Archive', cols: ['c1'], rows: [{ id: 'r1', cells: [{ v: 7 }] }] },
    ])
  }
})

test('a tab edited outside the editor can be deleted', () => {
  const edited = doc(`${section('s1', 'Budget', editedTable)}\n${b}\n${c}`)
  const out = patch(edited, [{ sheet: 'Budget', delete: true }])
  assert.equal(out.html, edited.replace(section('s1', 'Budget', editedTable), ''))
  assert.deepEqual(out.changed, { cells: 0, rows: 0, sheets: 1 })
  assert.equal(out.stale, false)
  assert.deepEqual(tabs(out.html), tabs(src).filter((tab) => tab.id !== 's1'))
})

test('a section with no table can be deleted', () => {
  const missing = section('s1', 'Budget', '')
  const html = doc(`${missing}\n${b}\n${c}`)
  const out = patch(html, [{ sheet: 'Budget', delete: true }])
  assert.equal(out.html, html.replace(missing, ''))
  assert.deepEqual(out.changed, { cells: 0, rows: 0, sheets: 1 })
})

test('an untouched outside-edited survivor keeps its bytes', () => {
  const html = doc(`${a}\n${section('s2', 'Notes', editedTable)}\n${c}`)
  const out = patch(html, [{ sheet: 'Archive', delete: true }])
  assert.equal(out.html, html.replace(c, ''))
  assert.equal(out.stale, false)
})

test('a simultaneous write to an outside-edited survivor refuses sheet-not-canonical', () => {
  const html = doc(`${a}\n${section('s2', 'Notes', editedTable)}\n${c}`)
  assert.throws(
    () => patch(html, [{ sheet: 'Budget', delete: true }, { sheet: 'Notes', range: 'A1', values: [['x']] }]),
    (error) => error instanceof CodecRefused && error.code === 'sheet-not-canonical',
  )
})

test('formula survivors are marked stale by one inserted attribute', () => {
  const notes = section(
    's2',
    'Notes',
    formulaTable(
      row('r1', '<td n f="=Budget!A1" v="7">7</td>') +
        row('r2', `<td n f="='My Tab'!A1" v="3">3</td>`) +
        row('r3', '<td n f="=SUM(A1:A2)" v="10">10</td>'),
    ),
  )
  const myTab = section('s3', 'My Tab', formulaTable(row('r9', '<td n f="=Notes!A1" v="2">2</td>')))
  const html = doc(`${a}\n${notes}\n${myTab}`)
  const out = patch(html, [{ sheet: 'Budget', delete: true }])
  assert.equal(out.html, staled(staled(html.replace(a, ''))))
  assert.deepEqual(out.changed, { cells: 0, rows: 0, sheets: 1 })
  assert.equal(out.stale, true)
  const read = tabs(out.html)
  assert.equal(read[0].stale, true)
  assert.equal(read[1].stale, true)
  assert.deepEqual(read[0].rows[0].cells, [{ f: '=Budget!A1', v: 7 }])
  assert.deepEqual(read[0].rows[1].cells, [{ f: "='My Tab'!A1", v: 3 }])
  assert.deepEqual(read[0].rows[2].cells, [{ f: '=SUM(A1:A2)', v: 10 }])
  assert.deepEqual(read[1].rows[0].cells, [{ f: '=Notes!A1', v: 2 }])
})

test('a noncanonical formula survivor gets only the stale insertion', () => {
  const edited = '<table grid data-q="1"><colgroup><col data-id="c1" data-pos="V"></colgroup><tbody><tr data-id="r1" data-pos="V"><td n f="=Budget!A1" v="7"><b>7</b></td></tr></tbody></table>'
  const html = doc(`${a}\n${section('s2', 'Notes', edited)}\n${c}`)
  const out = patch(html, [{ sheet: 'Budget', delete: true }])
  assert.equal(out.html, html.replace(a, '').replace('data-q="1">', 'data-q="1" stale>'))
  assert.equal(out.stale, true)
})

test('an already-stale formula survivor keeps its bytes', () => {
  const stale = section(
    's2',
    'Notes',
    '<table grid stale><colgroup><col data-id="c1" data-pos="V"></colgroup><tbody><tr data-id="r1" data-pos="V"><td n f="=Budget!A1" v="7">7</td></tr></tbody></table>',
  )
  const html = doc(`${a}\n${stale}\n${c}`)
  const out = patch(html, [{ sheet: 'Budget', delete: true }])
  assert.equal(out.html, html.replace(a, ''))
  assert.equal(out.stale, true)
  assert.equal(out.html.includes('stale stale'), false)
})

test('stale insertion preserves trailing slashes in table attributes', () => {
  for (const opening of ['<table grid data-note=path/>', '<table grid data-note="path/">', '<table grid data-note=path />', '<table grid/>']) {
    const formula = table.replace('<table grid>', opening).replace('<td n v="7">', '<td n f="=Budget!A1" v="7">')
    const html = doc(`${a}\n${section('s2', 'Notes', formula)}`)
    const out = patch(html, [{ sheet: 'Budget', delete: true }])
    const before = cheerio.load(html)('[data-id="s2"] table')
    const after = cheerio.load(out.html)('[data-id="s2"] table')
    assert.equal(after.attr('data-note'), before.attr('data-note'), opening)
    assert.equal(after.attr('stale'), '', opening)
    assert.equal(out.html.replace(' stale', ''), html.replace(a, ''), opening)
    assert.equal(out.stale, true)
  }
})

test('a deleted formula tab does not stale formula-free survivors', () => {
  const formulaTab = section(
    's1',
    'Budget',
    formulaTable(row('r1', '<td n f="=SUM(A1:A2)" v="7">7</td>')),
  )
  const html = doc(`${formulaTab}\n${b}\n${c}`)
  const out = patch(html, [{ sheet: 'Budget', delete: true }])
  assert.equal(out.html, html.replace(formulaTab, ''))
  assert.equal(out.stale, false)
  assert.equal(out.html.includes('stale'), false)
})

test('a patched survivor gets only one stale attribute', () => {
  const notes = section(
    's2',
    'Notes',
    formulaTable(row('r1', '<td n f="=Budget!A1" v="7">7</td>') + row('r2', '<td n f="=SUM(A1:A2)" v="3">3</td>')),
  )
  const html = doc(`${a}\n${notes}\n${c}`)
  const out = patch(html, [
    { sheet: 'Budget', delete: true },
    { sheet: 'Notes', range: 'A1', values: [['x']] },
  ])
  assert.equal(out.stale, true)
  assert.deepEqual(out.changed, { cells: 1, rows: 0, sheets: 1 })
  assert.equal((out.html.match(/ stale/g) ?? []).length, 1)
  assert.deepEqual(tabs(out.html)[0].rows[0].cells, ['x'])
  assert.deepEqual(tabs(out.html)[0].rows[1].cells, [{ f: '=SUM(A1:A2)', v: 3 }])
})

test('comments and non-ASCII text before the target do not shift the cut', () => {
  const html = doc(`☕ café — prémière\n${a}\n<!-- ${table} -->\n${b}\n${c}`)
  const out = patch(html, [{ sheet: 'Archive', delete: true }])
  assert.equal(out.html, html.replace(c, ''))
  assert.equal(out.html.includes(`<!-- ${table} -->`), true)
  assert.deepEqual(out.changed, { cells: 0, rows: 0, sheets: 1 })
  const first = patch(html, [{ sheet: 'Budget', delete: true }])
  assert.equal(first.html, html.replace(a, ''))
})

test('a target with no explicit closing tag refuses sheet-not-canonical', () => {
  const html = doc(`${a}\n${b}\n${c.replace('</section>', '')}`)
  assert.throws(
    () => patch(html, [{ sheet: 'Archive', delete: true }]),
    (error) => error instanceof CodecRefused && error.code === 'sheet-not-canonical',
  )
})

test('a cms-template seed or a template item is not a tab, so the only real tab cannot be deleted', () => {
  for (const marker of ['cms-template', 'template']) {
    const seed = `<section item ${marker} data-id="" data-pos="V"><h2 bind="name"></h2>${table}</section>`
    const seeded = doc(`${seed}\n${a}`)
    assert.deepEqual(tabs(seeded).map((tab) => tab.id), ['s1'])
    refuses(seeded, [{ sheet: 'Budget', delete: true }], 'last_sheet')
    refuses(seeded, [{ sheet: '', delete: true }], 'unknown_sheet')
    const out = patch(seeded, [{ range: 'A1', values: [[5]] }])
    assert.equal(out.html.includes(seed), true)
    const two = doc(`${seed}\n${a}\n${b}`)
    refuses(two, [{ sheet: 'Budget', delete: true }, { range: 'A1', values: [[5]] }], 'bad_patch')
  }
})
