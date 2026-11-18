import assert from 'node:assert/strict'
import test from 'node:test'
import * as cheerio from 'cheerio'
import { JSDOM } from 'jsdom'
import cheerioAdapter from '../src/adapters/cheerio.js'
import domAdapter from '../src/adapters/dom.js'
import { apply, extract, findRulesIn } from '../src/engine/index.js'
import { WriteNotRoundTripped } from '../src/engine/errors.js'
import { writeDocument } from '../src/write.js'

const load = cheerio.load

const RULES =
  '{title:"h1",link:"#a@href",note:"#p@data-note",body:"#p@textContent",count:"#p@data-count",done:"#c@checked",items:["li",{name:"b",n:"i"}]}'

const SRC = [
  '<!doctype html>',
  '<html>',
  '<head>',
  `<script data-rules-name="api" data-rules-version="1">${RULES}</script>`,
  '</head>',
  '<body>',
  '<h1>Hello</h1>',
  '<a id="a" href="/">x</a>',
  '<p id="p" data-note="keep" data-count="1">plain</p>',
  '<input id="c" type="checkbox">',
  '<ul>',
  '  <li><b>A</b><i>1</i></li>',
  '  <li><b>B</b><i>2</i></li>',
  '</ul>',
  '</body>',
  '</html>',
].join('\n')

function read(html) {
  const $ = cheerio.load(html)
  const { rules } = findRulesIn(cheerioAdapter, $.root(), 'api')
  return extract(cheerioAdapter, $.root(), rules)
}

test('a partial object write verifies only the supplied fields', () => {
  const result = writeDocument(load, SRC, { title: 'World' })
  assert.equal(result.changed, true)
  assert.equal(read(result.html).title, 'World')
  assert.equal(read(result.html).link, '/')
  assert.equal(read(result.html).note, 'keep')
})

test('a partial row object keeps the fields the item omitted', () => {
  const result = writeDocument(load, SRC, { items: [{ name: 'Z' }] })
  assert.equal(result.changed, true)
  assert.deepEqual(read(result.html).items, [{ name: 'Z', n: '1' }])
})

test('a caller that omits a whole list is still accepted', () => {
  const result = writeDocument(load, SRC, { link: '/next', note: 'kept' })
  assert.equal(result.changed, true)
  assert.deepEqual(read(result.html).items, [{ name: 'A', n: '1' }, { name: 'B', n: '2' }])
  assert.equal(read(result.html).link, '/next')
  assert.equal(read(result.html).note, 'kept')
})

test('an implicit text rule compares trimmed, @textContent compares exactly', () => {
  const trimmed = writeDocument(load, SRC, { title: '  Padded  ' })
  assert.equal(trimmed.changed, true)
  assert.ok(trimmed.html.includes('<h1>  Padded  </h1>'))

  const exact = writeDocument(load, SRC, { body: '  kept  ' })
  assert.equal(exact.changed, true)
  assert.equal(read(exact.html).body, '  kept  ')
})

test('numeric scalars round-trip as text and as attributes', () => {
  const result = writeDocument(load, SRC, { title: 42, count: 7 })
  assert.equal(result.changed, true)
  assert.equal(read(result.html).title, '42')
  assert.equal(read(result.html).count, '7')
})

test('the string "false" unchecks a box instead of checking it', () => {
  const html = `<script data-rules-name="api" data-rules-version="1">{done:"#c@checked"}</script><input id="c" type="checkbox" checked>`
  const result = writeDocument(load, html, { done: 'false' })
  assert.equal(result.changed, true)
  assert.equal(cheerio.load(result.html)('#c').attr('checked'), undefined)
  assert.equal(read(result.html).done, 'false')

  const back = writeDocument(load, result.html, { done: 'true' })
  assert.equal(back.changed, true)
  assert.notEqual(cheerio.load(back.html)('#c').attr('checked'), undefined)
  assert.equal(read(back.html).done, 'true')
})

test('an empty attribute is written and an absent one stays absent', () => {
  const empty = writeDocument(load, SRC, { note: '' })
  assert.equal(cheerio.load(empty.html)('#p').attr('data-note'), '')
  assert.equal(read(empty.html).note, '')

  const removed = writeDocument(load, SRC, { note: null })
  assert.equal(cheerio.load(removed.html)('#p').attr('data-note'), undefined)
  assert.equal(read(removed.html).note, null)
})

test('a write of the value already in the source returns the source itself', () => {
  const result = writeDocument(load, SRC, { title: 'Hello', link: '/', note: 'keep' })
  assert.equal(result.changed, false)
  assert.equal(result.spliced, true)
  assert.equal(result.html, SRC)
})

