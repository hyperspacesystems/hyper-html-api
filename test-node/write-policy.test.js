import assert from 'node:assert/strict'
import test from 'node:test'
import * as cheerio from 'cheerio'
import cheerioAdapter from '../src/adapters/cheerio.js'
import { apply, guardAdapter } from '../src/engine/index.js'
import { WriteRefused } from '../src/engine/errors.js'

function run(html, rules, data) {
  const $ = cheerio.load(html)
  const g = guardAdapter(cheerioAdapter)
  apply(g, $.root(), rules, data)
  g.assertClean()
  return $
}

test('a text write to a <script> is refused', () => {
  assert.throws(
    () => run('<script id="s">x</script>', { c: '#s' }, { c: 'alert(1)' }),
    (e) => e instanceof WriteRefused &&
      e.refusals.length === 1 &&
      e.refusals[0].target === '<script#s>',
  )
})

test('a text write to a <style> is refused', () => {
  assert.throws(
    () => run('<style id="s">a{}</style>', { c: '#s' }, { c: 'b{}' }),
    (e) => e instanceof WriteRefused && e.refusals.length === 1,
  )
})

test('an @onclick attribute write is refused', () => {
  assert.throws(
    () => run('<a id="a" href="/x">x</a>', { h: '#a@onclick' }, { h: 'alert(1)' }),
    (e) => e instanceof WriteRefused && e.refusals.length === 1,
  )
})

test('script URLs in href are refused however they are spelled', () => {
  for (const value of [
    'javascript:alert(1)',
    '  JaVaScRiPt:alert(1)',
    'java\tscript:alert(1)',
    'vbscript:x',
    'data:text/html,<script>alert(1)</script>',
  ]) {
    assert.throws(
      () => run('<a id="a" href="/x">x</a>', { h: '#a@href' }, { h: value }),
      (e) => e instanceof WriteRefused && e.refusals.length === 1,
      `expected a refusal for ${JSON.stringify(value)}`,
    )
  }
})

test('innerHTML and outerHTML rule forms are refused', () => {
  assert.throws(
    () => run('<p id="p">x</p>', { h: '#p@innerHTML' }, { h: '<b>y</b>' }),
    (e) => e instanceof WriteRefused && e.refusals.length === 1,
  )
  assert.throws(
    () => run('<p id="p">x</p>', { h: '#p@outerHTML' }, { h: '<p>y</p>' }),
    (e) => e instanceof WriteRefused && e.refusals.length === 1,
  )
})

test('style and srcdoc attributes are refused', () => {
  assert.throws(
    () => run('<p id="p">x</p>', { s: '#p@style' }, { s: 'color:red' }),
    (e) => e instanceof WriteRefused && e.refusals.length === 1,
  )
  assert.throws(
    () => run('<p id="p">x</p>', { s: '#p@srcdoc' }, { s: '<b>y</b>' }),
    (e) => e instanceof WriteRefused && e.refusals.length === 1,
  )
})

test('a write on a refused tag is refused even for content attributes', () => {
  assert.throws(
    () => run('<head><meta id="m" name="d" content="a"></head>', { c: '#m@content' }, { c: 'b' }),
    (e) => e instanceof WriteRefused && e.refusals.length === 1,
  )
})

test('a text write over the data rules tag is refused', () => {
  assert.throws(
    () => run(
      '<div id="d"><p>x</p><script data-rules-name="api">{}</script></div>',
      { t: '#d' },
      { t: 'gone' },
    ),
    (e) => e instanceof WriteRefused &&
      e.refusals.length === 1 &&
      e.refusals[0].reason.includes('data rules tag'),
  )
})

test('a script URL in srcset is refused even outside the first candidate', () => {
  assert.throws(
    () => run('<img id="i" srcset="a.png 1x">', { s: '#i@srcset' }, { s: 'a.png 1x, javascript:alert(1) 2x' }),
    (e) => e instanceof WriteRefused && e.refusals.length === 1,
  )
})

test('every violation is reported in one error', () => {
  assert.throws(
    () => run('<a id="a" href="/">x</a><p id="p">y</p>', { h: '#a@href', o: '#p@onclick' }, { h: 'javascript:1', o: 'x' }),
    (e) => e instanceof WriteRefused && e.refusals.length === 2,
  )
})

test('text is text, not markup', () => {
  const $ = run('<p id="p">x</p>', { t: '#p' }, { t: 'a < b' })
  assert.equal($('#p').text(), 'a < b')
  assert.equal($('#p').html(), 'a &lt; b')
})

test('harmless URL schemes are allowed', () => {
  for (const value of ['/next', 'https://example.com', 'mailto:a@b.c', 'obsidian://open?vault=x', '//cdn.example.com/x']) {
    const $ = run('<a id="a" href="/">x</a>', { h: '#a@href' }, { h: value })
    assert.equal($('#a').attr('href'), value, `expected href to be ${JSON.stringify(value)}`)
  }
})

test('content attribute writes are allowed', () => {
  const $ = run('<p id="p">x</p>', {
    c: '#p@class',
    t: '#p@title',
    d: '#p@data-state',
    a: '#p@aria-label',
  }, { c: 'note', t: 'Tip', d: 'open', a: 'Note' })
  assert.equal($('#p').attr('class'), 'note')
  assert.equal($('#p').attr('title'), 'Tip')
  assert.equal($('#p').attr('data-state'), 'open')
  assert.equal($('#p').attr('aria-label'), 'Note')
})

test('a checkbox property write is allowed', () => {
  const $ = run('<input id="c" type="checkbox">', { done: '#c@checked' }, { done: true })
  assert.notEqual($('#c').attr('checked'), undefined)
})

test('flattening children away is allowed', () => {
  const $ = run('<li id="l"><input type="checkbox"> Buy milk</li>', { t: '#l' }, { t: 'Buy bread' })
  assert.equal($('#l').html(), 'Buy bread')
})

test('a list grows and shrinks through the guard', () => {
  const grown = run('<ul><li>A</li><li>B</li></ul>', { items: 'li[]' }, { items: ['A', 'C', 'D'] })
  assert.deepEqual(grown('li').map((_, n) => grown(n).text()).get(), ['A', 'C', 'D'])
  const shrunk = run('<ul><li>A</li><li>B</li></ul>', { items: 'li[]' }, { items: ['D'] })
  assert.deepEqual(shrunk('li').map((_, n) => shrunk(n).text()).get(), ['D'])
})
