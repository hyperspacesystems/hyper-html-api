import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as cheerio from 'cheerio'
import { JSDOM } from 'jsdom'

import { extract, apply } from '../src/engine/index.js'
import {
  ShapeMismatch,
  EmptyListInsert,
  MaxRuleDepthExceeded,
  RuleTargetReadOnly,
} from '../src/engine/errors.js'
import cheerioAdapter from '../src/adapters/cheerio.js'
import domAdapter from '../src/adapters/dom.js'

// Silence the ID-strip warning in test output; a dedicated test re-enables it.
const originalWarn = console.warn
function muteWarn() {
  console.warn = () => {}
}
function restoreWarn() {
  console.warn = originalWarn
}

function cheerioCtx(html) {
  const $ = cheerio.load(html)
  return { adapter: cheerioAdapter, root: $.root(), $, serialize: () => $.html() }
}

function jsdomCtx(html) {
  const dom = new JSDOM(html)
  return {
    adapter: domAdapter,
    root: dom.window.document,
    serialize: () => dom.window.document.documentElement.outerHTML,
  }
}

const envs = [
  { label: 'cheerio', make: cheerioCtx },
  { label: 'jsdom', make: jsdomCtx },
]

for (const env of envs) {
  test(`apply [${env.label}] — scalar set / null / omit, partial update`, () => {
    const { adapter, root } = env.make(
      '<div class="dashboard"><h1 class="title">Old</h1><p class="sub">Keep</p><span class="name">NA</span></div>',
    )
    const rules = { title: '.title', sub: '.sub', name: '.name' }

    muteWarn()
    apply(adapter, root, rules, { title: 'New', name: null })
    restoreWarn()

    const result = extract(adapter, root, rules)
    assert.equal(result.title, 'New')
    assert.equal(result.sub, 'Keep') // untouched (key omitted from input)
    // Plain text selector: blanked text reads back as "" (not null — that's
    // the attr/prop path). Legacy extractElementText returns element.text()
    // without || null coercion.
    assert.equal(result.name, '')
  })

  test(`apply [${env.label}] — object array: update + insert + remove + reorder round-trips`, () => {
    const { adapter, root } = env.make(
      '<ul class="list">' +
        '<li class="item"><span class="name">A</span><span class="price">1</span></li>' +
        '<li class="item"><span class="name">B</span><span class="price">2</span></li>' +
        '<li class="item"><span class="name">C</span><span class="price">3</span></li>' +
        '</ul>',
    )
    const rules = {
      items: ['.item', { name: '.name', price: '.price' }],
    }

    const newItems = [
      { name: 'B', price: '2' }, // reorder: was at index 1
      { name: 'D', price: '4' }, // insert
      { name: 'A', price: '1' }, // reorder: was at index 0
    ]

    muteWarn()
    apply(adapter, root, rules, { items: newItems })
    restoreWarn()

    const result = extract(adapter, root, rules)
    assert.deepEqual(result.items, newItems)
  })

  test(`apply [${env.label}] — scalar array: insert + remove + reorder`, () => {
    const { adapter, root } = env.make(
      '<div><span class="tag">red</span><span class="tag">green</span><span class="tag">blue</span></div>',
    )
    const rules = { tags: '.tag[]' }

    muteWarn()
    apply(adapter, root, rules, { tags: ['blue', 'yellow', 'red'] })
    restoreWarn()

    assert.deepEqual(extract(adapter, root, rules).tags, ['blue', 'yellow', 'red'])
  })

  test(`apply [${env.label}] — empty list + non-empty new throws EmptyListInsert`, () => {
    const { adapter, root } = env.make('<ul class="list"></ul>')
    const rules = { items: ['.item', { name: '.name' }] }
    assert.throws(
      () => apply(adapter, root, rules, { items: [{ name: 'X' }] }),
      (err) => {
        assert.ok(err instanceof EmptyListInsert)
        assert.match(err.message, /Seed/)
        return true
      },
    )
  })

  test(`apply [${env.label}] — non-empty list + empty new removes all`, () => {
    const { adapter, root } = env.make(
      '<ul><li class="item">x</li><li class="item">y</li></ul>',
    )
    const rules = { items: '.item[]' }
    apply(adapter, root, rules, { items: [] })
    assert.deepEqual(extract(adapter, root, rules).items, [])
  })

  test(`apply [${env.label}] — ShapeMismatch is thrown before any mutation`, () => {
    const { adapter, root, serialize } = env.make(
      '<div><h1 class="title">T</h1><p class="sub">S</p></div>',
    )
    const before = serialize()
    const rules = { title: '.title', sub: '.sub', items: ['.item', { x: '.x' }] }
    const bad = { title: { unexpected: 'obj' }, sub: ['array'], items: 'not array' }

    assert.throws(
      () => apply(adapter, root, rules, bad),
      (err) => {
        assert.ok(err instanceof ShapeMismatch)
        assert.equal(err.mismatches.length, 3)
        return true
      },
    )
    assert.equal(serialize(), before)
  })

  test(`apply [${env.label}] — @attr write: sets, removes on null, keeps "" as present`, () => {
    // data-link instead of href so DOM doesn't normalize (a.href → absolute
    // URL with trailing slash) — this tests the attr path, not the prop path.
    const { adapter, root } = env.make(
      '<div><a class="lnk" data-link="one">one</a></div>',
    )
    const rules = { link: '.lnk@data-link' }

    apply(adapter, root, rules, { link: 'two' })
    assert.equal(extract(adapter, root, rules).link, 'two')

    apply(adapter, root, rules, { link: null })
    assert.equal(extract(adapter, root, rules).link, null)

    apply(adapter, root, rules, { link: '' })
    assert.equal(extract(adapter, root, rules).link, '')
  })

  test(`apply [${env.label}] — deep apply (21 levels) throws MaxRuleDepthExceeded`, () => {
    const { adapter, root } = env.make('<div><h1>ok</h1></div>')
    // build a 21-level rule path to trip the depth guard
    let rule = 'h1'
    const keys = 'abcdefghijklmnopqrstu'.split('')
    let data = 'x'
    for (const k of keys) {
      rule = { [k]: rule }
      data = { [k]: data }
    }
    assert.throws(
      () => apply(adapter, root, rule, data),
      (err) => err instanceof MaxRuleDepthExceeded,
    )
  })
}

