#!/usr/bin/env node
// Generates the sheet conformance cases in conformance/sheet/: one directory of documents
// that the read, patch and write faces of the sheet codec must answer byte for byte on
// every host. Run `node scripts/sheet-cases.mjs && npm run conformance:generate` after
// changing a case.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tableHtml, cellHtml } from '../src/codecs/sheet.vendor.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'conformance', 'sheet')
const table = (name) => readFileSync(join(ROOT, 'test-node', 'fixtures', 'sheet', `${name}.html`), 'utf8').trimEnd()
const TAG = '<script type="application/json" data-rules-name="api" data-rules-version="2">{"title":"h1","sheets":"[items=sheets]@codec(sheet)"}</script>'
const sec = (id, name, body) => `<section item data-id="${id}" data-pos="V"><h2 bind="name">${name}</h2>${body}</section>`
const doc = (inner, { before = '', tag = TAG } = {}) => `<!DOCTYPE html>\n<html><head>${tag}</head><body><h1>Book</h1>${before}<main sap data-rev="12"><div items="sheets">\n${inner}\n</div></main></body></html>\n`
const TWO = doc(sec('s1', 'Budget', table('tiny')) + '\n' + sec('s2', 'Styled', table('styled')))
const EDITED = table('tiny').replace(/(<td[^>]*>)([^<]*)(<\/td>)/, '$1<b>$2</b>$3')

function write(name, { html, face, expect, note, query, view, data }) {
  const meta = ['tier: 1', `face: ${face}`, 'token: api', `expect: ${expect}`]
  if (query !== undefined) meta.push(`query: ${JSON.stringify(query)}`)
  if (view !== undefined) meta.push(`view: ${view}`)
  meta.push(`note: ${note}`)
  writeFileSync(join(OUT, `${name}.html`), html)
  writeFileSync(join(OUT, `${name}.meta`), meta.join('\n') + '\n')
  if (data !== undefined) writeFileSync(join(OUT, `${name}.data.json`), JSON.stringify(data, null, 2) + '\n')
}

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

// ---------- read face: one tab, or a whole document ----------
const FIXTURES = ['tiny', 'empty', 'escapes', 'formulas-formatted', 'merged', 'styled']
for (const fixture of FIXTURES) {
  write(`sheet-read-${fixture}`, {
    html: doc(sec('s1', 'Budget', table(fixture))),
    face: 'read',
    expect: 'ok',
    note: `the whole read of one tab (${fixture} fixture)`,
  })
}

write('sheet-read-two-tabs', { html: TWO, face: 'read', expect: 'ok', note: 'the whole read of two tabs' })
write('sheet-read-index', { html: TWO, face: 'read', expect: 'ok', query: { shape: 'index' }, note: 'the index shape lists tabs without their cells' })
write('sheet-read-sheet-by-name', { html: TWO, face: 'read', expect: 'ok', query: { sheet: 'Styled' }, note: 'one tab selected by its name' })
write('sheet-read-sheet-by-id', { html: TWO, face: 'read', expect: 'ok', query: { sheet: 's2' }, note: 'one tab selected by its id' })
write('sheet-read-range-values', { html: TWO, face: 'read', expect: 'ok', query: { sheet: 'Budget', range: 'A1:C3', render: 'values' }, note: 'a range reads values by default' })
write('sheet-read-range-formulas', { html: TWO, face: 'read', expect: 'ok', query: { sheet: 'Budget', range: 'A1:C3', render: 'formulas' }, note: 'render formulas adds f beside v' })
write('sheet-read-range-cells', { html: TWO, face: 'read', expect: 'ok', query: { sheet: 'Budget', range: 'A1:C3', render: 'cells' }, note: 'render cells adds the cell attributes' })
write('sheet-read-range-first-tab', { html: TWO, face: 'read', expect: 'ok', query: { range: 'B2' }, note: 'a range with no sheet reads the first tab' })
write('sheet-read-digest', { html: TWO, face: 'read', expect: 'ok', view: 'digest', note: 'the digest view is stable per host' })
write('sheet-read-unknown-sheet', { html: TWO, face: 'read', expect: 'error', query: { sheet: 'Nope' }, note: 'a tab that is not there is refused' })
write('sheet-read-bad-range', { html: TWO, face: 'read', expect: 'error', query: { sheet: 'Budget', range: 'A0' }, note: 'row 0 is not a range' })
write('sheet-read-bad-render', { html: TWO, face: 'read', expect: 'error', query: { range: 'A1', render: 'html' }, note: 'an unknown render is refused' })

