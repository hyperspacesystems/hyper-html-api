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

test('migrateInto: v2 fields with no v1 data keep template defaults', () => {
  const $ = load(V2_HTML)
  migrateInto(cheerioAdapter, $.root(), {
    api: { heading: 'Mine', products: [{ name: 'Solo', price: '$9' }] },
    settings: { ownerName: 'D' },
  })
  assert.equal($('.product').eq(0).find('.blurb').text(), 'default')
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