test('apply (jsdom) — boolean prop coercion: true/false/null', () => {
  const { adapter, root } = jsdomCtx(
    '<form><input id="agree" type="checkbox"><input id="other" type="checkbox" checked></form>',
  )
  const rules = { agree: '#agree@checked', other: '#other@checked' }

  apply(adapter, root, rules, { agree: true, other: false })
  // prop-level read (not through legacy String() coercion)
  const agreeEl = root.getElementById('agree')
  const otherEl = root.getElementById('other')
  assert.equal(agreeEl.checked, true)
  assert.equal(otherEl.checked, false)

  apply(adapter, root, rules, { agree: null })
  assert.equal(agreeEl.checked, false)
})

test('apply (jsdom) — boolean prop coercion: the strings "true" and "false"', () => {
  // Form state and attribute round-trips deliver these as strings, and
  // Boolean('false') is true: writing 'false' used to CHECK an unchecked box.
  const { adapter, root } = jsdomCtx('<form><input id="agree" type="checkbox"></form>')
  const rules = { agree: '#agree@checked' }
  const agreeEl = root.getElementById('agree')

  apply(adapter, root, rules, { agree: 'true' })
  assert.equal(agreeEl.checked, true)

  apply(adapter, root, rules, { agree: 'false' })
  assert.equal(agreeEl.checked, false)
})

