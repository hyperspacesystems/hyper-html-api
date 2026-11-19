import { extractData, applyData, engine } from '/src/data.js'
import domAdapter, { createDomAdapter } from '/src/adapters/dom.js'

// Browser coverage for the data sugar (extractData / applyData). Mirrors the
// bind.js style: build DOM with mount() and assert with chai. Omitted rules use
// the api tag across the whole document, exactly like the server writer.

const mounted = []
function mount(html) {
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.appendChild(host)
  mounted.push(host)
  return host
}
afterEach(() => {
  while (mounted.length) mounted.pop().remove()
})

const API_TAG =
  '<script type="application/json" data-rules-name="api" data-rules-version="1">{"title":"h1","items":".item[]"}</script>'

const COLLECTION_TAG =
  '<script type="application/json" data-rules-name="collection" data-rules-version="1">{"name":".cname"}</script>'

describe('extractData (read)', () => {
  it('extractData(root, "name") reads via a named rule scoped to the root', () => {
    const host = mount(`${API_TAG}<h1>Hello</h1><span class="item">a</span><span class="item">b</span>`)
    const data = extractData(host, 'api')
    data.should.deep.equal({ title: 'Hello', items: ['a', 'b'] })
  })

  it('extractData("name") defaults the root to document', () => {
    mount(`${API_TAG}<h1>Doc</h1>`)
    const data = extractData('api')
    data.title.should.equal('Doc')
  })

  it('extractData(root, {inline}) accepts an inline rules object', () => {
    const host = mount('<h1>Inline</h1>')
    const data = extractData(host, { heading: 'h1' })
    data.should.deep.equal({ heading: 'Inline' })
  })

  it('extractData(root) uses the api rules tag', () => {
    const host = mount(`${API_TAG}<h1>Auto</h1>`)
    const data = extractData(host)
    data.title.should.equal('Auto')
  })

  it('extractData() with no args uses document + the api rules tag', () => {
    mount(`${API_TAG}<h1>NoArgs</h1>`)
    const data = extractData()
    data.title.should.equal('NoArgs')
  })
})

describe('applyData (write-into-DOM)', () => {
  it('applyData(root, data, "name") writes into the DOM and returns root', () => {
    const host = mount(`${API_TAG}<h1></h1>`)
    const returned = applyData(host, { title: 'Written' }, 'api')
    returned.should.equal(host)
    host.querySelector('h1').textContent.should.equal('Written')
  })

  it('applyData(root, data) uses the api rules tag', () => {
    const host = mount(`${API_TAG}<h1></h1>`)
    applyData(host, { title: 'AutoWrite' })
    host.querySelector('h1').textContent.should.equal('AutoWrite')
  })

  it('applyData(root, data, {inline}) accepts an inline rules object', () => {
    const host = mount('<h1></h1>')
    applyData(host, { heading: 'InlineWrite' }, { heading: 'h1' })
    host.querySelector('h1').textContent.should.equal('InlineWrite')
  })

  it('round-trips: applyData then extractData yields the same data', () => {
    const host = mount(`${API_TAG}<h1></h1>`)
    applyData(host, { title: 'RoundTrip', items: [] }, 'api')
    extractData(host, 'api').title.should.equal('RoundTrip')
  })

  it('throws when the first argument is not a DOM root', () => {
    chai.expect(() => applyData('api', { title: 'x' })).to.throw(/needs a DOM root/)
  })
})

describe('api default (source omitted)', () => {
  it('throws NoRulesTag when no api tag is in scope', () => {
    const host = mount('<h1>none</h1>')
    chai.expect(() => extractData(host)).to.throw(/no <script data-rules-name~="api">/)
  })

  it('uses api when another rules tag is also present', () => {
    const host = mount(`${API_TAG}${COLLECTION_TAG}<h1>two</h1>`)
    extractData(host).should.deep.equal({ title: 'two', items: [] })
  })

  it('a named source still works when multiple tags are present', () => {
    const host = mount(`${API_TAG}${COLLECTION_TAG}<h1>Named</h1><span class="cname">Bob</span>`)
    extractData(host, 'api').title.should.equal('Named')
    extractData(host, 'collection').should.deep.equal({ name: 'Bob' })
  })
})

describe('engine is still exposed from the lean entry', () => {
  it('engine.bind(...).get() matches extractData', () => {
    const host = mount(`${API_TAG}<h1>EngineParity</h1>`)
    const viaEngine = engine.bind(host, 'api').get()
    const viaSugar = extractData(host, 'api')
    viaEngine.should.deep.equal(viaSugar)
  })
})

describe('a host answer posted back', () => {
  it('applyData drops a top level __meta__ unless the rules define it', () => {
    const host = mount('<h1></h1><p id="m">old</p>')
    applyData(host, { heading: 'B', __meta__: { stale: true } }, { heading: 'h1' })
    host.querySelector('h1').textContent.should.equal('B')
    applyData(host, { __meta__: 'new' }, { heading: 'h1', __meta__: '#m' })
    host.querySelector('#m').textContent.should.equal('new')
  })

  it('attrNames lists an element\'s attributes through both DOM adapters', () => {
    const host = mount('<b id="t" text="q*2" class:on="x">2</b>')
    const el = host.querySelector('#t')
    domAdapter.attrNames(el).should.deep.equal(['id', 'text', 'class:on'])
    createDomAdapter(host).attrNames(el).should.deep.equal(['id', 'text', 'class:on'])
    domAdapter.attrNames(document).should.deep.equal([])
  })
})
