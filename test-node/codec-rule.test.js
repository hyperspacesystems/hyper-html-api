import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import * as cheerio from 'cheerio'
import { JSDOM } from 'jsdom'
import cheerioAdapter from '../src/adapters/cheerio.js'
import { extract, apply, planWrite, findRulesIn, registerCodec, getCodec } from '../src/engine/index.js'
import { writeDocument } from '../src/write.js'
import { RulesParseError, UnknownRulesVersion, UnknownCodec } from '../src/engine/errors.js'
import { upper } from './support/upper-codec.js'
import { engine, extractData, applyData } from '../src/dom-api.js'

const doc = (version, rules) => `<!doctype html><html><head><title>T</title></head><body><h1>hello</h1><p class="note">n</p><script data-rules-name="api" data-rules-version="${version}">${rules}</script></body></html>`
const SHOUT = '{"shout":"h1@codec(upper)","title":"title"}'

const casesDir = new URL('../conformance/cases/', import.meta.url)
const caseFile = (name, ext) => readFileSync(new URL(`${name}.${ext}`, casesDir), 'utf8')

function metaToken(meta) {
  const line = meta.split('\n').find(l => l.startsWith('token:'))
  return line ? line.slice('token:'.length).trim() : 'api'
}

test('a version 2 tag with only ordinary rules reads like version 1', () => {
  const names = [
    'tag-basic',
    'tag-relaxed-body',
    'tag-name-is-space-separated',
    'tag-duplicate-names-first-wins',
    'all-matches-read',
  ]
  let compared = 0
  for (const name of names) {
    const html = caseFile(name, 'html')
    const token = metaToken(caseFile(name, 'meta'))
    const v2 = html.replaceAll('data-rules-version="1"', 'data-rules-version="2"')
    assert.notEqual(v2, html, `${name} has no version 1 tag to swap`)

    const read = (source, version) => {
      const $ = cheerio.load(source)
      const found = findRulesIn(cheerioAdapter, $.root(), token)
      assert.equal(found.version, version)
      return extract(cheerioAdapter, $.root(), found.rules, { version: found.version })
    }
    const v1Data = read(html, '1')
    const v2Data = read(v2, '2')
    assert.deepEqual(v2Data, v1Data)
    compared += 1
  }
  assert.equal(compared, 5)
})

test('a codec rule reads its element through the codec', () => {
  const $ = cheerio.load(doc(2, SHOUT))
  const found = findRulesIn(cheerioAdapter, $.root(), 'api')
  const data = extract(cheerioAdapter, $.root(), found.rules, {
    version: found.version,
    codecs: { upper },
    query: 'q1',
  })
  assert.deepEqual(data, { shout: { text: 'HELLO', query: 'q1' }, title: 'T' })
})

test('a codec write changes only its element', () => {
  const { html, changed } = writeDocument(cheerio.load, doc(2, SHOUT), { shout: { text: 'NEW' } }, { codecs: { upper } })
  assert.equal(changed, true)
  assert.ok(html.includes('<h1>new</h1>'))
  assert.ok(html.includes('<title>T</title>'))
  assert.ok(html.includes('<p class="note">n</p>'))
})

test('a bad sibling key changes nothing', () => {
  assert.throws(
    () => writeDocument(cheerio.load, doc(2, SHOUT), { shout: { text: 'NEW' }, nope: 1 }, { codecs: { upper } }),
    { name: 'WriteRejected' },
  )

  const $ = cheerio.load(doc(2, SHOUT))
  const found = findRulesIn(cheerioAdapter, $.root(), 'api')
  assert.throws(
    () => apply(cheerioAdapter, $.root(), found.rules, { shout: { text: 'X' }, title: { bad: 1 } }, { version: '2', codecs: { upper } }),
    { name: 'ShapeMismatch' },
  )
  assert.equal($('h1').text(), 'hello')
})

test('a version 1 tag refuses the codec form', () => {
  assert.throws(
    () => writeDocument(cheerio.load, doc(1, SHOUT), { title: 'x' }, { codecs: { upper } }),
    (err) => {
      assert.ok(err instanceof RulesParseError)
      assert.equal(err.message, 'The @codec(name) rule form needs a rules tag with data-rules-version="2".')
      return true
    },
  )

  const $ = cheerio.load(doc(1, SHOUT))
  const found = findRulesIn(cheerioAdapter, $.root(), 'api')
  assert.throws(
    () => extract(cheerioAdapter, $.root(), found.rules, { version: '1', codecs: { upper } }),
    (err) => {
      assert.ok(err instanceof RulesParseError)
      assert.equal(err.message, 'The @codec(name) rule form needs a rules tag with data-rules-version="2".')
      return true
    },
  )
})

test('caller-supplied rules refuse the codec form', () => {
  assert.throws(
    () => writeDocument(cheerio.load, doc(2, SHOUT), { title: 'x' }, { rules: { shout: 'h1@codec(upper)' }, codecs: { upper } }),
    (err) => {
      assert.ok(err instanceof RulesParseError)
      assert.equal(err.message, 'The @codec(name) rule form needs a rules tag with data-rules-version="2".')
      return true
    },
  )

  const $ = cheerio.load(doc(2, SHOUT))
  assert.throws(
    () => extract(cheerioAdapter, $.root(), { shout: 'h1@codec(upper)' }, { codecs: { upper } }),
    (err) => {
      assert.ok(err instanceof RulesParseError)
      assert.equal(err.message, 'The @codec(name) rule form needs a rules tag with data-rules-version="2".')
      return true
    },
  )
})

