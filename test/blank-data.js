import { applyData, extractData, blankData } from '/src/data.js'

describe('blankData', () => {
  it('fills every key, skips codecs, merges starting values into objects and list rows, and refuses non-objects', () => {
    blankData({ title: 'h1', tags: '.t[]', lines: ['li', '.'], rows: ['li', { n: '.n', b: '.b' }], grid: '#g@codec(sheet)', meta: { a: 'p', c: 'q' } })
      .should.deep.equal({ title: '', tags: [], lines: [], rows: [], meta: { a: '', c: '' } })

    blankData(
      { title: 'h1', lines: ['li', '.'], rows: ['li', { n: '.n', b: '.b' }], badRows: ['li', { n: '.n' }], meta: { a: 'p', c: 'q' }, rawMeta: { a: 'p' } },
      { lines: ['one'], rows: [{ n: 'x', extra: 1 }, null], badRows: 'bad', meta: { a: 'x' }, rawMeta: null, other: 1 },
    ).should.deep.equal({ title: '', lines: ['one'], rows: [{ n: 'x', b: '' }, null], badRows: 'bad', meta: { a: 'x', c: '' }, rawMeta: null })

    chai.expect(() => blankData(null)).to.throw(TypeError)
    chai.expect(() => blankData([])).to.throw(TypeError)
  })

  it('keeps nested list seeds and builds starting rows from cms-template seeds after blanking', () => {
    const root = document.createElement('div')
    root.innerHTML =
      '<h1>Old</h1><div class="lists"><section class="list"><h2>Old list</h2><ul><li><span class="n">old</span><i class="d">old note</i></li>' +
      '<li cms-template><span class="n">seed</span><i class="d">seed note</i></li></ul></section>' +
      '<section class="list" cms-template><h2>Seed list</h2><ul><li cms-template><span class="n">seed</span><i class="d">seed note</i></li></ul></section></div>'
    const rules = { title: 'h1', lists: ['div.lists > section.list', { title: 'h2', items: ['ul > li', { name: '.n' }] }] }
    applyData(root, blankData(rules), rules)
    applyData(root, blankData(rules, { lists: [{ title: 'Fresh', items: [{ name: 'first' }] }] }), rules)
    extractData(root, rules).should.deep.equal({ title: '', lists: [{ title: 'Fresh', items: [{ name: 'first' }] }] })
    root.querySelector('section.list:not([cms-template]) li:not([cms-template]) .d').textContent.should.equal('seed note')
    root.querySelectorAll('section.list:not([cms-template]) li[cms-template]').length.should.equal(1)
  })
})
