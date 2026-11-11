import test from 'node:test'
import assert from 'node:assert/strict'
import * as cheerio from 'cheerio'
import { writeDocument } from '../src/write.js'
import { assertRoundTrip, extract } from '../src/engine/index.js'
import cheerioAdapter from '../src/adapters/cheerio.js'
import { WriteNotRoundTripped, WriteRejected } from '../src/engine/errors.js'

const load = cheerio.load

const SRC = [
  '<!doctype html>',
  '<html>',
  '<head>',
  '<title>Old title</title>',
  '</head>',
  '<body>',
  '<header><span class="site-name">Old name</span></header>',
  '<main><p class="keep">keep &copy; 2026</p></main>',
  '<footer><span class="site-name">Old name</span></footer>',
  '<ul>',
  '  <li><span class="tag">a</span><span class="tag">b</span><b>no</b></li>',
  '  <li><span class="tag">c</span><span class="tag">d</span><b>no</b></li>',
  '</ul>',
  '<a class="home" href="/">Home</a>',
  '<a class="home" href="/about">About</a>',
  '</body>',
  '</html>',
].join('\n')

function write(rules, data, src = SRC) {
  return writeDocument(load, src, data, { rules })
}

test('a [*] rule writes every match and leaves the rest of the source alone', () => {
  const { html, changed } = write({ name: '.site-name[*]' }, { name: 'Hyper' })
  assert.equal(changed, true)
  assert.equal(html, SRC.replace(/Old name/g, 'Hyper'))
})

test('a [*] rule inside a selector group writes every kind of match', () => {
  const { html } = write({ title: 'title, .site-name[*]' }, { title: 'New title' })
  assert.equal(html, SRC.replace(/Old name/g, 'New title').replace('Old title', 'New title'))
})

test('a [*] rule on a prop writes every match', () => {
  const { html } = write({ home: 'a.home[*]@href' }, { home: '/start' })
  assert.equal(html, SRC.replace(/href="\/[a-z]*"/g, 'href="/start"'))
})

test('extract still reads the first match of a [*] rule', () => {
  const $ = cheerio.load(SRC)
  assert.deepEqual(extract(cheerioAdapter, $.root(), { name: '.site-name[*]' }), { name: 'Old name' })
  assert.deepEqual(
    extract(cheerioAdapter, $.root(), { home: 'a.home[*]@href' }),
    { home: '/' },
  )
})

test('a [*] rule that matches nothing is an unmatched target', () => {
  assert.throws(
    () => write({ name: '.missing[*]' }, { name: 'Hyper' }),
    (err) => {
      assert.ok(err instanceof WriteRejected)
      assert.deepEqual(err.unknownKeys, [])
      assert.deepEqual(err.unmatched, [{ path: 'name', selector: '.missing' }])
      return true
    },
  )
})

test('a second identical write of a [*] rule changes nothing', () => {
  const first = write({ name: '.site-name[*]' }, { name: 'Hyper' })
  const second = write({ name: '.site-name[*]' }, { name: 'Hyper' }, first.html)
  assert.equal(second.changed, false)
  assert.equal(second.html, first.html)
})

test('a [*] rule inside a list item writes every match in that row only', () => {
  const { html } = write(
    { items: ['li', { tag: '.tag[*]' }] },
    { items: [{ tag: 'x' }, { tag: 'y' }] },
  )
  assert.equal(
    html,
    SRC.replace(
      '<span class="tag">a</span><span class="tag">b</span><b>no</b>',
      '<span class="tag">x</span><span class="tag">x</span><b>no</b>',
    ).replace(
      '<span class="tag">c</span><span class="tag">d</span><b>no</b>',
      '<span class="tag">y</span><span class="tag">y</span><b>no</b>',
    ),
  )
})

test('the round-trip guard refuses a [*] rule whose second target kept its old value', () => {
  const rules = { name: '.site-name[*]' }
  const $ = cheerio.load('<span class="site-name">A</span><span class="site-name">B</span>')
  const got = extract(cheerioAdapter, $.root(), rules, { allMatches: true })
  assert.deepEqual(got, { name: ['A', 'B'] })
  assert.throws(() => assertRoundTrip(rules, { name: 'A' }, got), WriteNotRoundTripped)
})
