import test from 'node:test'
import assert from 'node:assert/strict'
import * as cheerio from 'cheerio'
import { writeSite, readSite, siteValueProblem, mergeSiteEdit } from '../src/site.js'
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

const editPage = ({ strip = '', name = 'Ines', nav = '<li><a href="index.html">Home</a></li><li><a href="cv.html">CV</a></li>', rules = true } = {}) => [
  '<!doctype html>', '<html>', '<head>',
  rules ? '<script type="application/json" data-rules-name="api" data-rules-version="1">{"site":{"strip":{"hidden":".strip@hidden","org":".org"},"name":".brand-name","nav":[".nav-list > li",{"label":"a","href":"a@href"}],"tags":".tag[]"},"own":".own"}</script>' : '',
  '</head>', '<body>',
  `<div class="strip"${strip}><span class="org">Uni</span></div>`,
  `<span class="brand-name">${name}</span>`,
  `<ul class="nav-list"><template><li><a href="#">Label</a></li></template>${nav}</ul>`,
  '<span class="tag">a</span><span class="tag">b</span>',
  '<p class="own">mine</p>', '</body>', '</html>',
].join('\n')

test('readSite returns the declared rule and the values the page holds', () => {
  const read = readSite(load, editPage())
  assert.equal(read.declared, true)
  assert.deepEqual(read.data, { strip: { hidden: null, org: 'Uni' }, name: 'Ines', nav: [{ label: 'Home', href: 'index.html' }, { label: 'CV', href: 'cv.html' }], tags: ['a', 'b'] })
  assert.deepEqual(Object.keys(read.rule), ['strip', 'name', 'nav', 'tags'])
})

test('readSite reads a hidden block as an empty string', () => {
  assert.equal(readSite(load, editPage({ strip: ' hidden' })).data.strip.hidden, '')
})

test('readSite on a page without rules declares nothing', () => {
  assert.deepEqual(readSite(load, editPage({ rules: false })), { declared: false, rule: null, data: {}, present: {}, broken: [] })
})

test('readSite does not read a template blueprint as a row', () => {
  assert.equal(readSite(load, editPage()).data.nav.length, 2)
})

test('siteValueProblem accepts every value a healthy page holds', () => {
  const { rule, data } = readSite(load, editPage())
  for (const key of Object.keys(rule)) assert.equal(siteValueProblem(rule[key], data[key]), null, key)
})

test('siteValueProblem refuses a row whose text rule matched nothing', () => {
  const { rule, data } = readSite(load, editPage({ nav: '<li>Home</li><li><a href="cv.html">CV</a></li>' }))
  assert.equal(siteValueProblem(rule.nav, data.nav), 'unreadable')
})

test('siteValueProblem refuses an emptied list and an emptied scalar list', () => {
  const { rule, data } = readSite(load, editPage({ nav: '' }))
  assert.equal(siteValueProblem(rule.nav, data.nav), 'empty-list')
  assert.equal(siteValueProblem(rule.tags, []), 'empty-list')
})

test('siteValueProblem accepts an absent attribute and an empty text, and refuses a missing text', () => {
  assert.equal(siteValueProblem('.strip@hidden', null), null)
  assert.equal(siteValueProblem('.brand-name', ''), null)
  assert.equal(siteValueProblem('.brand-name', null), 'unreadable')
})

test('mergeSiteEdit keeps store fields the rule does not name', () => {
  const { rule } = readSite(load, editPage())
  assert.deepEqual(mergeSiteEdit(rule.strip, { hidden: null, org: 'Uni', extra: 'kept' }, { hidden: '', org: 'Uni' }), { hidden: '', org: 'Uni', extra: 'kept' })
})

test('mergeSiteEdit takes a list whole from the page', () => {
  const { rule } = readSite(load, editPage())
  assert.deepEqual(mergeSiteEdit(rule.nav, [{ label: 'Old', href: 'o.html', icon: 'x' }], [{ label: 'Home', href: 'index.html' }]), [{ label: 'Home', href: 'index.html' }])
})

test('mergeSiteEdit starts from an empty object when the store has no value', () => {
  const { rule } = readSite(load, editPage())
  assert.deepEqual(mergeSiteEdit(rule.strip, undefined, { hidden: null, org: 'New' }), { hidden: null, org: 'New' })
})

test('a merged edit written back through writeSite leaves the editing page unchanged and moves another page to it', () => {
  const edited = editPage({ strip: ' hidden', name: 'Dr. Ines', nav: '<li><a href="index.html">Start</a></li><li><a href="cv.html">CV</a></li><li><a href="new.html">New</a></li>' })
  const { rule, data } = readSite(load, edited)
  const store = { name: 'Ines', footer: 'other pages use this' }
  for (const key of ['strip', 'name', 'nav']) store[key] = mergeSiteEdit(rule[key], store[key], data[key])
  const again = writeSite(load, edited, store)
  assert.equal(again.changed, false)
  assert.deepEqual(again.failed, [])
  const other = writeSite(load, editPage(), store)
  assert.deepEqual(readSite(load, other.html).data, readSite(load, edited).data)
  assert.equal(store.footer, 'other pages use this')
})

const logoPage = (logo) => `<!doctype html><html><head><script type="application/json" data-rules-name="api" data-rules-version="1">{"site":{"logo":".logo@src","brand":".brand","links":[".links > li",{"label":"a","href":"a@href"}]}}</script></head><body>${logo}<span class="brand">Ines</span><ul class="links"><li><a href="cv.html">CV</a></li><li><span>no link</span></li></ul></body></html>`

test('siteValueProblem refuses a null attribute whose element is missing, and accepts one whose element lacks it', () => {
  const missing = readSite(load, logoPage(''))
  assert.equal(missing.data.logo, null)
  assert.equal(siteValueProblem(missing.rule.logo, missing.data.logo, missing.present.logo), 'unreadable')
  const bare = readSite(load, logoPage('<img class="logo">'))
  assert.equal(bare.data.logo, null)
  assert.equal(siteValueProblem(bare.rule.logo, bare.data.logo, bare.present.logo), null)
  assert.equal(siteValueProblem(bare.rule.links, bare.data.links, bare.present.links), 'unreadable')
})

test('readSite reads every other key when one key has a broken selector', () => {
  const page = logoPage('<img class="logo" src="a.svg">').replace('"brand":".brand"', '"brand":"["')
  const read = readSite(load, page)
  assert.equal(read.declared, true)
  assert.deepEqual(read.broken, ['brand'])
  assert.equal(Object.hasOwn(read.data, 'brand'), false)
  assert.equal(read.data.logo, 'a.svg')
})

test('writeSite writes a site value into a version 2 page whose rules use the sheet codec', () => {
  const src = [
    '<!doctype html><html><head>',
    '<script data-rules-name="api" data-rules-version="2">{"title":"h1","site":{"name":"h1"},"sheets":"[items=sheets]@codec(sheet)"}</script>',
    '</head><body><h1>Book</h1><main items="sheets"></main></body></html>',
  ].join('')
  const result = writeSite(load, src, { name: 'Shared name' })
  assert.deepEqual(result.failed, [])
  assert.deepEqual(result.applied, ['name'])
  assert.equal(load(result.html)('h1').text(), 'Shared name')
})
