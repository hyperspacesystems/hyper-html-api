import HyperHtmlApiUpgrade, { upgrade } from '/src/upgrade.js'
import { checkForUpdate } from '/src/upgrade/check.js'
import { run } from '/src/upgrade/run.js'
import { extractAll } from '/src/upgrade/extract-all.js'
import { findTransformTag, evaluateTransform } from '/src/upgrade/transform.js'
import {
  UpgradeSourceUnreachable,
  UpgradeSourceHasNoRules,
  UpgradeTransformInvalid,
  UpgradeMultipleTransforms,
} from '/src/upgrade/errors.js'

// Browser coverage for the upgrade flow: transform evaluation needs real Blob
// module imports, run() does a genuine fetch + DOMParser + apply round trip
// against wtr-served fixtures, and checkForUpdate exercises localStorage.

function parseDoc(html) {
  return new DOMParser().parseFromString(html, 'text/html')
}

async function fetchDoc(url) {
  const res = await fetch(url)
  return parseDoc(await res.text())
}

async function expectRejection(promise, ErrorClass) {
  try {
    await promise
  } catch (err) {
    err.should.be.instanceOf(ErrorClass)
    return err
  }
  throw new Error(`expected rejection with ${ErrorClass.name}`)
}

afterEach(() => {
  Object.keys(localStorage)
    .filter((k) => k.startsWith('hha:upgrade-'))
    .forEach((k) => localStorage.removeItem(k))
})

describe('lean entry (src/upgrade.js)', () => {
  it('exposes engine + the four upgrade methods', () => {
    HyperHtmlApiUpgrade.engine.should.be.an('object')
    upgrade.checkForUpdate.should.be.a('function')
    upgrade.run.should.be.a('function')
    upgrade.extractAll.should.be.a('function')
    upgrade.shapeMatch.should.be.a('function')
  })
})

describe('evaluateTransform', () => {
  it('evaluates a sync transform module', async () => {
    const fn = await evaluateTransform('export default (m) => ({ ...m, touched: { x: "1" } })')
    const out = await fn({ a: { y: '2' } }, {})
    out.touched.x.should.equal('1')
    out.a.y.should.equal('2')
  })

  it('supports async transforms', async () => {
    const fn = await evaluateTransform('export default async (m) => { await Promise.resolve(); return m }')
    const out = await fn({ k: { v: '1' } }, {})
    out.k.v.should.equal('1')
  })

  it('rejects a non-function default export', async () => {
    await expectRejection(evaluateTransform('export default 42'), UpgradeTransformInvalid)
  })

  it('rejects a module that fails to load (syntax error)', async () => {
    await expectRejection(evaluateTransform('export default ((('), UpgradeTransformInvalid)
  })
})

describe('findTransformTag', () => {
  it('returns null when absent and the code when present', () => {
    const none = parseDoc('<html><body><h1>x</h1></body></html>')
    should.equal(findTransformTag(window.domAdapter, none), null)

    const one = parseDoc('<script type="text/hyper-upgrade">export default (m) => m</script>')
    findTransformTag(window.domAdapter, one).should.contain('export default')
  })

  it('throws on multiple transform tags', () => {
    const two = parseDoc(
      '<script type="text/hyper-upgrade">export default (m) => m</script>' +
        '<script type="text/hyper-upgrade">export default (m) => m</script>',
    )
    ;(() => findTransformTag(window.domAdapter, two)).should.throw(UpgradeMultipleTransforms)
  })
})

