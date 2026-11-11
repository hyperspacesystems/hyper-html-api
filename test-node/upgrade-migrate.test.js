import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import * as cheerio from 'cheerio'

import { migrateInto } from '../src/upgrade/migrate.js'
import { shapeMatch } from '../src/upgrade/shape-match.js'
import { extract, findRulesIn } from '../src/engine/index.js'
import cheerioAdapter from '../src/adapters/cheerio.js'

function load(html) {
  return cheerio.load(html)
}

const V2_HTML = `
<script data-rules-name="api" data-rules-version="1">
  {"heading":"h1","products":[".product",{"name":".name","price":".price","blurb":".blurb"}]}
</script>
<script data-rules-name="settings" data-rules-version="1">{"ownerName":".owner-name"}</script>
<h1>New Store</h1>
<div class="products">
  <div class="product"><span class="name">Sample</span><span class="price">$0</span><span class="blurb">default</span></div>
</div>
<div class="owner-name">Nobody</div>
`

test('migrateInto: exact-name join applies matching entries', () => {
  const $ = load(V2_HTML)
  const { totals, byName, rulesTagCount } = migrateInto(cheerioAdapter, $.root(), {
    api: {
      heading: 'My Store',
      products: [
        { name: 'Apple', price: '$1' },
        { name: 'Banana', price: '$2' },
      ],
    },
    settings: { ownerName: 'David' },
  })

  assert.equal($('h1').text(), 'My Store')
  assert.equal($('.product').length, 2)
  assert.equal($('.product').eq(0).find('.name').text(), 'Apple')
  assert.equal($('.product').eq(1).find('.price').text(), '$2')
  assert.equal($('.owner-name').text(), 'David')
  assert.equal(rulesTagCount, 2)
  assert.equal(totals.listItems, 2)
  assert.equal(byName.api.carriedOver > 0, true)
  assert.equal(byName.settings.carriedOver, 1)
})

test('migrateInto: outside a list, a v2 field with no v1 data keeps the template default', () => {
  const $ = load(V2_HTML)
  migrateInto(cheerioAdapter, $.root(), {
    api: { products: [{ name: 'Solo', price: '$9', blurb: 'Mine' }] },
    settings: { ownerName: 'D' },
  })
  assert.equal($('h1').text(), 'New Store')
  assert.equal($('.product').eq(0).find('.blurb').text(), 'Mine')
})

// A row is the owner's own, so it never starts with the sample row's value (David, 2026-11-11).
test('migrateInto: inside a list row, a v2 field with no v1 data starts empty', () => {
  const $ = load(V2_HTML)
  migrateInto(cheerioAdapter, $.root(), {
    api: { heading: 'Mine', products: [{ name: 'Solo', price: '$9' }, { name: 'Second', price: '$3' }] },
    settings: { ownerName: 'D' },
  })
  assert.deepEqual($('.product').map((i, el) => $(el).find('.name').text() + '|' + $(el).find('.blurb').text()).get(), ['Solo|', 'Second|'])
})

test('migrateInto: v2 tag with no matching v1 entry stays untouched', () => {
  const $ = load(V2_HTML)
  const { byName } = migrateInto(cheerioAdapter, $.root(), {
    api: { heading: 'Only api', products: [] },
  })
  assert.equal($('.owner-name').text(), 'Nobody')
  assert.deepEqual(byName.settings, { carriedOver: 0, discarded: 0, listItems: 0 })
})

test('migrateInto: v1-only entries are counted as discarded', () => {
  const $ = load(V2_HTML)
  const { totals } = migrateInto(cheerioAdapter, $.root(), {
    api: { heading: 'X', products: [] },
    legacy: { a: '1', b: { c: '2', d: '3' } },
  })
  assert.equal(totals.discarded, 3)
})

test('migrateInto: zero rules tags reports rulesTagCount 0 and applies nothing', () => {
  const $ = load('<h1>Plain</h1>')
  const { rulesTagCount, totals } = migrateInto(cheerioAdapter, $.root(), {
    api: { heading: 'X' },
  })
  assert.equal(rulesTagCount, 0)
  assert.equal($('h1').text(), 'Plain')
  assert.equal(totals.discarded, 1)
})