test('a codec rule must be the value of a top level key', () => {
  const trees = [
    { post: { shout: 'h1@codec(upper)' } },
    { rows: ['p', { shout: 'h1@codec(upper)' }] },
    'h1@codec(upper)',
  ]
  const opts = { version: '2', codecs: { upper } }
  for (const rules of trees) {
    const check = (err) => {
      assert.ok(err instanceof RulesParseError)
      assert.equal(err.message, 'A @codec(name) rule must be the value of a top level key.')
      return true
    }
    const $ = cheerio.load(doc(2, SHOUT))
    assert.throws(() => extract(cheerioAdapter, $.root(), rules, opts), check)
    assert.throws(() => planWrite(cheerioAdapter, $.root(), rules, {}, opts), check)
  }
})

test('a codec rule cannot use [*]', () => {
  const $ = cheerio.load(doc(2, SHOUT))
  assert.throws(
    () => extract(cheerioAdapter, $.root(), { shout: 'h1[*]@codec(upper)' }, { version: '2', codecs: { upper } }),
    (err) => {
      assert.ok(err instanceof RulesParseError)
      assert.equal(err.message, 'A @codec(name) rule cannot use [*].')
      return true
    },
  )
})

test('an unknown codec name refuses loudly', () => {
  const $ = cheerio.load(doc(2, SHOUT))
  const found = findRulesIn(cheerioAdapter, $.root(), 'api')
  assert.throws(
    () => extract(cheerioAdapter, $.root(), found.rules, { version: '2', codecs: {} }),
    (err) => {
      assert.ok(err instanceof UnknownCodec)
      assert.equal(err.code, 'unknown-codec')
      return true
    },
  )
  assert.throws(
    () => writeDocument(cheerio.load, doc(2, SHOUT), { title: 'x' }),
    (err) => {
      assert.ok(err instanceof UnknownCodec)
      return true
    },
  )
})

test('a version 3 tag is unknown', () => {
  const $ = cheerio.load(doc(3, SHOUT))
  assert.throws(
    () => findRulesIn(cheerioAdapter, $.root(), 'api'),
    (err) => {
      assert.ok(err instanceof UnknownRulesVersion)
      assert.match(err.message, /"1" and "2"/)
      assert.equal(err.version, '3')
      return true
    },
  )
})

test('a codec rule with no matching element reads null and refuses the write', () => {
  const rules = '{"shout":"h9@codec(upper)","title":"title"}'
  const $ = cheerio.load(doc(2, rules))
  const found = findRulesIn(cheerioAdapter, $.root(), 'api')
  const data = extract(cheerioAdapter, $.root(), found.rules, { version: '2', codecs: { upper } })
  assert.equal(data.shout, null)

  assert.throws(
    () => writeDocument(cheerio.load, doc(2, rules), { shout: { text: 'X' } }, { codecs: { upper } }),
    (err) => {
      assert.ok(err instanceof Error)
      assert.equal(err.name, 'WriteRejected')
      assert.equal(err.unmatched.length, 1)
      assert.equal(err.unmatched[0].path, 'shout')
      return true
    },
  )
})

test('the browser registry serves codecs to extractData and applyData', () => {
  registerCodec('upper', upper)
  assert.equal(engine.codecs.get('upper'), upper)
  const document = new JSDOM(doc(2, SHOUT)).window.document
  const data = extractData(document)
  assert.equal(data.shout.text, 'HELLO')
  applyData(document, { shout: { text: 'NEW' } })
  assert.equal(document.querySelector('h1').textContent, 'new')
  assert.throws(() => engine.codecs.register('Bad Name', upper))
  assert.equal(getCodec('upper'), upper)
})

test('the published 0.13.0 engine refuses a version 2 sheet', async () => {
  const tarball = new URL('./support/hyper-html-api-0.13.0.tgz', import.meta.url).pathname
  const dir = mkdtempSync(join(tmpdir(), 'old-engine-'))
  try {
    execFileSync('tar', ['-xzf', tarball, '-C', dir])
    const { findRulesIn: oldFindRulesIn } = await import(pathToFileURL(join(dir, 'package/src/engine/rules-tag.js')).href)
    const { default: oldAdapter } = await import(pathToFileURL(join(dir, 'package/src/adapters/cheerio.js')).href)
    const { writeDocument: oldWriteDocument } = await import(pathToFileURL(join(dir, 'package/src/write.js')).href)

    const SHEET = '<!doctype html><html><body><table data-sheet="Budget"><tr><td>1</td></tr></table><script data-rules-name="api" data-rules-version="2">{"sheets": "[items=sheets]@codec(sheet)"}</script></body></html>'

    assert.throws(
      () => oldFindRulesIn(oldAdapter, cheerio.load(SHEET).root(), 'api'),
      (err) => {
        assert.equal(err.name, 'UnknownRulesVersion')
        return true
      },
    )
    assert.throws(
      () => oldWriteDocument(cheerio.load, SHEET, { sheets: [] }),
      (err) => {
        assert.equal(err.name, 'UnknownRulesVersion')
        return true
      },
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