test('a missing nested target throws instead of returning a false success', () => {
  const html = `<script data-rules-name="api" data-rules-version="1">{items:["li",{name:"em.missing"}]}</script><ul><li><b>A</b></li></ul>`
  const sentinel = 'SENTINEL-4f21'
  assert.throws(
    () => writeDocument(load, html, { items: [{ name: sentinel }] }),
    (err) => {
      assert.ok(err instanceof WriteNotRoundTripped)
      assert.equal(err.name, 'WriteNotRoundTripped')
      assert.deepEqual(err.path, ['items', 0, 'name'])
      assert.match(err.message, /items\[0\]\.name/)
      assert.ok(!err.message.includes(sentinel), 'the message must not carry visitor values')
      return true
    },
  )
  assert.equal(writeDocument(load, html, { items: [{ name: null }] }).changed, false)
})

test('a value the serialized source cannot carry throws', () => {
  // A NUL is the one thing the parser rewrites rather than normalizes: it
  // becomes U+FFFD, so the value cannot come back. A CRLF can, and does not
  // throw (see the newline-normalization tests below).
  const sentinel = 'SENTINEL\u00009c4d'
  assert.throws(
    () => writeDocument(load, SRC, { note: sentinel }),
    (err) => {
      assert.ok(err instanceof WriteNotRoundTripped)
      assert.deepEqual(err.path, ['note'])
      assert.ok(!err.message.includes('9c4d'), 'the message must not carry visitor values')
      return true
    },
  )
})

test('a CRLF value is accepted as the newline-normalized text the source keeps', () => {
  const text = writeDocument(load, SRC, { title: 'line1\r\nline2' })
  assert.equal(text.changed, true)
  assert.equal(read(text.html).title, 'line1\nline2')

  const exact = writeDocument(load, SRC, { body: 'line1\r\nline2' })
  assert.equal(exact.changed, true)
  assert.equal(read(exact.html).body, 'line1\nline2')
})

test('a leading CR or CRLF in textarea text survives too', () => {
  const html = '<script data-rules-name="api" data-rules-version="1">{ta:"textarea@textContent",pre:"pre@textContent"}</script><textarea></textarea><pre></pre>'
  const result = writeDocument(load, html, { ta: '\r\nline', pre: '\rline' })
  assert.equal(read(result.html).ta, '\nline')
  assert.equal(read(result.html).pre, '\nline')
})

test('an SVG textarea in a rewritten ancestor keeps its text exactly', () => {
  const html = '<svg id="wrapper"><textarea id="note">\nkeep</textarea></svg>'
  const rules = { title: '#wrapper@title' }
  const result = writeDocument(load, html, { title: 'new' }, { rules })
  assert.equal(cheerio.load(result.html)('#note').text(), '\nkeep')
})

test('a leading newline in pre/textarea text survives the write and the next parse', () => {
  const html =
    '<script data-rules-name="api" data-rules-version="1">{pre:"pre@textContent",ta:"textarea@textContent"}</script>' +
    '<pre></pre><textarea></textarea>'
  const result = writeDocument(load, html, { pre: '\nline1', ta: '\nhello' })
  assert.equal(result.changed, true)
  assert.equal(read(result.html).pre, '\nline1')
  assert.equal(read(result.html).ta, '\nhello')
})

test('the extra serialized newline follows the matched element, not the selector text', () => {
  const html = '<pre id="code"></pre><textarea id="note"></textarea>'
  const rules = { code: '#code@textContent', note: '#note@textContent' }
  const result = writeDocument(load, html, { code: '\nhello', note: '\nworld' }, { rules })

  assert.equal(result.changed, true)
  assert.ok(result.html.includes('<pre id="code">\n\nhello</pre>'))
  assert.deepEqual(extract(cheerioAdapter, cheerio.load(result.html).root(), rules), {
    code: '\nhello',
    note: '\nworld',
  })
})

test('the DOM adapter keeps the leading newline an ID-selected pre takes', () => {
  const document = new JSDOM('<pre id="code"></pre>').window.document
  const rules = { code: '#code@textContent' }

  apply(domAdapter, document, rules, { code: '\nhello' }, { templateAttr: 'cms-template' })

  assert.equal(document.getElementById('code').textContent, '\nhello')
  assert.deepEqual(extract(domAdapter, document, rules, {}), { code: '\nhello' })
})

test('a selector that depends on the value being written is still refused', () => {
  const rules = { state: '#t@data-state', openLabel: '#t[data-state="open"] > b' }
  const html = '<div id="t" data-state="open"><b>Open</b></div>'
  assert.equal(extract(cheerioAdapter, cheerio.load(html).root(), rules).openLabel, 'Open')
  assert.throws(
    () => writeDocument(load, html, { state: 'closed', openLabel: 'Open' }, { rules }),
    (err) => {
      assert.ok(err instanceof WriteNotRoundTripped)
      assert.deepEqual(err.path, ['openLabel'])
      return true
    },
  )
})

test('a partial write verifies only the rules it wrote', () => {
  const rules = { title: 'h1', broken: 'p:::' }
  const result = writeDocument(load, '<h1>T</h1><p>x</p>', { title: 'W' }, { rules })
  assert.equal(result.changed, true)
  assert.ok(result.html.includes('<h1>W</h1>'))
  assert.equal(result.html.includes('<p>x</p>'), true)
})
