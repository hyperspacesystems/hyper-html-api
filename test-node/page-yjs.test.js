import test from 'node:test'
import assert from 'node:assert/strict'
import * as cheerio from 'cheerio'
import { readFileSync } from 'node:fs'
import { readYValue, writeYValue, projection } from '@panphora/clayjs/page/yjs'
import { migrateHybridValues } from '../node_modules/@panphora/clayjs/src/page/ybind/migrate.js'
import { readPageDocument, writePageDocument, PageWriteRefused } from '../src/page.js'
import { writeDocument } from '../src/write.js'
import { WriteRefused } from '../src/engine/errors.js'

const load = cheerio.load
const rules = { title: 'article h1', body: 'article p', other: '#other' }
const codec = { readYValue, writeYValue, projection }
const { renderBlocks } = projection

async function fixture() {
  const value = migrateHybridValues([{ blocks: {
    heading: { t: 'heading', pos: '1', level: 1, c: 'Original' },
    body: { t: 'paragraph', pos: '2', c: 'Body' },
  } }])
  const { blocks, revision } = await readYValue(value)
  const projected = renderBlocks(blocks)
  const tag = `<script type="application/json" merge="blockeditor" clay="live">${JSON.stringify(value)}</script>`
  const article = `<article class='blockeditor' data-blockeditor="1" data-rev="${projected.rev}">${projected.html}</article>`
  const html = `<!doctype html>\r\n<html><head><title>Keep</title>${tag}</head>\r\n<body><!-- before -->${article}<p id="other">Outside</p><!-- after --></body></html>\r\n`
  return { html, value, revision, tag, article, blocks }
}

test('the old rule writer reports success while leaving the Yjs page unchanged', async () => {
  const { html, tag, value } = await fixture()
  const result = writeDocument(load, html, { title: 'Changed' }, { rules })
  assert.equal(load(result.html)('article h1').text(), 'Changed')
  assert.ok(result.html.includes(tag))
  assert.equal((await readYValue(value)).blocks.heading.c, 'Original')
})

test('a store under the name from before the Block editor rename is an ordinary document', async () => {
  const { html } = await fixture()
  const old = html.replace('merge="blockeditor"', 'merge="page"').replace(`class='blockeditor' data-blockeditor="1"`, `class='page' data-page="1"`)
  const read = await readPageDocument(load, old, { rules, codec })
  assert.equal(read.blocks, null)
  assert.equal(read.revision, null)
  assert.equal(read.data.title, 'Original')
})

// The hosted Block editor, copied byte for byte from starter-templates/apps/unreleased/02-blockeditor/blockeditor.html.
// It keeps a hidden starter article inside <template owned-article>.
const HOSTED = readFileSync(new URL('./fixtures/blockeditor-hosted.html', import.meta.url), 'utf8')

async function withLiveStore(html) {
  const value = migrateHybridValues([{ blocks: { heading: { t: 'heading', pos: '1', level: 1, c: 'Live' } } }])
  const { revision } = await readYValue(value)
  const tag = `<script type="application/json" merge="blockeditor" clay="live">${JSON.stringify(value)}</script>`
  return { html: html.replace('</head>', `${tag}</head>`), revision }
}

const inertArticle = html => html.match(/<template owned-article>[\s\S]*?<\/template>|<template><article[\s\S]*?<\/template>/)[0]

test('the hosted Block editor reads and writes past its hidden starter article', async () => {
  const { html, revision } = await withLiveStore(HOSTED)
  const read = await readPageDocument(load, html, { rules: { title: 'article h1' }, codec })
  assert.equal(read.revision, revision)
  assert.equal(read.data.title, 'Live')
  const written = await writePageDocument(load, html, { title: 'Changed' }, { rules: { title: 'article h1' }, codec, expectedRevision: revision })
  assert.equal(load(written.html)('article h1').first().text(), 'Changed')
  assert.equal(inertArticle(written.html), inertArticle(HOSTED))
})