test('shapeMatch: object in a scalar slot is dropped, not carried', () => {
  const { data, summary } = shapeMatch(
    { title: { nested: 'oops', deep: 'x' } },
    { title: 'h1' },
  )
  assert.equal(data.title, undefined)
  assert.equal(summary.carriedOver, 0)
  assert.equal(summary.discarded, 2)
})

// An upgrade pours a document's data into the new version's sample markup. A row whose
// nested list is empty at that spot in the sample has no sibling to clone, so it grows
// from the page's [cms-template] seeds, the way a write does.

const SEEDS = { templateAttr: 'cms-template' }

function readApi(html) {
  const $ = load(html)
  const { rules } = findRulesIn(cheerioAdapter, $.root(), 'api')
  return extract(cheerioAdapter, $.root(), rules, SEEDS)
}

const NESTED_V2 = `
<script data-rules-name="api" data-rules-version="1">
  {"cards":["ol.cards > li.card",{"title":"h3","steps":[":scope > section.steps",{"name":"h4"}],"links":["ul.links > li",{"href":"a@href"}]}]}
</script>
<main>
<ol class="cards">
  <li class="card"><h3>Sample</h3><ul class="links"></ul></li>
</ol>
</main>
<div id="api-seeds" hidden cms-template>
<ol class="cards">
  <li class="card" cms-template><h3></h3><section class="steps" cms-template><h4></h4></section><ul class="links"><li cms-template><a href=""></a></li></ul></li>
</ol>
</div>
`

test('migrateInto: a nested list that is empty in the new sample grows from its seed', () => {
  const data = {
    cards: [
      { title: 'Mine', steps: [{ name: 'First' }, { name: 'Second' }], links: [{ href: 'https://example.com/a' }] },
      { title: 'Second card', steps: [], links: [{ href: 'https://example.com/b' }] },
    ],
  }
  const $ = load(NESTED_V2)
  const { totals } = migrateInto(cheerioAdapter, $.root(), { api: data })

  assert.deepEqual(readApi($.html()), data)
  assert.equal(totals.listItems, 6)
  // The rows are in the board, not in the bank, and none of them is still marked as a seed.
  assert.equal($('main section.steps').length, 2)
  assert.equal($('main ul.links > li').length, 2)
  assert.equal($('main [cms-template]').length, 0)
  // The bank is as it was, for the next row that needs it.
  assert.equal($('#api-seeds section.steps[cms-template]').length, 1)
  assert.equal($('#api-seeds ul.links > li[cms-template]').length, 1)
  assert.equal($('#api-seeds li.card[cms-template]').length, 1)
})

test('migrateInto: a list that is empty in the new sample and has no seed still refuses', () => {
  const $ = load(NESTED_V2.replace('<section class="steps" cms-template><h4></h4></section>', ''))
  assert.throws(
    () => migrateInto(cheerioAdapter, $.root(), { api: { cards: [{ title: 'Mine', steps: [{ name: 'First' }], links: [] }] } }),
    /cannot add items to empty list at "cards\.0\.steps"/,
  )
})

const KANBAN = fs.readFileSync(new URL('./fixtures/kanban-seeds.html', import.meta.url), 'utf8')

test('migrateInto: an unchanged Kanban board upgrades into the same board', () => {
  const data = readApi(KANBAN)
  const $ = load(KANBAN)
  migrateInto(cheerioAdapter, $.root(), { api: data })
  assert.deepEqual(readApi($.html()), data)
})

test('migrateInto: a Kanban board whose bare cards gained a checklist, a comment and a link upgrades whole', () => {
  const data = readApi(KANBAN)
  const cards = data.lists.flatMap((list) => list.cards)
  const bare = cards.filter((card) => !card.checklists.length && !card.comments.length && !card.attachments.length)
  // Most sample cards hold none of the three, the first card of the first list included.
  assert.equal(bare.length > 7, true)
  assert.equal(bare.includes(data.lists[0].cards[0]), true)

  bare.forEach((card, n) => {
    card.checklists = [{ id: `k-new${n}`, name: 'Steps', items: [{ id: `i-new${n}a`, text: 'One', done: '', member: null }, { id: `i-new${n}b`, text: 'Two', done: null, member: null }] }]
    card.comments = [{ id: `m-new${n}`, by: 'p-me', at: '2026-11-11T09:00:00.000Z', edited: null, text: 'A note' }]
    card.attachments = [{ id: `a-new${n}`, name: 'Brief', href: 'https://example.com/brief', kind: 'link' }]
  })

  const $ = load(KANBAN)
  migrateInto(cheerioAdapter, $.root(), { api: data })
  // Reading skips anything still marked as a seed, so equal data also says no grown row kept the mark.
  assert.deepEqual(readApi($.html()), data)
  assert.equal($('#api-seeds section.checklist[cms-template]').length, 1)
  assert.equal($('#api-seeds ol.comments > li[cms-template]').length, 1)
  assert.equal($('#api-seeds ul.attachments > li[cms-template]').length, 1)
})