// A table outside the tree route reads back the same as one inside it.
const FALLBACK = {
  'sheet-read-grid-in-comment': { before: `<!-- ${table('styled')} -->`, note: 'a grid in a comment reads through the tree, not the codec scan' },
  'sheet-read-grid-in-script': { before: `<script type="text/plain">${table('styled')}</script>`, note: 'a grid in a script element reads through the tree' },
  'sheet-read-grid-in-textarea': { before: `<textarea>${table('styled')}</textarea>`, note: 'a grid in a textarea element reads through the tree' },
  'sheet-read-grid-in-template': { before: `<template>${table('styled')}</template>`, note: 'a grid in a template element reads through the tree' },
  'sheet-read-grid-outside-sheet': { before: null, note: 'a grid after </main> reads through the tree' },
}
for (const [name, { before, note }] of Object.entries(FALLBACK)) {
  const html = before === null
    ? doc(sec('s1', 'Budget', table('tiny'))).replace('</main>', '</main>' + table('styled'))
    : doc(sec('s1', 'Budget', table('tiny')), { before })
  write(name, { html, face: 'read', expect: 'ok', note })
}

// The containment check matters when another rule reads a grid outside the sheet:
// read through a hole, that rule would see an empty table instead of its cells.
write('sheet-read-grid-outside-read-by-rule', {
  html: doc(sec('s1', 'Budget', table('tiny')), {
    tag: TAG.replace('"sheets":', '"outside":"body > table[grid] td[]","sheets":'),
  }).replace('</main>', '</main>' + table('styled')),
  face: 'read',
  expect: 'ok',
  note: 'a rule that reads a grid outside the sheet sees its cells, never a hole',
})

write('sheet-read-hand-edited', { html: doc(sec('s1', 'Budget', EDITED)), face: 'read', expect: 'ok', note: 'a hand-edited table still reads through the tree' })
write('sheet-read-version-1-codec', {
  html: doc(sec('s1', 'Budget', table('tiny')) + '\n' + sec('s2', 'Styled', table('styled')), { tag: TAG.replace('data-rules-version="2"', 'data-rules-version="1"') }),
  face: 'read',
  expect: 'error',
  note: 'the sheet codec needs rules version 2',
})
write('sheet-read-no-tag', { html: doc(sec('s1', 'Budget', table('tiny')), { tag: '' }), face: 'read', expect: 'error', note: 'no rules tag is not a read' })

// ---------- hostile set: lane A's codec misses, each table here must read through the tree ----------
const CELLS = (cells) => `<table grid><tbody>\n<tr data-id="r" data-pos="G">${cells}</tr>\n</tbody></table>`;
const ROW = (row) => `<table grid><tbody>\n${row}\n</tbody></table>`;
const TABLE = (start, rest = "") =>
  `${start}<tbody>\n<tr data-id="r" data-pos="G"><td>x</td></tr>\n</tbody>${rest}</table>`;

const FORMULA = '=IF(A1="</table>","<td>","-->")&"\n"&"x"';
const formulaCell = cellHtml({ text: "7", n: true, f: FORMULA });