test('apply (jsdom) — template captured before old[0] is detached', () => {
  // The first old item has a unique marker. We update a later item so oldNodes[0]
  // stays in place, AND we insert one new item. The inserted clone should carry
  // the marker because the template was cloned from the first item up-front.
  const { adapter, root } = jsdomCtx(
    '<ul>' +
      '<li class="item first-item" data-marker="yes"><span class="name">A</span></li>' +
      '<li class="item"><span class="name">B</span></li>' +
      '<li class="item"><span class="name">C</span></li>' +
      '</ul>',
  )
  const rules = { items: ['.item', { name: '.name' }] }
  muteWarn()
  apply(adapter, root, rules, {
    items: [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }],
  })
  restoreWarn()

  const items = root.querySelectorAll('.item')
  assert.equal(items.length, 4)
  // All inserts should have been stamped from the first-item template.
  assert.equal(items[3].classList.contains('first-item'), true)
  assert.equal(items[3].getAttribute('data-marker'), 'yes')
})

test('apply (jsdom) — inserted clones have IDs stripped; originals keep theirs', () => {
  const { adapter, root } = jsdomCtx(
    '<ul>' +
      '<li class="item" id="keep"><span id="inner" class="name">A</span></li>' +
      '</ul>',
  )
  const rules = { items: ['.item', { name: '.name' }] }
  let warned = null
  console.warn = (msg) => {
    warned = msg
  }
  apply(adapter, root, rules, { items: [{ name: 'A' }, { name: 'B' }] })
  restoreWarn()

  const items = root.querySelectorAll('.item')
  assert.equal(items.length, 2)
  assert.equal(items[0].id, 'keep') // original preserved
  assert.equal(items[0].querySelector('.name').id, 'inner')
  assert.equal(items[1].id, '') // stripped on the clone
  assert.equal(items[1].querySelector('.name').id, '')
  assert.ok(warned && /stripped/.test(warned))
})

test('apply (jsdom) — no-op apply preserves focus on input inside list item', () => {
  // Re-applying the same data must NOT detach/reattach matched nodes.
  // Focus on a nested input would otherwise drop to <body>.
  const { adapter, root } = jsdomCtx(
    '<ul>' +
      '<li class="item"><input class="v" id="i0" value="A"></li>' +
      '<li class="item"><input class="v" id="i1" value="B"></li>' +
      '</ul>',
  )
  const rules = { items: ['.item', { v: '.v@value' }] }
  const i0 = root.getElementById('i0')
  i0.focus()
  assert.equal(root.activeElement.id, 'i0')

  muteWarn()
  apply(adapter, root, rules, { items: [{ v: 'A' }, { v: 'B' }] })
  restoreWarn()

  assert.equal(root.activeElement.id, 'i0', 'focus should be preserved')
})

test('apply (jsdom) — no-op apply does not fire MutationObserver on list parent', async () => {
  const { adapter, root } = jsdomCtx(
    '<ul id="lst">' +
      '<li class="item"><span class="name">A</span></li>' +
      '<li class="item"><span class="name">B</span></li>' +
      '</ul>',
  )
  const rules = { items: ['.item', { name: '.name' }] }
  const parent = root.getElementById('lst')

  const records = []
  const win = parent.ownerDocument.defaultView
  const mo = new win.MutationObserver((rs) => records.push(...rs))
  mo.observe(parent, { childList: true })

  muteWarn()
  apply(adapter, root, rules, { items: [{ name: 'A' }, { name: 'B' }] })
  restoreWarn()

  // Microtask flush
  await new Promise((resolve) => setTimeout(resolve, 0))
  mo.disconnect()

  assert.equal(
    records.length,
    0,
    `expected zero childList mutations on no-op apply, got ${records.length}`,
  )
})