test('an article inside a template is not a second Block editor article', async () => {
  const { html: base, revision } = await fixture()
  const html = base.replace('<!-- after -->', '<template><article class="blockeditor" data-blockeditor="1"><h1>Hidden</h1></article></template><!-- after -->')
  const read = await readPageDocument(load, html, { rules, codec })
  assert.equal(read.data.title, 'Original')
  const written = await writePageDocument(load, html, { title: 'Changed' }, { rules, codec, expectedRevision: revision })
  assert.equal(load(written.html)('article h1').first().text(), 'Changed')
  assert.equal(inertArticle(written.html), inertArticle(html))
})

test('the page entry reads Yjs authoritatively and writes a matching article and store', async () => {
  const { html, revision, blocks } = await fixture()
  const staleArticle = html.replace('>Original</h1>', '>Stale article</h1>')
  const read = await readPageDocument(load, staleArticle, { rules, codec })
  assert.equal(read.data.title, 'Original')
  assert.deepEqual(read.blocks, blocks)
  assert.equal(read.revision, revision)

  const written = await writePageDocument(load, html, { title: 'Changed' }, { rules, codec, expectedRevision: revision })
  const $ = load(written.html)
  const fresh = await readYValue(JSON.parse($('script[merge="blockeditor"]').text()))
  assert.equal(fresh.blocks.heading.c, 'Changed')
  assert.equal($('article h1').text(), 'Changed')
  assert.equal($('article').attr('data-rev'), renderBlocks(fresh.blocks).rev)
  assert.equal(written.revision, fresh.revision)
  assert.notEqual(written.revision, revision)
  assert.ok(written.html.startsWith('<!doctype html>\r\n<html><head><title>Keep</title>'))
  assert.ok(written.html.endsWith('<p id="other">Outside</p><!-- after --></body></html>\r\n'))
})

test('missing and stale revisions refuse before any codec write', async () => {
  const { html, revision } = await fixture()
  let calls = 0
  const monitored = { ...codec, writeYValue: async (...args) => { calls++; return writeYValue(...args) } }
  await assert.rejects(writePageDocument(load, html, { title: 'Changed' }, { rules, codec: monitored }),
    error => error instanceof PageWriteRefused && error.code === 'revision-required')
  await assert.rejects(writePageDocument(load, html, { title: 'Changed' }, { rules, codec: monitored, expectedRevision: `${revision}x` }),
    error => error instanceof PageWriteRefused && error.code === 'revision-stale')
  assert.equal(calls, 0)
})

test('a page codec without projection refuses clearly', async () => {
  const { html, revision } = await fixture()
  const incomplete = { readYValue, writeYValue }
  await assert.rejects(readPageDocument(load, html, { rules, codec: incomplete }),
    error => error instanceof TypeError && /codec\.projection/.test(error.message))
  await assert.rejects(writePageDocument(load, html, { title: 'Changed' }, { rules, codec: incomplete, expectedRevision: revision }),
    error => error instanceof TypeError && /codec\.projection/.test(error.message))
})

test('invalid page content and mixed invalid fields refuse without a changed document', async () => {
  const { html, revision } = await fixture()
  let calls = 0
  const monitored = { ...codec, writeYValue: async (...args) => { calls++; return writeYValue(...args) } }
  await assert.rejects(writePageDocument(load, html, { title: 'Changed', changeRev: 'fake' }, {
    rules: { ...rules, changeRev: 'article@data-rev' }, codec: monitored, expectedRevision: revision,
  }), error => error instanceof PageWriteRefused && error.code === 'invalid-content')
  await assert.rejects(writePageDocument(load, html, { title: 'Changed', script: 'evil' }, {
    rules: { ...rules, script: 'script[merge="blockeditor"]' }, codec: monitored, expectedRevision: revision,
  }), WriteRefused)
  assert.equal(calls, 0)
  assert.equal(load(html)('article h1').text(), 'Original')
})