const MISSES = [
  ["cell <td>&copy 2026</td>", CELLS("<td>&copy 2026</td>")],
  ["cell <td>a&notit;b</td>", CELLS("<td>a&notit;b</td>")],
  ["cell <td>&#0;</td>", CELLS("<td>&#0;</td>")],
  ["cell <td>&#x80;</td>", CELLS("<td>&#x80;</td>")],
  ["cell <td>&nbsp;</td>", CELLS("<td>&nbsp;</td>")],
  ['cell <td n v="1" v="2">x</td>', CELLS('<td n v="1" v="2">x</td>')],
  ['cell <td N V="7">x</td>', CELLS('<td N V="7">x</td>')],
  ["cell <td v='1'>x</td>", CELLS("<td v='1'>x</td>")],
  ["cell <td v=1>x</td>", CELLS("<td v=1>x</td>")],
  ['cell <td v="1"n>x</td>', CELLS('<td v="1"n>x</td>')],
  ['cell <td v="1" f="=A1">x</td> (order)', CELLS('<td v="1" f="=A1">x</td>')],
  ['cell <td n="">1</td>', CELLS('<td n="">1</td>')],
  ["cell <td>a\rb</td>", CELLS("<td>a\rb</td>")],
  ['cell <td f="a\rb">x</td>', CELLS('<td f="a\rb">x</td>')],
  ["cell <td>a\0b</td>", CELLS("<td>a\0b</td>")],
  ["cell <td><b>x</b></td>", CELLS("<td><b>x</b></td>")],
  ["cell <td>a<!--c-->b</td>", CELLS("<td>a<!--c-->b</td>")],
  ["cell <td>x</td >", CELLS("<td>x</td >")],
  ["cell <TD>x</TD>", CELLS("<TD>x</TD>")],
  ["cell <td hidden>x</td>", CELLS("<td hidden>x</td>")],
  ['cell <td colspan="1">x</td>', CELLS('<td colspan="1">x</td>')],
  ['cell <td colspan="02">x</td>', CELLS('<td colspan="02">x</td>')],
  ["cell <td>x</td><td></td> (trailing empty cell)", CELLS("<td>x</td><td></td>")],
  ["cell <td>a > b</td> (raw > in text)", CELLS("<td>a > b</td>")],
  ['row <tr data-pos="a" data-id="r">', ROW('<tr data-pos="a" data-id="r"><td>x</td></tr>')],
  ['row <tr data-id="r" data-pos="a" class="x">', ROW('<tr data-id="r" data-pos="a" class="x"><td>x</td></tr>')],
  [
    "a carriage return between two rows",
    '<table grid><tbody>\n<tr data-id="r1" data-pos="G"><td>x</td></tr>\r\n<tr data-id="r2" data-pos="O"><td>y</td></tr>\n</tbody></table>',
  ],
  ['table <table grid class="x">', TABLE('<table grid class="x">')],
  ['table <table grid freeze-cols="01">', TABLE('<table grid freeze-cols="01">')],
  ['table <table grid freeze-cols="0">', TABLE('<table grid freeze-cols="0">')],
  ['table <table grid stale freeze-cols="1">', TABLE('<table grid stale freeze-cols="1">')],
  [
    "table with a <tfoot>",
    `${TABLE("<table grid>").replace("</tbody></table>", "</tbody>")}<tfoot><tr data-id="t" data-pos="G"><td>x</td></tr></tfoot></table>`,
  ],
  ["table with a <caption>", '<table grid><caption>x</caption><tbody>\n<tr data-id="r" data-pos="G"><td>x</td></tr>\n</tbody></table>'],
  [
    "table with a <tbody> before <thead>",
    '<table grid><tbody>\n<tr data-id="r" data-pos="G"><td>x</td></tr>\n</tbody><thead>\n<tr data-id="t" data-pos="O"><td>y</td></tr>\n</thead></table>',
  ],
  [
    "table with two <thead>s",
    '<table grid><thead>\n<tr data-id="r" data-pos="G"><td>x</td></tr>\n</thead><thead>\n<tr data-id="t" data-pos="O"><td>y</td></tr>\n</thead></table>',
  ],
];

