import { test } from 'node:test'
import assert from 'node:assert/strict'

import { shapeMatch } from '../src/upgrade/shape-match.js'

test('shape-match: scalar carry + missing field stays undefined', () => {
  const v2Rules = { title: 'h1', subtitle: '.subtitle', tagline: '.tagline' }
  const v1Data = { title: 'hi', subtitle: 'hey' }
  const { data, summary } = shapeMatch(v1Data, v2Rules)
  assert.deepEqual(data, { title: 'hi', subtitle: 'hey' })
  assert.equal(summary.carriedOver, 2)
  assert.equal(summary.discarded, 0)
})

test('shape-match: extra v1 field is counted as discarded', () => {
  const v2Rules = { title: 'h1' }
  const v1Data = { title: 'hi', dropped: 'bye' }
  const { summary } = shapeMatch(v1Data, v2Rules)
  assert.equal(summary.carriedOver, 1)
  assert.equal(summary.discarded, 1)
})

test('shape-match: object array trimmed to v1 count, missing fields undefined', () => {
  const v2Rules = {
    products: ['.product', { name: '.name', price: '.price', description: '.description' }],
  }
  const v1Data = {
    products: [
      { name: 'A', price: '$1' },
      { name: 'B', price: '$2' },
    ],
  }
  const { data, summary } = shapeMatch(v1Data, v2Rules)
  assert.equal(data.products.length, 2)
  assert.deepEqual(data.products[0], { name: 'A', price: '$1' })
  assert.equal(summary.listItems, 2)
})

test('shape-match: scalar-array rule (sel[]) carries v1 array as-is', () => {
  const v2Rules = { tags: '.tag-cloud .tag[]' }
  const v1Data = { tags: ['a', 'b', 'c'] }
  const { data, summary } = shapeMatch(v1Data, v2Rules)
  assert.deepEqual(data.tags, ['a', 'b', 'c'])
  assert.equal(summary.listItems, 3)
  assert.equal(summary.carriedOver, 3)
  assert.equal(summary.discarded, 0)
})

test('shape-match: nested object array discards count correctly', () => {
  const v2Rules = {
    sections: ['.section', { title: '.title', items: ['.item', { text: '.text' }] }],
  }
  const v1Data = {
    sections: [
      { title: 'S1', items: [{ text: 'a', extra: 'x' }] },
    ],
  }
  const { summary } = shapeMatch(v1Data, v2Rules)
  assert.equal(summary.discarded, 1)
})

// A row is the owner's own. Written over a sample row, or over a clone of the list's first
// row, a field left undefined would keep that sample's value.
test('shape-match: inside a list row an empty v1 field stays empty', () => {
  const v2Rules = { cards: ['.card', { title: 'h3', cover: '@data-cover', note: '.note' }] }
  const v1Data = {
    cards: [
      { title: 'A', cover: null, note: null },
      { title: 'B', cover: 'red', note: 'kept' },
    ],
  }
  const { data, summary } = shapeMatch(v1Data, v2Rules)
  assert.deepEqual(data.cards, [
    { title: 'A', cover: null, note: null },
    { title: 'B', cover: 'red', note: 'kept' },
  ])
  assert.equal(summary.carriedOver, 4)
  assert.equal(summary.discarded, 0)
})

test('shape-match: rows inside rows keep their empty fields too', () => {
  const v2Rules = { lists: ['.list', { cards: ['.card', { title: 'h3', cover: '@data-cover' }] }] }
  const { data } = shapeMatch({ lists: [{ cards: [{ title: 'A', cover: null }] }] }, v2Rules)
  assert.deepEqual(data, { lists: [{ cards: [{ title: 'A', cover: null }] }] })
})

test('shape-match: outside a list an empty v1 field keeps v2\'s default, and a field v1 never had stays undefined in a row', () => {
  const v2Rules = { heading: 'h1', cards: ['.card', { title: 'h3', added: '@data-added' }] }
  const { data } = shapeMatch({ heading: null, cards: [{ title: 'A' }] }, v2Rules)
  assert.equal('heading' in data, false)
  assert.deepEqual(data.cards, [{ title: 'A' }])
})

// Writing null to such a property refuses the whole write, so an upgrade would refuse too.
test('shape-match: an empty v1 field that reads a property nothing can write is left alone in a row', () => {
  const v2Rules = { cards: ['.card', { title: 'h3', kind: '@tagName', count: '.steps@childElementCount', cover: '.art@data-cover' }] }
  const { data } = shapeMatch({ cards: [{ title: 'A', kind: null, count: null, cover: null }] }, v2Rules)
  assert.deepEqual(data.cards, [{ title: 'A', cover: null }])
})