// A row is written over the sample row at the same place, or over a clone of the list's
// first row. A field the owner's row has empty must end up empty, not keep that sample's value.

const ROWS_V2 = `
<script data-rules-name="api" data-rules-version="1">
  {"cards":["ol.cards > li.card",{"title":"h3","cover":"@data-cover","done":"@data-done","note":"p.note"}]}
</script>
<ol class="cards">
  <li class="card" data-cover="red" data-done><h3>Sample one</h3><p class="note">Sample note one</p></li>
  <li class="card" data-cover="blue"><h3>Sample two</h3><p class="note">Sample note two</p></li>
</ol>
`

test('migrateInto: a row with an empty field does not take the value of the sample row at its place', () => {
  const $ = load(ROWS_V2)
  migrateInto(cheerioAdapter, $.root(), {
    api: {
      cards: [
        { title: 'Mine, with nothing set', cover: null, done: null, note: null },
        { title: 'Mine, with everything set', cover: 'green', done: '', note: 'My note' },
        { title: 'A third, built from the first sample', cover: null, done: null, note: null },
      ],
    },
  })
  const rows = $('li.card').map((i, el) => ({
    title: $(el).find('h3').text(),
    cover: $(el).attr('data-cover') ?? null,
    done: $(el).attr('data-done') ?? null,
    note: $(el).find('p.note').text(),
  })).get()
  assert.deepEqual(rows, [
    { title: 'Mine, with nothing set', cover: null, done: null, note: '' },
    { title: 'Mine, with everything set', cover: 'green', done: '', note: 'My note' },
    { title: 'A third, built from the first sample', cover: null, done: null, note: '' },
  ])
})

// What a new version adds to every row: an attribute, a tick, an id, a list of steps, a list of tags.
const ADDED_V2 = `
<script data-rules-name="api" data-rules-version="1">
  {"heading":"h1","rows":["table.rows > tbody > tr.row",{"label":".label","id":"@id","flag":"@data-flag","done":"input.done@checked","steps":["ul.steps > li",{"text":"@textContent"}],"tags":".tag[]"}]}
</script>
<h1>Sample heading</h1>
<table class="rows"><tbody>
  <tr class="row" id="row-sample" data-flag="hot"><td class="label">Sample row</td><td><input class="done" type="checkbox" checked><ul class="steps"><li>Sample step one</li><li>Sample step two</li></ul><span class="tag">sample</span><span class="tag">tag</span></td></tr>
</tbody></table>
<ul hidden><li cms-template></li></ul>
`
const addedRows = ($) => $('tr.row').map((i, el) => ({
  label: $(el).find('.label').text(),
  id: $(el).attr('id') ?? null,
  flag: $(el).attr('data-flag') ?? null,
  done: $(el).find('input.done').attr('checked') !== undefined,
  steps: $(el).find('ul.steps > li').map((j, li) => $(li).text()).get(),
  tags: $(el).find('.tag').map((j, tag) => $(tag).text()).get(),
})).get()

// The calculator's case: 1.0.0 never recorded a row's id, and 1.1.0's sample row has one.
test('migrateInto: rows from a version that had none of the new fields take nothing from the sample row', () => {
  const $ = load(ADDED_V2)
  migrateInto(cheerioAdapter, $.root(), {
    api: { rows: [{ label: 'Studio rent' }, { label: 'Accountant' }] },
  })
  // An emptied id is written as an empty id attribute, as every empty id is, so '' and none count the same here.
  assert.deepEqual(addedRows($).map((row) => ({ ...row, id: row.id || null })), [
    { label: 'Studio rent', id: null, flag: null, done: false, steps: [], tags: [] },
    { label: 'Accountant', id: null, flag: null, done: false, steps: [], tags: [] },
  ])
  // Outside the list the new version's own heading stays.
  assert.equal($('h1').text(), 'Sample heading')
})