const oneLine = (text) => text.replace(/\r/g, "\\r").replace(/\0/g, "\\0")

MISSES.forEach(([what, src], i) => {
  write(`sheet-hostile-${String(i + 1).padStart(2, "0")}`, {
    html: doc(sec("s1", "Budget", src)),
    face: "read",
    expect: "ok",
    note: `hostile: ${oneLine(what)}`,
  })
})

// ---------- contract: the value rule every port must match ----------
const CONTRACT = {
  cols: [{ id: 'ca', pos: 'V' }, { id: 'cb', pos: 'k' }, { id: 'cc', pos: 'z' }],
  rows: [
    { id: 'r1', pos: 'V', cells: [{ text: '0', n: true }, { text: 'FALSE' }, { text: '02134' }] },
    { id: 'r2', pos: 'k', cells: [{ text: '=literal', t: true }, { text: '80%', n: true, f: '=B5/B6', v: '0.8', fmt: '0%' }, { text: '', fmt: '0.00' }] },
    { id: 'r3', pos: 'n', cells: [{ text: 'Wide', colspan: 2 }, { text: '', hidden: true }, { text: '123456789012345' }] },
    { id: 'r4', pos: 'p', cells: [{ text: '4111111111111111' }, { text: '1200.50' }, { text: '100000000000000000000' }] },
  ],
}
const CONTRACT_HTML = doc(sec('s1', 'Contract', tableHtml(CONTRACT)))
const CONTRACT_NOTE = '0 and FALSE type as number and boolean, 02134 and =literal stay text, a formula keeps raw 0.8 beside its shown 80%, a covered cell reads null, a formatted empty cell keeps fmt, 15 digits is a number and 16 is text'

write('sheet-contract-whole', { html: CONTRACT_HTML, face: 'read', expect: 'ok', note: CONTRACT_NOTE })
for (const render of ['values', 'formulas', 'cells']) {
  write(`sheet-contract-${render}`, {
    html: CONTRACT_HTML,
    face: 'read',
    expect: 'ok',
    query: { range: 'A1:C4', render },
    note: `${CONTRACT_NOTE} (render ${render})`,
  })
}

