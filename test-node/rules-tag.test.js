import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as cheerio from 'cheerio'

import { findRulesIn, resolveRules, bind } from '../src/engine/index.js'
import { RulesParseError, UnknownRulesVersion } from '../src/engine/errors.js'
import cheerioAdapter from '../src/adapters/cheerio.js'

function load(html) {
  return cheerio.load(html)
}

function captureWarn(fn) {
  const original = console.warn
  const calls = []
  console.warn = (...args) => calls.push(args)
  try {
    return { result: fn(), calls }
  } finally {
    console.warn = original
  }
}

test('findRulesIn', async (t) => {
  await t.test('returns null when no rules tag is present', () => {
    const $ = load('<div>hello</div>')
    assert.equal(findRulesIn(cheerioAdapter, $.root()), null)
  })

  await t.test('no-token form returns the first data-rules-name tag', () => {
    const $ = load(
      '<script data-rules-name="cms" data-rules-version="1">{"title":"h1"}</script>',
    )
    const result = findRulesIn(cheerioAdapter, $.root())
    assert.ok(result)
    assert.deepEqual(result.rules, { title: 'h1' })
    assert.ok(result.tagNode)
  })

  await t.test('token match on a single-token tag', () => {
    const $ = load(
      '<script data-rules-name="api" data-rules-version="1">{"title":"h1"}</script>',
    )
    const result = findRulesIn(cheerioAdapter, $.root(), 'api')
    assert.ok(result)
    assert.deepEqual(result.rules, { title: 'h1' })
  })

  await t.test('token match on a multi-token tag', () => {
    const $ = load(
      '<script data-rules-name="api cms collection" data-rules-version="1">{"title":"h1"}</script>',
    )
    assert.deepEqual(findRulesIn(cheerioAdapter, $.root(), 'api').rules, { title: 'h1' })
    assert.deepEqual(findRulesIn(cheerioAdapter, $.root(), 'cms').rules, { title: 'h1' })
    assert.deepEqual(findRulesIn(cheerioAdapter, $.root(), 'collection').rules, { title: 'h1' })
  })

  await t.test('token with no matching tag returns null', () => {
    const $ = load(
      '<script data-rules-name="cms" data-rules-version="1">{"title":"h1"}</script>',
    )
    assert.equal(findRulesIn(cheerioAdapter, $.root(), 'api'), null)
  })

  await t.test('rejects a bad token instead of sanitizing', () => {
    const $ = load(
      '<script data-rules-name="api" data-rules-version="1">{"title":"h1"}</script>',
    )
    for (const bad of ['a b', '', 'a"b', 'a]b']) {
      assert.throws(() => findRulesIn(cheerioAdapter, $.root(), bad), /invalid rules token/)
    }
    assert.throws(() => findRulesIn(cheerioAdapter, $.root(), 123), /invalid rules token/)
  })

  await t.test('two tags matching the same token warn and use the first', () => {
    const $ = load(
      '<script data-rules-name="api" data-rules-version="1">{"which":"first"}</script>' +
        '<script data-rules-name="api" data-rules-version="1">{"which":"second"}</script>',
    )
    const { result, calls } = captureWarn(() => findRulesIn(cheerioAdapter, $.root(), 'api'))
    assert.deepEqual(result.rules, { which: 'first' })
    assert.equal(calls.length, 1)
    assert.match(calls[0][0], /2 rules tags match/)
  })

  await t.test('throws UnknownRulesVersion when data-rules-version is missing', () => {
    const $ = load('<script data-rules-name="api">{"title":"h1"}</script>')
    assert.throws(() => findRulesIn(cheerioAdapter, $.root(), 'api'), (err) => {
      assert.ok(err instanceof UnknownRulesVersion)
      return true
    })
  })

  await t.test('throws UnknownRulesVersion when data-rules-version is not "1" or "2"', () => {
    const $ = load('<script data-rules-name="api" data-rules-version="3">{"title":"h1"}</script>')
    assert.throws(() => findRulesIn(cheerioAdapter, $.root(), 'api'), (err) => {
      assert.ok(err instanceof UnknownRulesVersion)
      assert.equal(err.version, '3')
      return true
    })
  })

  await t.test('throws RulesParseError when body is malformed', () => {
    const $ = load('<script data-rules-name="api" data-rules-version="1">{a:}</script>')
    assert.throws(() => findRulesIn(cheerioAdapter, $.root(), 'api'), (err) => {
      assert.ok(err instanceof RulesParseError)
      return true
    })
  })

  await t.test('accepts relaxed JSON (unquoted keys, single quotes, trailing commas)', () => {
    const $ = load(
      '<script data-rules-name="api" data-rules-version="1">' +
        "{ title: 'h1', items: ['.item', { name: '.name', }], }" +
        '</script>',
    )
    const result = findRulesIn(cheerioAdapter, $.root(), 'api')
    assert.deepEqual(result.rules, {
      title: 'h1',
      items: ['.item', { name: '.name' }],
    })
  })
})

