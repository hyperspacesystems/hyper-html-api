import { findRulesIn, resolveRules, bind } from '/src/engine/index.js'
import domAdapter from '/src/adapters/dom.js'

function parseDoc(html) {
  return new DOMParser().parseFromString(html, 'text/html')
}

function mount(html) {
  const host = document.createElement('div')
  host.innerHTML = html
  return host
}

const HEAD_TAG =
  '<script type="application/json" data-rules-name="collection" data-rules-version="1">{"title":".title"}</script>'

describe('findRulesIn (token forms, DOM adapter)', () => {
  it('matches a single-token tag by token', () => {
    const doc = parseDoc(
      '<script data-rules-name="api" data-rules-version="1">{"title":"h1"}</script>',
    )
    const found = findRulesIn(domAdapter, doc, 'api')
    found.rules.should.deep.equal({ title: 'h1' })
  })

  it('matches a multi-token tag on any of its tokens', () => {
    const doc = parseDoc(
      '<script data-rules-name="api cms collection" data-rules-version="1">{"title":"h1"}</script>',
    )
    findRulesIn(domAdapter, doc, 'api').rules.should.deep.equal({ title: 'h1' })
    findRulesIn(domAdapter, doc, 'collection').rules.should.deep.equal({ title: 'h1' })
  })

  it('returns null when no tag matches the token', () => {
    const doc = parseDoc(
      '<script data-rules-name="cms" data-rules-version="1">{"title":"h1"}</script>',
    )
    chai.expect(findRulesIn(domAdapter, doc, 'api')).to.equal(null)
  })

  it('rejects a non-string token', () => {
    const doc = parseDoc('<div></div>')
    chai.expect(() => findRulesIn(domAdapter, doc, 123)).to.throw(/invalid rules token/)
  })

  it('rejects a malformed string token instead of sanitizing', () => {
    const doc = parseDoc('<div></div>')
    chai.expect(() => findRulesIn(domAdapter, doc, 'a b')).to.throw(/invalid rules token/)
  })

  it('warns and uses the first when two tags share a token', () => {
    const doc = parseDoc(
      '<script data-rules-name="api" data-rules-version="1">{"which":"first"}</script>' +
        '<script data-rules-name="api" data-rules-version="1">{"which":"second"}</script>',
    )
    const spy = sinon.stub(console, 'warn')
    try {
      const found = findRulesIn(domAdapter, doc, 'api')
      found.rules.should.deep.equal({ which: 'first' })
      spy.calledOnce.should.equal(true)
    } finally {
      spy.restore()
    }
  })

  it('throws UnknownRulesVersion for a matching tag at the wrong version', () => {
    const doc = parseDoc(
      '<script data-rules-name="api" data-rules-version="3">{"title":"h1"}</script>',
    )
    chai.expect(() => findRulesIn(domAdapter, doc, 'api')).to.throw()
  })
})

describe('resolveRules (DOM adapter)', () => {
  it('returns an object source as-is with a null tagNode', () => {
    const rules = { title: '.title' }
    const found = resolveRules(domAdapter, document, rules)
    found.rules.should.equal(rules)
    chai.expect(found.tagNode).to.equal(null)
  })

  it('escalates an element root to its ownerDocument to find a head tag', () => {
    const doc = parseDoc(`<head>${HEAD_TAG}</head><body><form></form></body>`)
    const form = doc.querySelector('form')
    const found = resolveRules(domAdapter, form, 'collection')
    found.rules.should.deep.equal({ title: '.title' })
  })

  it('uses a Document root directly (no ownerDocument)', () => {
    const doc = parseDoc(`<head>${HEAD_TAG}</head><body></body>`)
    const found = resolveRules(domAdapter, doc, 'collection')
    found.rules.should.deep.equal({ title: '.title' })
  })

  it('returns null for a falsy source', () => {
    chai.expect(resolveRules(domAdapter, document, null)).to.equal(null)
  })

  it('returns null for an omitted source', () => {
    chai.expect(resolveRules(domAdapter, document, undefined)).to.equal(null)
  })
})