// ---------- patch face ----------
write('sheet-patch-range', { html: TWO, face: 'patch', expect: 'ok', data: [{ sheet: 'Budget', range: 'B3', values: [[450]] }], note: 'a range patch replaces the cells in place' })
write('sheet-patch-append', { html: TWO, face: 'patch', expect: 'ok', data: [{ sheet: 's1', append: [['Porto', 12], ['Lisbon', 7]] }], note: 'appended rows are named n1, n2, ...' })
write('sheet-patch-two-tabs', {
  html: TWO,
  face: 'patch',
  expect: 'ok',
  data: [
    { sheet: 'Budget', range: 'A2', values: [['Rent2']] },
    { sheet: 'Styled', range: 'A2', values: [['x']] },
  ],
  note: 'two operations in one patch touch two tabs',
})
write('sheet-patch-first-tab', { html: TWO, face: 'patch', expect: 'ok', data: [{ range: 'A2', values: [['First']] }], note: 'an operation with no sheet patches the first tab' })
write('sheet-patch-typed', { html: TWO, face: 'patch', expect: 'ok', data: [{ sheet: 'Budget', range: 'A2:C2', values: [['02134', true, null]] }], note: '02134 stays text, true is a boolean, null clears' })
write('sheet-patch-formula', { html: TWO, face: 'patch', expect: 'ok', data: [{ sheet: 'Budget', range: 'C3', values: [['=B3*2']] }], note: 'a string starting with = is a formula; the host cannot compute it, so the tab is stale' })
write('sheet-patch-not-canonical', {
  html: doc(sec('s1', 'Budget', EDITED) + '\n' + sec('s2', 'Styled', table('styled'))),
  face: 'patch',
  expect: 'error',
  data: [{ sheet: 'Budget', range: 'B3', values: [[1]] }],
  note: 'a table edited outside the editor is refused with 409',
})
write('sheet-patch-clean-tab-beside-edited', {
  html: doc(sec('s1', 'Budget', EDITED) + '\n' + sec('s2', 'Styled', table('styled'))),
  face: 'patch',
  expect: 'ok',
  data: [{ sheet: 'Styled', range: 'A2', values: [['x']] }],
  note: 'a clean tab patches even when another tab was hand edited',
})
write('sheet-patch-fallback-route', {
  html: doc(sec('s1', 'Budget', table('tiny')), { before: `<!-- ${table('styled')} -->` }),
  face: 'patch',
  expect: 'ok',
  data: [{ range: 'A2', values: [['Z']] }],
  note: 'a grid outside the tree route is read through the tree and refused, not patched',
})
write('sheet-patch-empty', { html: TWO, face: 'patch', expect: 'error', data: [], note: 'an empty patch list is refused' })
write('sheet-patch-unknown-sheet', { html: TWO, face: 'patch', expect: 'error', data: [{ sheet: 'Nope', range: 'A1', values: [[1]] }], note: 'a tab that is not there is refused' })
write('sheet-patch-outside-sheet', { html: TWO, face: 'patch', expect: 'error', data: [{ sheet: 'Budget', range: 'Z99', values: [[1]] }], note: 'a range outside the sheet is refused' })
write('sheet-patch-no-values', { html: TWO, face: 'patch', expect: 'error', data: [{ sheet: 'Budget', range: 'A1' }], note: 'a range operation needs values' })
write('sheet-patch-bad-range', { html: TWO, face: 'patch', expect: 'error', data: [{ sheet: 'Budget', range: 'A0', values: [[1]] }], note: 'row 0 is not a range' })
write('sheet-patch-bad-value', { html: TWO, face: 'patch', expect: 'error', data: [{ sheet: 'Budget', range: 'A1', values: [[{ x: 1 }]] }], note: 'a value must be a string, number, boolean or null' })
write('sheet-patch-covered-cell', {
  html: doc(sec('s1', 'Merged', table('merged'))),
  face: 'patch',
  expect: 'error',
  data: [{ range: 'B1', values: [['x']] }],
  note: 'a cell covered by a merge is not addressable',
})
write('sheet-patch-no-sheet-rule', {
  html: doc(sec('s1', 'Budget', table('tiny')), { tag: '<script type="application/json" data-rules-name="api" data-rules-version="2">{"title":"h1"}</script>' }),
  face: 'patch',
  expect: 'error',
  data: [{ range: 'A1', values: [[1]] }],
  note: 'a document with no sheets rule cannot be patched',
})

// ---------- write face ----------
write('sheet-write-whole-refused', { html: TWO, face: 'write', expect: 'error', data: { sheets: [] }, note: 'replacing a sheet as a whole value is refused with 409; send patch operations' })

// Tab names are kept exactly as written, spaces included, and looked up exactly: a host that
// trims names would read " Budget " as "Budget" and answer both lookups differently.
const PADDED = TWO.replace('<h2 bind="name">Budget</h2>', '<h2 bind="name"> Budget </h2>')
write('sheet-read-padded-name', { html: PADDED, face: 'read', expect: 'ok', note: 'a tab name keeps its surrounding spaces' })
write('sheet-read-padded-name-index', { html: PADDED, face: 'read', expect: 'ok', query: { shape: 'index' }, note: 'the index keeps a tab name exactly' })
write('sheet-read-padded-name-lookup', { html: PADDED, face: 'read', expect: 'ok', query: { sheet: ' Budget ' }, note: 'a lookup with the same spaces finds the tab' })
write('sheet-read-padded-name-trimmed-lookup', { html: PADDED, face: 'read', expect: 'error', query: { sheet: 'Budget' }, note: 'names match exactly, so the trimmed name is not a tab' })