test('a mixed valid write preserves unrelated source and a non-page document uses the old path', async () => {
  const { html, revision } = await fixture()
  const written = await writePageDocument(load, html, { title: 'Changed', other: 'Outside changed' }, { rules, codec, expectedRevision: revision })
  assert.equal(load(written.html)('#other').text(), 'Outside changed')
  assert.ok(written.html.includes('<!-- before -->'))
  assert.ok(written.html.includes('<!-- after -->'))
  const plain = '<!doctype html><html><body><h1>Old</h1></body></html>'
  assert.deepEqual(
    await writePageDocument(load, plain, { title: 'New' }, { rules: { title: 'h1' }, codec }),
    writeDocument(load, plain, { title: 'New' }, { rules: { title: 'h1' } }),
  )
})

test('rich text removal and image attributes become codec changes', async () => {
  const value = migrateHybridValues([{ blocks: {
    heading: { t: 'heading', pos: '1', level: 1, c: 'Original', m: [[8, 'b']] },
    image: { t: 'image', pos: '2', src: '/old.png', alt: 'Old' },
  } }])
  const before = await readYValue(value)
  const projected = renderBlocks(before.blocks)
  const html = `<script type="application/json" merge="blockeditor" clay="live">${JSON.stringify(value)}</script><article data-blockeditor="1" data-rev="${projected.rev}">${projected.html}</article>`
  const written = await writePageDocument(load, html, { title: 'Plain', src: '/new.png' }, {
    rules: { title: 'article h1', src: 'article figure img@src' }, codec, expectedRevision: before.revision,
  })
  const $ = load(written.html)
  const fresh = await readYValue(JSON.parse($('script[merge="blockeditor"]').text()))
  assert.equal(fresh.blocks.heading.c, 'Plain')
  assert.equal(fresh.blocks.heading.m, undefined)
  assert.equal(fresh.blocks.image.src, '/new.png')
  assert.equal($('article figure img').attr('src'), '/new.png')
})

test('malformed page store is an invalid-content refusal', async () => {
  const { html, revision } = await fixture()
  const invalid = html.replace(/"y":\{[^}]+\}/, '"y":{"seed":"broken"}')
  await assert.rejects(writePageDocument(load, invalid, { title: 'Changed' }, { rules, codec, expectedRevision: revision }),
    error => error instanceof PageWriteRefused && error.code === 'invalid-content')
})

test('authoritative reads strip executable markup from tool fallbacks', async () => {
  const value = migrateHybridValues([{ blocks: {
    tool: { t: 'tool', pos: '1', artifact: { fallbackHtml: '<script>bad()</script><p onclick="bad()">Safe</p>' } },
  } }])
  const html = `<script type="application/json" merge="blockeditor" clay="live">${JSON.stringify(value)}</script><article data-blockeditor="1"><p>Stale</p></article>`
  const read = await readPageDocument(load, html, { rules: { content: 'article section' }, codec })
  assert.equal(read.data.content, 'Safe')
})

test('existing table cells and board cards update through the codec', async () => {
  const value = migrateHybridValues([{ blocks: {
    table: { t: 'table', pos: '1', cols: { col: { pos: '1', name: 'Column' } }, rows: { row: { pos: '1', cells: { col: 'Cell' } } } },
    board: { t: 'board', pos: '2', columns: { todo: { pos: '1', name: 'Todo' } }, cards: { card: { pos: '1', col: 'todo', title: 'Card' } } },
  } }])
  const before = await readYValue(value)
  const projected = renderBlocks(before.blocks)
  const html = `<script type="application/json" merge="blockeditor" clay="live">${JSON.stringify(value)}</script><article data-blockeditor="1" data-rev="${projected.rev}">${projected.html}</article>`
  const written = await writePageDocument(load, html, { cell: 'Updated cell', card: 'Updated card' }, {
    rules: { cell: 'article table td', card: 'article section[data-type="board"] li' }, codec, expectedRevision: before.revision,
  })
  const $ = load(written.html)
  const fresh = await readYValue(JSON.parse($('script[merge="blockeditor"]').text()))
  assert.equal(fresh.blocks.table.rows.row.cells.col, 'Updated cell')
  assert.equal(fresh.blocks.board.cards.card.title, 'Updated card')
  assert.equal($('article table td').text(), 'Updated cell')
  assert.equal($('article section[data-type="board"] li').text(), 'Updated card')
})