test('migrateInto: rows that have the new fields keep their own values, beside rows that have none', () => {
  const $ = load(ADDED_V2)
  migrateInto(cheerioAdapter, $.root(), {
    api: {
      rows: [
        { label: 'Bare' },
        { label: 'Full', id: 'row-mine', flag: 'cold', done: true, steps: [{ text: 'My step' }], tags: ['mine'] },
      ],
    },
  })
  assert.deepEqual(addedRows($).map((row) => ({ ...row, id: row.id || null })), [
    { label: 'Bare', id: null, flag: null, done: false, steps: [], tags: [] },
    { label: 'Full', id: 'row-mine', flag: 'cold', done: true, steps: ['My step'], tags: ['mine'] },
  ])
})

// The Journal's case: an entry's pin is an attribute, and a sample entry may ship pinned.
test('migrateInto: an unpinned entry stays unpinned where the new version\'s sample entry is pinned', () => {
  const $ = load(`
<script data-rules-name="api" data-rules-version="1">
  {"entries":["#entries > article.entry",{"id":"@data-id","body":".entry-body@textContent","deletedAt":"@data-deleted-at","pinned":"@data-pinned"}]}
</script>
<div id="entries">
  <article class="entry" data-id="welcm1" data-pinned="true"><code class="entry-body">Welcome</code></article>
  <article class="entry" data-id="plan01" data-deleted-at=""><code class="entry-body">A plan</code></article>
</div>
`)
  migrateInto(cheerioAdapter, $.root(), {
    api: {
      entries: [
        { id: 'mine01', body: 'Mine, never pinned', deletedAt: null, pinned: null },
        { id: 'mine02', body: 'Mine, pinned', deletedAt: null, pinned: 'true' },
        { id: 'mine03', body: 'Mine, deleted', deletedAt: '2026-11-01T10:00:00', pinned: null },
      ],
    },
  })
  const entries = $('article.entry').map((i, el) => ({
    id: $(el).attr('data-id'),
    body: $(el).find('.entry-body').text(),
    pinned: $(el).attr('data-pinned') ?? null,
    deletedAt: $(el).attr('data-deleted-at') ?? null,
  })).get()
  assert.deepEqual(entries, [
    { id: 'mine01', body: 'Mine, never pinned', pinned: null, deletedAt: null },
    { id: 'mine02', body: 'Mine, pinned', pinned: 'true', deletedAt: null },
    { id: 'mine03', body: 'Mine, deleted', pinned: null, deletedAt: '2026-11-01T10:00:00' },
  ])
})

// A missing description element reads as null and an empty one as ''. Both mean no description.
const sameBoard = (data) => JSON.parse(JSON.stringify(data, (key, value) => (key === 'desc' && value === '' ? null : value)))

test('migrateInto: a Kanban board with marks removed, a card moved and a card added upgrades into the same board', () => {
  const data = readApi(KANBAN)
  const cards = () => data.lists.flatMap((list) => list.cards)
  const done = cards().find((card) => card.complete === '')
  const covered = cards().find((card) => card.cover)
  const labelled = cards().find((card) => card.labels)
  const described = data.lists[1].cards.find((card) => card.desc)
  assert.equal(Boolean(done && covered && labelled && described), true)

  // The owner unticks Complete, picks No cover and unticks a card's only label.
  done.complete = null
  covered.cover = null
  labelled.labels = null
  // A card with a description moves to the end of its list, so every card after it moves up one place.
  const list = data.lists[1]
  list.cards.push(list.cards.splice(list.cards.indexOf(described), 1)[0])
  // A new card with only a title goes first in a list whose first sample card has a label.
  data.lists[0].cards.unshift({
    id: 'c-new001', num: '99', title: 'Added by the owner', desc: null, labels: null, cover: null, coverImage: null,
    due: null, start: null, complete: null, members: null, checklists: [], comments: [], attachments: [],
  })

  const $ = load(KANBAN)
  migrateInto(cheerioAdapter, $.root(), { api: data })
  assert.deepEqual(sameBoard(readApi($.html())), sameBoard(data))
})