describe('checkForUpdate', () => {
  const forkLoc = { href: 'https://fork.example/', origin: 'https://fork.example', pathname: '/' }

  function forkDoc(version, source = 'https://canonical.example/') {
    return parseDoc(
      `<html><head>` +
        (source ? `<meta name="hyper-source" content="${source}">` : '') +
        (version ? `<meta name="hyper-version" content="${version}">` : '') +
        `</head><body></body></html>`,
    )
  }

  function sourceResponder(version) {
    let calls = 0
    const fetchFn = () => {
      calls++
      return Promise.resolve(
        new Response(`<html><head><meta name="hyper-version" content="${version}"></head></html>`),
      )
    }
    return { fetchFn, count: () => calls }
  }

  it('returns null without a hyper-source meta tag', async () => {
    const result = await checkForUpdate({ doc: forkDoc('1.0.0', null), loc: forkLoc })
    should.equal(result, null)
  })

  it('returns null when the page is its own source (self-source guard)', async () => {
    const result = await checkForUpdate({
      doc: forkDoc('1.0.0', 'https://fork.example/'),
      loc: forkLoc,
    })
    should.equal(result, null)
  })

  it('reports available when the source is newer', async () => {
    const { fetchFn } = sourceResponder('1.2.0')
    const result = await checkForUpdate({ doc: forkDoc('1.0.0'), loc: forkLoc, fetchFn })
    result.available.should.equal(true)
    result.currentVersion.should.equal('1.0.0')
    result.sourceVersion.should.equal('1.2.0')
    result.sourceUrl.should.equal('https://canonical.example/')
  })

  it('reports not-available when versions match', async () => {
    const { fetchFn } = sourceResponder('1.0.0')
    const result = await checkForUpdate({ doc: forkDoc('1.0.0'), loc: forkLoc, fetchFn })
    result.available.should.equal(false)
  })

  it('a fork without a version treats any source version as newer', async () => {
    const { fetchFn } = sourceResponder('0.5.0')
    const result = await checkForUpdate({ doc: forkDoc(null), loc: forkLoc, fetchFn })
    result.available.should.equal(true)
  })

  it('caches the result for the TTL and refetches on force', async () => {
    const responder = sourceResponder('2.0.0')
    const doc = forkDoc('1.0.0', 'https://cached.example/')
    await checkForUpdate({ doc, loc: forkLoc, fetchFn: responder.fetchFn, now: 1000 })
    responder.count().should.equal(1)

    await checkForUpdate({ doc, loc: forkLoc, fetchFn: responder.fetchFn, now: 2000 })
    responder.count().should.equal(1)

    await checkForUpdate({ doc, loc: forkLoc, fetchFn: responder.fetchFn, now: 3000, force: true })
    responder.count().should.equal(2)

    const dayLater = 1000 + 25 * 60 * 60 * 1000
    await checkForUpdate({ doc, loc: forkLoc, fetchFn: responder.fetchFn, now: dayLater })
    responder.count().should.equal(3)
  })

  it('returns null when the source is unreachable', async () => {
    const result = await checkForUpdate({
      doc: forkDoc('1.0.0', 'https://gone.example/'),
      loc: forkLoc,
      fetchFn: () => Promise.reject(new Error('network down')),
    })
    should.equal(result, null)
  })
})

describe('extractAll', () => {
  it('packs every rules tag keyed by name, with the page version', async () => {
    const v1 = await fetchDoc('/test/fixtures/upgrade-v1.html')
    const { dataByName, version } = extractAll(v1)
    version.should.equal('1.0.0')
    dataByName.api.title.should.equal('My Store')
    dataByName.api.products.should.have.length(3)
    dataByName.api.products[0].should.deep.equal({ name: 'Apple', price: '$1', sku: 'A1' })
    dataByName.profile.owner.should.equal('David')
  })
})