test('apply (jsdom) — @outerHTML inside list item: listDiff updates its pointer to the new node', () => {
  // Two-key item shape: first writes outerHTML on the item itself (replacing
  // it with a new section), second writes a child class. The second sub-rule
  // must operate on the REPLACED node so the class lands on the right
  // element. If applyAt's ctx threading is broken, the second rule no-ops.
  const { adapter, root } = jsdomCtx(
    '<ul>' +
      '<li class="item"><span class="lbl">old-a</span></li>' +
      '<li class="item"><span class="lbl">old-b</span></li>' +
      '</ul>',
  )
  const rules = {
    items: [
      '.item',
      { html: '@outerHTML', lbl: '.lbl' },
    ],
  }
  const data = {
    items: [
      {
        html: '<li class="item replaced-a"><span class="lbl">stub</span></li>',
        lbl: 'after-a',
      },
      {
        html: '<li class="item replaced-b"><span class="lbl">stub</span></li>',
        lbl: 'after-b',
      },
    ],
  }
  muteWarn()
  apply(adapter, root, rules, data)
  restoreWarn()

  const items = Array.from(root.querySelectorAll('.item'))
  assert.equal(items.length, 2)
  assert.ok(items[0].classList.contains('replaced-a'))
  assert.ok(items[1].classList.contains('replaced-b'))
  // The .lbl sub-rule ran AFTER the outerHTML, so it should have set the
  // new label on the replaced element.
  assert.equal(items[0].querySelector('.lbl').textContent.trim(), 'after-a')
  assert.equal(items[1].querySelector('.lbl').textContent.trim(), 'after-b')
})

test('apply (jsdom) — identical-item reorder preserves positions via tiebreak', () => {
  // Four identical items: similarity is 1.0 for every pair. Closest-index
  // tiebreak should keep each old node at its original position when the new
  // list has the same shape.
  const { adapter, root } = jsdomCtx(
    '<ul>' +
      '<li class="item"><span class="a">1</span><span class="b">2</span></li>' +
      '<li class="item"><span class="a">1</span><span class="b">2</span></li>' +
      '<li class="item"><span class="a">1</span><span class="b">2</span></li>' +
      '<li class="item"><span class="a">1</span><span class="b">2</span></li>' +
      '</ul>',
  )
  const rules = { items: ['.item', { a: '.a', b: '.b' }] }

  const identical = [
    { a: '1', b: '2' },
    { a: '1', b: '2' },
    { a: '1', b: '2' },
    { a: '1', b: '2' },
  ]

  // Tag each original node so we can verify identity preservation.
  const originals = Array.from(root.querySelectorAll('.item'))
  originals.forEach((el, i) => (el.dataset.origIdx = String(i)))

  muteWarn()
  apply(adapter, root, rules, { items: identical })
  restoreWarn()

  const after = Array.from(root.querySelectorAll('.item'))
  for (let i = 0; i < after.length; i++) {
    assert.equal(after[i].dataset.origIdx, String(i))
  }
})