// ---------- URL parameters: parseSheetQuery, then readDocument ----------
const params = (name, qs, expect, note) => {
  write(name, { html: TWO, face: 'params', expect, note })
  const metaPath = join(OUT, `${name}.meta`)
  const lines = readFileSync(metaPath, 'utf8').split('\n')
  lines.splice(lines.findIndex((line) => line.startsWith('note: ')), 0, `params: ${qs}`)
  writeFileSync(metaPath, lines.join('\n'))
}
params('params-none', '', 'ok', 'no sheet parameter is the whole read')
params('params-cache-buster', 'v=7', 'ok', 'an unrelated parameter is the whole read')
params('params-index', 'shape=index', 'ok', 'shape=index lists the tabs')
params('params-range', 'sheet=Styled&range=A1%3AB2&render=formulas', 'ok', 'percent-encoded values decode before the read')
params('params-repeated', 'range=A1&range=B2', 'error', 'a repeated parameter is refused')
params('params-empty', 'sheet=', 'error', 'an empty parameter is refused')
params('params-with-data', 'shape=index&data=%7B%7D', 'error', 'a sheet parameter with ?data= is refused')
params('params-data-alone', 'data=%7B%22t%22%3A%22h1%22%7D', 'ok', '?data= alone is not a sheet query; this face reads the tag, a host runs its query face')
params('params-bad-shape', 'shape=rows', 'error', 'an unknown shape is refused by the read')
params('params-bad-range', 'range=A0', 'error', 'a bad range is refused by the read')
params('params-bad-render', 'range=A1&render=html', 'error', 'a bad render is refused by the read')
params('params-render-without-range', 'render=formulas', 'error', 'render without a range is refused by the read')
params('params-unknown-sheet', 'sheet=Nope', 'error', 'an unknown sheet is refused by the read')

// ---------- request bodies: a patch, or a data write as before ----------
const PATCH_OPS = [{ sheet: 'Budget', range: 'B3', values: [[450]] }]
const PATCH_KEY_DOC = doc(sec('s1', 'Budget', table('tiny')), {
  tag: '<script type="application/json" data-rules-name="api" data-rules-version="2">{"title":"h1","patch":"#patch","sheets":"[items=sheets]@codec(sheet)"}</script>',
}).replace('<h1>Book</h1>', '<h1>Book</h1><p id="patch">notes</p>')
write('body-patch-on-sheet', { html: TWO, face: 'body', expect: 'ok', data: { operationId: 'op-1', patch: PATCH_OPS }, note: 'a patch list with an operation id is a patch' })
write('body-patch-without-operation-id', { html: TWO, face: 'body', expect: 'ok', data: { patch: PATCH_OPS }, note: 'operationId is optional' })
write('body-patch-key-in-rules', { html: PATCH_KEY_DOC, face: 'body', expect: 'ok', data: { patch: PATCH_OPS }, note: 'rules with a top level patch key make the body a data write' })
write('body-patch-with-other-key', { html: TWO, face: 'body', expect: 'ok', data: { patch: PATCH_OPS, other: 1 }, note: 'any key besides patch and operationId makes the body a data write' })
write('body-patch-not-array', { html: TWO, face: 'body', expect: 'ok', data: { patch: 'x' }, note: 'a patch value that is not an array is a data write' })
write('body-data-write', { html: TWO, face: 'body', expect: 'ok', data: { title: 'New' }, note: 'an ordinary data body is a data write' })
write('body-patch-version-1', { html: doc('', { tag: '<script type="application/json" data-rules-name="api" data-rules-version="1">{"title":"h1"}</script>' }), face: 'body', expect: 'ok', data: { patch: PATCH_OPS }, note: 'the classifier is the same on a version 1 document: patchDocument then refuses it' })

console.log(`sheet-cases: wrote ${readdirSync(OUT).filter((f) => f.endsWith('.meta')).length} cases to conformance/sheet`)