describe('bind (DOM adapter)', () => {
  it('round-trips get/set through a literal object source', () => {
    const root = mount('<h1 class="title">Old</h1>')
    const port = bind(domAdapter, root, { title: '.title' })
    chai.expect(port.tagNode).to.equal(null)
    port.get().should.deep.equal({ title: 'Old' })
    port.set({ title: 'New' })
    port.get().should.deep.equal({ title: 'New' })
  })

  it('resolves a head-mounted tag from an element root, get/set scoped to the element', () => {
    const doc = parseDoc(
      `<head>${HEAD_TAG}</head>` +
        '<body><h1 class="title">OUTSIDE</h1><form><h1 class="title">INSIDE</h1></form></body>',
    )
    const form = doc.querySelector('form')
    const port = bind(domAdapter, form, 'collection')
    port.tagNode.should.be.ok
    // get() only sees inside the form, not the sibling .title in <body>
    port.get().should.deep.equal({ title: 'INSIDE' })
    port.set({ title: 'CHANGED' })
    port.get().should.deep.equal({ title: 'CHANGED' })
    // the outside .title is untouched
    doc.querySelector('body > .title').textContent.should.equal('OUTSIDE')
  })

  it('forwards opts (skip) to BOTH get and set', () => {
    // Skipped subtree FIRST. Scalar find/apply act on the first match, so if
    // opts stopped being forwarded the shell's .title would be the first match
    // and both get() and set() would hit it — making this test fail, as it must.
    const root = mount(
      '<div data-shell><h1 class="title">Shell</h1></div><h1 class="title">Live</h1>',
    )
    const port = bind(domAdapter, root, { title: '.title' }, { skip: '[data-shell]' })
    // get() skips the shell → first non-skipped match is Live, not the earlier Shell
    port.get().should.deep.equal({ title: 'Live' })
    // set() must skip it too: it writes Live, leaving the earlier shell .title alone
    port.set({ title: 'NEW' })
    root.querySelector('[data-shell] .title').textContent.should.equal('Shell')
    root.children[1].textContent.should.equal('NEW')
    port.get().should.deep.equal({ title: 'NEW' })
  })

  it('throws clearly when a token source does not resolve', () => {
    const root = mount('<div></div>')
    chai.expect(() => bind(domAdapter, root, 'collection')).to.throw(/data-rules-name~="collection"/)
  })

  it('throws clearly when a non-string source does not resolve', () => {
    const root = mount('<div></div>')
    chai.expect(() => bind(domAdapter, root, undefined)).to.throw(/the provided rules object/)
  })
})

describe('dom-bound engine wrappers (HyperHtmlApi.engine)', () => {
  it('findRulesIn forwards the token', () => {
    const doc = parseDoc(
      '<script data-rules-name="api" data-rules-version="1">{"title":"h1"}</script>',
    )
    window.HyperHtmlApi.engine.findRulesIn(doc, 'api').rules.should.deep.equal({ title: 'h1' })
  })

  it('findRules resolves a token source', () => {
    const doc = parseDoc(`<head>${HEAD_TAG}</head><body></body>`)
    window.HyperHtmlApi.engine.findRules(doc, 'collection').rules.should.deep.equal({
      title: '.title',
    })
  })

  it('bind returns a working port', () => {
    const doc = parseDoc(
      `<head>${HEAD_TAG}</head><body><form><h1 class="title">Hi</h1></form></body>`,
    )
    const form = doc.querySelector('form')
    const port = window.HyperHtmlApi.engine.bind(form, 'collection')
    port.get().should.deep.equal({ title: 'Hi' })
    port.set({ title: 'Bye' })
    port.get().should.deep.equal({ title: 'Bye' })
  })
})
