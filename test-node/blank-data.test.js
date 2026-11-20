import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

import { applyData, extractData, blankData } from '../src/data.js'

test('every key is filled, and a codec rule is left alone', () => {
  assert.deepEqual(
    blankData({ title: 'h1', tags: '.tag[]', rows: ['li', { name: '.n' }], meta: { note: 'p' }, grid: '#g@codec(sheet)' }),
    { title: null, tags: [], rows: [], meta: { note: null } },
  )
})

test('starting values win key by key and merge into objects and list rows; unknown keys are ignored', () => {
  assert.deepEqual(
    blankData(
      { meta: { title: 'h1', note: 'p' }, rows: ['li', { name: '.n', body: '.b' }] },
      { meta: { title: 'Journal' }, rows: [{ name: 'a', extra: 1 }], extra: 1 },
    ),
    { meta: { title: 'Journal', note: null }, rows: [{ name: 'a', body: null }] },
  )
})

const HTML =
  '<main><h1>Old title</h1><ul class="rows"><li><b class="n">old</b><span class="b">old body</span><i class="d">old note</i></li></ul>' +
  '<div class="lists"><section class="list"><h2>Old list</h2><ol class="cards"><li class="card"><span class="cn">old card</span></li><li class="card" cms-template><span class="cn">card seed</span></li></ol></section>' +
  '<section class="list" cms-template><h2>List seed</h2><ol class="cards"><li class="card" cms-template><span class="cn">card seed</span></li></ol></section></div></main>' +
  '<div cms-template hidden><ul class="rows"><li cms-template><b class="n">seed</b><span class="b">seed sample</span><i class="d">seed note</i></li></ul></div>'
const RULES = {
  title: 'h1',
  rows: ['ul.rows > li', { name: '.n', body: '.b' }],
  lists: ['div.lists > section.list', { title: 'h2', cards: ['ol.cards > li.card', { name: '.cn' }] }],
}

test('applied to a page, it empties the fields and nested lists and keeps the seeds', () => {
  const doc = new JSDOM(HTML).window.document
  applyData(doc, blankData(RULES), RULES)
  assert.deepEqual(extractData(doc, RULES), { title: '', rows: [], lists: [] })
  assert.equal(doc.querySelectorAll('div[cms-template] li').length, 1)
  assert.equal(doc.querySelectorAll('section.list[cms-template] li.card[cms-template]').length, 1)
})

test('a starting row after blanking is made from the seed, blanking omitted rule fields while keeping unmapped seed markup and nested seeds', () => {
  const doc = new JSDOM(HTML).window.document
  applyData(doc, blankData(RULES), RULES)
  applyData(doc, blankData(RULES, { rows: [{ name: 'appreciation', extra: 1 }], lists: [{ title: 'To do' }] }), RULES)
  assert.deepEqual(extractData(doc, RULES), {
    title: '',
    rows: [{ name: 'appreciation', body: '' }],
    lists: [{ title: 'To do', cards: [] }],
  })
  assert.equal(doc.querySelector('main ul.rows > li .d').textContent, 'seed note')
  assert.equal(doc.querySelectorAll('main section.list:not([cms-template]) li.card[cms-template]').length, 1)
})

test('a blank attribute rule removes the attribute instead of writing it empty', () => {
  const doc = new JSDOM('<main><div class="card" data-done hidden-note="x">Ship</div></main>').window.document
  const rules = { done: '.card@data-done', name: '.card' }
  applyData(doc, blankData(rules), rules)
  const card = doc.querySelector('.card')
  assert.equal(card.hasAttribute('data-done'), false)
  assert.equal(card.textContent, '')
})