describe('run (full fetch + migrate round trip)', () => {
  it('with a transform: re-keys, reshapes, and keeps v2 structure', async () => {
    const v1 = await fetchDoc('/test/fixtures/upgrade-v1.html')
    const result = await run({ doc: v1 })

    result.fromVersion.should.equal('1.0.0')
    result.toVersion.should.equal('2.0.0')
    result.summary.transformApplied.should.equal(true)
    result.html.should.match(/^<!DOCTYPE html>\n/)

    const out = parseDoc(result.html)
    out.querySelector('h1').textContent.should.equal('My Store')
    out.querySelectorAll('.product').length.should.equal(3)
    out.querySelectorAll('.product .name')[0].textContent.should.equal('Apple')
    out.querySelectorAll('.product .price')[2].textContent.should.equal('$3')
    out.querySelectorAll('.product .blurb')[1].textContent.should.equal('')
    out.querySelectorAll('.sku').length.should.equal(0)
    out.querySelector('.owner-name').textContent.should.equal('David')
    out.querySelector('meta[name="hyper-version"]').getAttribute('content').should.equal('2.0.0')
    should.equal(out.querySelector('script[type="text/hyper-upgrade"]') !== null, true)
  })

  it('without a transform: plain name-match join, drops counted', async () => {
    const v1 = await fetchDoc('/test/fixtures/upgrade-v1.html')
    const result = await run({ doc: v1, sourceUrl: '/test/fixtures/upgrade-v2-notransform.html' })

    result.summary.transformApplied.should.equal(false)
    result.summary.totals.discarded.should.equal(3)
    result.summary.totals.listItems.should.equal(3)

    const out = parseDoc(result.html)
    out.querySelector('h1').textContent.should.equal('My Store')
    out.querySelectorAll('.product').length.should.equal(3)
    out.querySelector('.owner').textContent.should.equal('David')
  })

  it('refuses a source with no rules tags when the fork has data', async () => {
    const v1 = await fetchDoc('/test/fixtures/upgrade-v1.html')
    await expectRejection(
      run({ doc: v1, sourceUrl: '/test/fixtures/upgrade-v2-norules.html' }),
      UpgradeSourceHasNoRules,
    )
  })

  it('throws UpgradeSourceUnreachable on a missing source', async () => {
    const v1 = await fetchDoc('/test/fixtures/upgrade-v1.html')
    await expectRejection(
      run({ doc: v1, sourceUrl: '/test/fixtures/does-not-exist.html' }),
      UpgradeSourceUnreachable,
    )
  })

  it('aborts when the transform throws', async () => {
    const v1 = await fetchDoc('/test/fixtures/upgrade-v1.html')
    const badSource = `<html><head>
      <meta name="hyper-version" content="9.0.0">
      <script type="application/json" data-rules-name="api" data-rules-version="1">{"title":"h1"}</script>
      <script type="text/hyper-upgrade">export default () => { throw new Error("boom") }</script>
      </head><body><h1>x</h1></body></html>`
    let threw = null
    try {
      await run({
        doc: v1,
        sourceUrl: 'https://anywhere.example/',
        fetchFn: () => Promise.resolve(new Response(badSource)),
      })
    } catch (err) {
      threw = err
    }
    should.exist(threw)
    threw.message.should.contain('boom')
  })
})

describe('upgrade.run: form values reach the upgraded markup', () => {
  const rules = '<script type="application/json" data-rules-name="api" data-rules-version="1">{"rent":"input[name=rent]@value","paid":"input[name=paid]@checked","note":"textarea@value","plan":"select@value"}</script>'
  const page = (version, body) => `<!DOCTYPE html><html><head><meta name="hyper-source" content="https://canonical.example/x.html"><meta name="hyper-version" content="${version}"></head><body>${rules}${body}</body></html>`
  const template = page('2.0.0', '<input name="rent" value="2400"><input name="paid" type="checkbox"><textarea>default</textarea><select><option value="a">A</option><option value="b">B</option></select><select name="untouched"><option>x</option><option>y</option></select>')

  it('writes an input value, a checkbox, a textarea and a select into the HTML the upgrade returns', async () => {
    const doc = parseDoc(page('1.0.0', '<input name="rent" value="3170"><input name="paid" type="checkbox" checked><textarea>mine</textarea><select><option value="a">A</option><option value="b" selected>B</option></select>'))
    const result = await run({ doc, loc: new URL('https://fork.example/x.html'), fetchFn: () => Promise.resolve(new Response(template)) })
    const out = parseDoc(result.html)
    out.querySelector('input[name=rent]').getAttribute('value').should.equal('3170')
    out.querySelector('input[name=paid]').hasAttribute('checked').should.equal(true)
    out.querySelector('textarea').textContent.should.equal('mine')
    out.querySelectorAll('select')[0].options[1].hasAttribute('selected').should.equal(true)
    should.equal(out.querySelectorAll('select')[1].querySelector('[selected]'), null)
  })
})