test('resolveRules', async (t) => {
  await t.test('object source is used as-is with a null tagNode', () => {
    const $ = load('<div></div>')
    const rules = { title: '.title' }
    const found = resolveRules(cheerioAdapter, $.root(), rules)
    assert.equal(found.rules, rules)
    assert.equal(found.tagNode, null)
  })

  await t.test('string source resolves a tag by token', () => {
    const $ = load(
      '<script data-rules-name="cms" data-rules-version="1">{"title":"h1"}</script>',
    )
    const found = resolveRules(cheerioAdapter, $.root(), 'cms')
    assert.deepEqual(found.rules, { title: 'h1' })
    assert.ok(found.tagNode)
  })

  await t.test('string source with no matching tag resolves to null', () => {
    const $ = load('<div></div>')
    assert.equal(resolveRules(cheerioAdapter, $.root(), 'cms'), null)
  })

  await t.test('an omitted/undefined source resolves to null', () => {
    const $ = load('<div></div>')
    assert.equal(resolveRules(cheerioAdapter, $.root(), undefined), null)
  })
})

test('bind', async (t) => {
  await t.test('round-trips get/set through a literal object source', () => {
    const $ = load('<div><h1 class="title">Old</h1></div>')
    const port = bind(cheerioAdapter, $.root(), { title: '.title' })
    assert.equal(port.tagNode, null)
    assert.deepEqual(port.get(), { title: 'Old' })
    port.set({ title: 'New' })
    assert.deepEqual(port.get(), { title: 'New' })
  })

  await t.test('round-trips get/set through a token source', () => {
    const $ = load(
      '<script data-rules-name="cms" data-rules-version="1">{"title":".title"}</script>' +
        '<div><h1 class="title">Old</h1></div>',
    )
    const port = bind(cheerioAdapter, $.root(), 'cms')
    assert.ok(port.tagNode)
    assert.deepEqual(port.get(), { title: 'Old' })
  })

  await t.test('forwards opts (skip) to get and set', () => {
    const $ = load(
      '<div>' +
        '<h1 class="title">Live</h1>' +
        '<div data-shell><h1 class="title">Shell</h1></div>' +
        '</div>',
    )
    const port = bind(cheerioAdapter, $.root(), { title: '.title[]' }, { skip: '[data-shell]' })
    assert.deepEqual(port.get(), { title: ['Live'] })
  })

  await t.test('throws clearly when a token source does not resolve', () => {
    const $ = load('<div></div>')
    assert.throws(() => bind(cheerioAdapter, $.root(), 'cms'), /data-rules-name~="cms"/)
  })

  await t.test('throws clearly when a non-string source does not resolve', () => {
    const $ = load('<div></div>')
    assert.throws(() => bind(cheerioAdapter, $.root(), undefined), /the provided rules object/)
  })
})
