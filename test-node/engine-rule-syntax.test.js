import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as cheerio from 'cheerio'

import { ruleAttrIndex, splitRule, extract, apply } from '../src/engine/index.js'
import cheerioAdapter from '../src/adapters/cheerio.js'

test('ruleAttrIndex finds the separator, not an @ inside the selector', () => {
  assert.equal(ruleAttrIndex('a.btn'), -1)
  assert.equal(ruleAttrIndex('a.btn@href'), 5)
  assert.equal(ruleAttrIndex('@href'), 0)

  // The bug this module exists for: every one of these is a correct selector
  // whose @ belongs to the selector, not to a prop name.
  assert.equal(ruleAttrIndex('a[href="mailto:hi@example.com"]'), -1)
  assert.equal(ruleAttrIndex("a[href='mailto:hi@example.com']"), -1)
  assert.equal(ruleAttrIndex('a:not([href*="@"])'), -1)
  assert.equal(ruleAttrIndex('.\\@container .card'), -1)

  // ...and the separator is still found when one of those carries a prop.
  assert.equal(ruleAttrIndex('a[href="mailto:hi@example.com"]@href'), 31)
  assert.equal(ruleAttrIndex('a[href="mailto:a@b.c"] .label@title'), 29)
})

test('ruleAttrIndex takes the LAST separator', () => {
  assert.equal(ruleAttrIndex('a@b@c'), 3)
})

test('splitRule returns the whole rule as the selector when there is no prop', () => {
  assert.deepEqual(splitRule('a[href="mailto:hi@example.com"]'), {
    selector: 'a[href="mailto:hi@example.com"]',
    prop: null,
  })
  assert.deepEqual(splitRule('a.btn@href'), { selector: 'a.btn', prop: 'href' })
  assert.deepEqual(splitRule('@href'), { selector: '', prop: 'href' })
  assert.deepEqual(splitRule('a.btn@'), { selector: 'a.btn', prop: null })
})

const MAILTO_HTML = `<div id="root">
  <a class="btn" href="mailto:hello@michaellai.au"><span class="btn-label">Say hi</span></a>
</div>`

test('a mailto selector reads its text rather than a mangled prop', () => {
  const $ = cheerio.load(MAILTO_HTML)
  const rules = { emailBtn: 'a[href="mailto:hello@michaellai.au"] .btn-label' }
  assert.deepEqual(extract(cheerioAdapter, $('#root'), rules), { emailBtn: 'Say hi' })
})

test('a mailto selector writes back to the element it named', () => {
  const $ = cheerio.load(MAILTO_HTML)
  const rules = { emailBtn: 'a[href="mailto:hello@michaellai.au"] .btn-label' }
  apply(cheerioAdapter, $('#root'), rules, { emailBtn: 'Email me' })
  assert.equal($('.btn-label').text(), 'Email me')
  assert.equal($('.btn').attr('href'), 'mailto:hello@michaellai.au')
})

test('a mailto selector with a real prop part still splits at the prop', () => {
  const $ = cheerio.load(MAILTO_HTML)
  const rules = { to: 'a[href="mailto:hello@michaellai.au"]@href' }
  assert.deepEqual(extract(cheerioAdapter, $('#root'), rules), {
    to: 'mailto:hello@michaellai.au',
  })
})

test('splitRule takes a trailing [*] out of the selector and reports all', () => {
  assert.deepEqual(splitRule('.site-name[*]'), { selector: '.site-name', prop: null, all: true })
  assert.equal(splitRule('.site-name').all, undefined)
})

test('splitRule finds a [*] marker before a prop part', () => {
  assert.deepEqual(splitRule('a.home[*]@href'), { selector: 'a.home', prop: 'href', all: true })
  assert.deepEqual(splitRule('@href'), { selector: '', prop: 'href' })
})

test('a [*] rule writes every match of a selector that carries an @', () => {
  const $ = cheerio.load(`<div id="root">
  <a href="mailto:hi@example.com"><span class="btn-label">A</span></a>
  <a href="mailto:hi@example.com"><span class="btn-label">B</span></a>
</div>`)
  const rules = { emailBtn: 'a[href="mailto:hi@example.com"] .btn-label[*]' }
  apply(cheerioAdapter, $('#root'), rules, { emailBtn: 'Email me' })
  assert.deepEqual($('.btn-label').map((_, el) => $(el).text()).get(), ['Email me', 'Email me'])
})
