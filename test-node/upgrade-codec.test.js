import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as cheerio from 'cheerio'

import cheerioAdapter from '../src/adapters/cheerio.js'
import { collectRulesTags } from '../src/upgrade/rules-tags.js'
import { extractAllFrom } from '../src/upgrade/extract-all.js'
import { migrateInto } from '../src/upgrade/migrate.js'
import { readDocument } from '../src/read.js'

const table = (name) => readFileSync(new URL(`./fixtures/sheet/${name}.html`, import.meta.url), 'utf8').trimEnd()
const tag = (version, rules = '{"title":"h1","sheets":"[items=sheets]@codec(sheet)"}') =>
  `<script type="application/json" data-rules-name="api" data-rules-version="${version}">${rules}</script>`
const sec = (id, name, body) => `<section item data-id="${id}" data-pos="V"><h2 bind="name">${name}</h2>${body}</section>`
const page = (head, title, tabs, extra = '') =>
  `<!DOCTYPE html>\n<html><head>${head}</head><body><h1>${title}</h1><main sap data-rev="3"><div items="sheets">\n${tabs}\n</div></main>${extra}</body></html>\n`

const OLD = page(tag('2'), 'My book', sec('s1', 'Budget', table('tiny')) + '\n' + sec('s2', 'Styled', table('styled')))
const NEW_TEMPLATE = page(tag('2'), 'Untitled', sec('t1', 'Sheet 1', table('empty')), '<footer>new in this version</footer>')

function upgrade(oldHtml, templateHtml) {
  const $old = cheerio.load(oldHtml)
  const dataByName = extractAllFrom(cheerioAdapter, $old.root())
  const $new = cheerio.load(templateHtml)
  const result = migrateInto(cheerioAdapter, $new.root(), dataByName)
  return { dataByName, result, html: $new.html(), $old, $new }
}

test('rules tags of version 2 are collected with their version, and version 3 still throws', () => {
  const $ = cheerio.load(OLD)
  const tags = collectRulesTags(cheerioAdapter, $.root())
  assert.deepEqual(tags.map(({ name, version }) => ({ name, version })), [{ name: 'api', version: '2' }])
  assert.throws(() => collectRulesTags(cheerioAdapter, cheerio.load(page(tag('3'), 'x', '')).root()), { name: 'UnknownRulesVersion' })
})

test('the extract side packs a sheet as its container markup and every other key as data', () => {
  const { dataByName, $old } = upgrade(OLD, NEW_TEMPLATE)
  assert.equal(dataByName.api.title, 'My book')
  assert.equal(typeof dataByName.api.sheets, 'string')
  assert.equal(dataByName.api.sheets, $old('[items=sheets]').html())
})

test('an upgrade carries every tab whole into the new template and keeps its version 2 tag', () => {
  const { result, html, $old, $new } = upgrade(OLD, NEW_TEMPLATE)
  assert.equal($new('[items=sheets]').html(), $old('[items=sheets]').html())
  assert.equal($new('h1').text(), 'My book')
  assert.equal($new('footer').text(), 'new in this version')
  assert.equal($new('script[data-rules-name]').attr('data-rules-version'), '2')
  assert.equal($new('script[data-rules-name]').text(), '{"title":"h1","sheets":"[items=sheets]@codec(sheet)"}')
  assert.deepEqual(result.byName.api, { carriedOver: 2, discarded: 0, listItems: 0 })
  assert.ok(!html.includes('Sheet 1'))
})

// Serializing writes `<table grid>` as `<table grid="">`, so carried tables
// leave the canonical form and read through the tree until the sheet editor
// saves them again. Their data must not change.
test('the carried tabs read the same after the upgrade', () => {
  const { html } = upgrade(OLD, NEW_TEMPLATE)
  const before = readDocument(cheerio.load, OLD)
  const after = readDocument(cheerio.load, html)
  assert.ok(before.data.sheets.length === 2 && before.data.sheets[0].rows.length > 0)
  assert.deepEqual(after.data.sheets, before.data.sheets)
})

test('a page whose data has no sheet keeps the template tabs', () => {
  const $new = cheerio.load(NEW_TEMPLATE)
  const result = migrateInto(cheerioAdapter, $new.root(), { api: { title: 'Kept' } })
  assert.equal($new('h1').text(), 'Kept')
  assert.ok($new('[items=sheets]').html().includes('Sheet 1'))
  assert.deepEqual(result.byName.api, { carriedOver: 1, discarded: 0, listItems: 0 })
})

test('sheet markup with nowhere to go is counted as discarded', () => {
  const noSheet = page(tag('2', '{"title":"h1"}'), 'Untitled', '')
  const $new = cheerio.load(noSheet)
  const $old = cheerio.load(OLD)
  const result = migrateInto(cheerioAdapter, $new.root(), extractAllFrom(cheerioAdapter, $old.root()))
  assert.equal($new('h1').text(), 'My book')
  assert.ok(result.totals.discarded >= 1)
  const notString = migrateInto(cheerioAdapter, cheerio.load(NEW_TEMPLATE).root(), { api: { sheets: [{ name: 'x' }] } })
  assert.deepEqual(notString.byName.api, { carriedOver: 0, discarded: 1, listItems: 0 })
})

test('a codec rule under a version 1 tag still refuses loudly', () => {
  const $ = cheerio.load(page(tag('1'), 'x', sec('s1', 'Budget', table('tiny'))))
  assert.throws(() => extractAllFrom(cheerioAdapter, $.root()), { name: 'RulesParseError' })
})