for (const env of envs) {
  test(`apply [${env.label}] — @-split: selector containing @ writes to the right attribute`, () => {
    const { adapter, root } = env.make(
      '<a class="mail" href="mailto:a@b.com" title="old">click</a>',
    )
    const rules = { tag: '[href*="@"]@title' }
    apply(adapter, root, rules, { tag: 'new' })
    assert.equal(extract(adapter, root, rules).tag, 'new')
  })

  test(`apply [${env.label}] — @href/@src write via attr; round-trip stays literal`, () => {
    const { adapter, root } = env.make(
      '<div><a class="lnk" href="/old">x</a><img class="pic" src="/old.png"></div>',
    )
    const rules = { href: '.lnk@href', src: '.pic@src' }
    apply(adapter, root, rules, { href: '/docs', src: '/avatar.png' })
    const result = extract(adapter, root, rules)
    assert.equal(result.href, '/docs')
    assert.equal(result.src, '/avatar.png')
  })

  test(`apply [${env.label}] — @tagName (read-only) throws RuleTargetReadOnly`, () => {
    const { adapter, root } = env.make('<div><h1 id="x">A</h1></div>')
    const rules = { t: '#x@tagName' }
    assert.throws(
      () => apply(adapter, root, rules, { t: 'H2' }),
      (err) => err instanceof RuleTargetReadOnly && err.target === 'tagName',
    )
  })

  test(`apply [${env.label}] — @offsetWidth (read-only) throws RuleTargetReadOnly`, () => {
    const { adapter, root } = env.make('<div><span id="x">A</span></div>')
    const rules = { w: '#x@offsetWidth' }
    assert.throws(
      () => apply(adapter, root, rules, { w: 100 }),
      (err) => err instanceof RuleTargetReadOnly && err.target === 'offsetWidth',
    )
  })

  test(`apply [${env.label}] — list rule rejects null with ShapeMismatch`, () => {
    const { adapter, root } = env.make('<ul><li class="t">a</li></ul>')
    assert.throws(
      () => apply(adapter, root, { tags: '.t[]' }, { tags: null }),
      (err) => {
        assert.ok(err instanceof ShapeMismatch)
        assert.equal(err.mismatches[0].path, 'tags')
        assert.equal(err.mismatches[0].expected, 'array')
        assert.equal(err.mismatches[0].got, 'null')
        return true
      },
    )
  })

  test(`apply [${env.label}] — list rule rejects empty-string with ShapeMismatch (no silent delete)`, () => {
    const { adapter, root, serialize } = env.make(
      '<ul><li class="t">a</li><li class="t">b</li></ul>',
    )
    const before = serialize()
    assert.throws(
      () => apply(adapter, root, { tags: '.t[]' }, { tags: '' }),
      (err) => err instanceof ShapeMismatch,
    )
    // Confirm no items were silently removed.
    assert.equal(serialize(), before)
  })

  test(`apply [${env.label}] — tuple list rule rejects null`, () => {
    const { adapter, root } = env.make(
      '<ul><li class="i"><span class="x">a</span></li></ul>',
    )
    assert.throws(
      () =>
        apply(adapter, root, { items: ['.i', { x: '.x' }] }, { items: null }),
      (err) => err instanceof ShapeMismatch,
    )
  })

  test(`apply [${env.label}] — object rule rejects null with ShapeMismatch`, () => {
    const { adapter, root } = env.make(
      '<div><span class="n">N</span><span class="e">E</span></div>',
    )
    assert.throws(
      () =>
        apply(
          adapter,
          root,
          { user: { name: '.n', email: '.e' } },
          { user: null },
        ),
      (err) => {
        assert.ok(err instanceof ShapeMismatch)
        assert.equal(err.mismatches[0].path, 'user')
        assert.equal(err.mismatches[0].expected, 'object')
        return true
      },
    )
  })

  test(`apply [${env.label}] — omitted key (undefined) still skips silently`, () => {
    const { adapter, root } = env.make(
      '<ul><li class="t">a</li><li class="t">b</li></ul>',
    )
    // No throw, no change.
    apply(adapter, root, { tags: '.t[]' }, {})
    assert.deepEqual(extract(adapter, root, { tags: '.t[]' }).tags, ['a', 'b'])
  })

  test(`apply [${env.label}] — @innerHTML, @textContent, @className all write via prop semantics`, () => {
    const { adapter, root } = env.make(
      '<div>' +
        '<div id="html" class="old-html"><strong>old</strong></div>' +
        '<div id="text" class="old-text"><strong>nested</strong></div>' +
        '<div id="cls" class="x y z">old</div>' +
        '</div>',
    )
    apply(adapter, root, { h: '#html@innerHTML' }, { h: '<em>new</em>' })
    apply(adapter, root, { t: '#text@textContent' }, { t: 'flat' })
    apply(adapter, root, { c: '#cls@className' }, { c: 'a b' })

    assert.equal(extract(adapter, root, { h: '#html@innerHTML' }).h, '<em>new</em>')
    assert.equal(extract(adapter, root, { t: '#text@textContent' }).t, 'flat')
    assert.equal(extract(adapter, root, { c: '#cls@className' }).c, 'a b')
  })

  test(`apply [${env.label}] — @outerHTML replaces node; ctx threading lets subsequent rules see the replacement`, () => {
    // Rule applies @outerHTML to ctx, then writes a sibling field. The
    // second rule looks up via the new ctx (returned by applyAt threading)
    // so it must find the replacement's children.
    const { adapter, root } = env.make(
      '<section id="box"><span class="lbl">old-label</span></section>',
    )
    const rules = {
      box: '#box@outerHTML',
    }
    apply(adapter, root, rules, {
      box: '<section id="box"><span class="lbl">new-label</span></section>',
    })
    // Confirm the new element is in place and re-readable.
    assert.equal(
      extract(adapter, root, { lbl: '.lbl' }).lbl,
      'new-label',
    )
  })
}
