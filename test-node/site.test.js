import test from 'node:test'
import assert from 'node:assert/strict'
import * as cheerio from 'cheerio'
import { writeSite } from '../src/site.js'
import { extract } from '../src/engine/index.js'
import cheerioAdapter from '../src/adapters/cheerio.js'

const load = cheerio.load

const RULES = { site: { name: 'h1.site-name', nav: ['ul.nav li', { label: 'a' }] } }

const SRC = [
  '<!doctype html>',
  '<html>',
  '<head>',
  '<script data-rules-name="api" data-rules-version="1">{site:{name:"h1.site-name",nav:["ul.nav li",{label:"a"}]}}</script>',
  '</head>',
  '<body>',
  '<h1 class="site-name">Old name</h1>',
  '<ul class="nav">',
  '<li><a>Home</a></li>',
  '<li><a>About</a></li>',
  '</ul>',
  '<footer><p>Old footer</p></footer>',
  '</body>',
  '</html>',
].join('\n')

const STORE = {
  name: 'Acme',
  nav: [{ label: 'Home' }, { label: 'About' }, { label: 'Contact' }],
  footer: { text: 'New footer' },
}

function read(html) {
  return extract(cheerioAdapter, load(html).root(), RULES.site)
}

function labels(html) {
  const $ = load(html)
  return $('ul.nav li a').map((i, el) => $(el).text()).get()
}

function codes(result) {
  return result.failed.map((entry) => ({ key: entry.key, code: entry.code }))
}

test('a store with keys the page does not declare writes only the declared ones', () => {
  const result = writeSite(load, SRC, STORE)
  assert.equal(result.declared, true)
  assert.equal(result.changed, true)
  assert.deepEqual(result.applied, ['name', 'nav'])
  assert.deepEqual(result.failed, [])
  assert.deepEqual(read(result.html), {
    name: 'Acme',
    nav: [{ label: 'Home' }, { label: 'About' }, { label: 'Contact' }],
  })
  assert.ok(result.html.includes('<p>Old footer</p>'))
})

test('a nav list of three rows regrows from two rows', () => {
  const result = writeSite(load, SRC, STORE)
  assert.deepEqual(labels(result.html), ['Home', 'About', 'Contact'])
})

test('a nav list of one row shrinks from two rows', () => {
  const result = writeSite(load, SRC, { name: 'Acme', nav: [{ label: 'Home' }] })
  assert.deepEqual(labels(result.html), ['Home'])
})

test('an empty string clears text and an empty array empties a list', () => {
  const result = writeSite(load, SRC, { name: '', nav: [] })
  const $ = load(result.html)
  assert.equal($('h1.site-name').text(), '')
  assert.equal($('ul.nav li').length, 0)
  assert.deepEqual(read(result.html), { name: '', nav: [] })
})

test('a key the store does not hold leaves the page value alone', () => {
  const result = writeSite(load, SRC, { name: 'Acme' })
  assert.deepEqual(result.applied, ['name'])
  assert.equal(read(result.html).name, 'Acme')
  assert.deepEqual(labels(result.html), ['Home', 'About'])
})

test('a nav selector that matches nothing fails that key and still writes the rest', () => {
  const src = SRC.replace('nav:["ul.nav li",{label:"a"}]', 'nav:"ul.missing li"')
  const result = writeSite(load, src, { name: 'Acme', nav: 'Home' })
  assert.equal(result.declared, true)
  assert.deepEqual(result.applied, ['name'])
  assert.deepEqual(codes(result), [{ key: 'nav', code: 'WriteRejected' }])
  assert.equal(read(result.html).name, 'Acme')
})

test('a page with no rules tag declares nothing', () => {
  const src = '<html><body><h1 class="site-name">Old name</h1></body></html>'
  const result = writeSite(load, src, STORE)
  assert.deepEqual(result, { html: src, changed: false, declared: false, applied: [], failed: [] })
})

test('a page with no site key declares nothing', () => {
  const src = SRC.replace('{site:{name:"h1.site-name",nav:["ul.nav li",{label:"a"}]}}', '{title:"h1.site-name"}')
  const result = writeSite(load, src, STORE)
  assert.deepEqual(result, { html: src, changed: false, declared: false, applied: [], failed: [] })
})

test('a second call with the same store changes nothing', () => {
  const first = writeSite(load, SRC, STORE)
  const second = writeSite(load, first.html, STORE)
  assert.equal(second.changed, false)
  assert.equal(second.html, first.html)
})

test('a store value of the wrong shape fails that key with ShapeMismatch', () => {
  const result = writeSite(load, SRC, { name: 'Acme', nav: 'x' })
  assert.equal(result.declared, true)
  assert.deepEqual(result.applied, ['name'])
  assert.deepEqual(codes(result), [{ key: 'nav', code: 'ShapeMismatch' }])
  assert.equal(read(result.html).name, 'Acme')
  assert.deepEqual(labels(result.html), ['Home', 'About'])
})

test('a nested unknown key inside a nav row is dropped, not refused', () => {
  const nav = [{ label: 'Home', extra: 'ignored' }, { label: 'About', extra: 'ignored' }]
  const result = writeSite(load, SRC, { name: 'Acme', nav })
  assert.deepEqual(result.applied, ['name', 'nav'])
  assert.deepEqual(result.failed, [])
  assert.deepEqual(labels(result.html), ['Home', 'About'])
  assert.ok(!result.html.includes('ignored'))
})
