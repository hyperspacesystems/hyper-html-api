import cheerioAdapter from './adapters/cheerio.js'
import { extract } from './engine/extract.js'
import { findRulesIn } from './engine/rules-tag.js'
import { NoRulesTag, RulesParseError } from './engine/errors.js'
import { parseRelaxed } from './engine/rules.js'
import { writeDocument } from './write.js'

const PAGE = /^blockeditor(?:\.[0-9]+)?$/
const TEXT = new Set(['paragraph', 'heading', 'list_item', 'callout', 'code_block', 'toggle'])
const MARKS = ['b', 'i', 's', 'c', 'a']

export class PageWriteRefused extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'PageWriteRefused'
    this.code = code
  }
}

function refuse(message) {
  throw new PageWriteRefused('invalid-content', message)
}

// Inert content (a starter article kept in a <template>) is not part of the page, as in a browser.
// Cheerio parents a template's content under a root node, which closest() does not climb past.
function live(_, node) {
  for (let up = node.parent; up; up = up.parent) {
    if (up.type === 'tag' && (up.name === 'template' || up.name === 'noscript')) return false
  }
  return true
}

function pageNodes($) {
  const tags = $('script[merge][clay~="live"]').filter((_, node) => PAGE.test($(node).attr('merge'))).filter(live)
  if (!tags.length) return null
  const articles = $('article[data-blockeditor]').filter(live)
  if (tags.length !== 1 || articles.length !== 1) refuse('Expected one page store and one page article')
  return { tag: tags[0], article: articles[0] }
}

function valueOf($, tag) {
  let value
  try {
    value = parseRelaxed($(tag).text())
  } catch {
    refuse('Cannot parse the page store')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) || !value.y) {
    refuse('Expected a Yjs page store')
  }
  return value
}

function projectionOf(load, blocks, projection) {
  const clean = (html, strip) => {
    const $ = load(`<template>${html}</template>`)
    const body = $('template')
    const content = body.contents()
    if (strip) {
      content.find('script').remove()
      content.find('*').each((_, node) => {
        for (const [name, value] of Object.entries(node.attribs || {})) {
          if (/^on/i.test(name) || (/^(href|src|action|formaction|xlink:href)$/i.test(name) && /^(javascript|vbscript|data):/i.test(value.replace(/[\u0000-\u0020]/g, '')))) {
            $(node).removeAttr(name)
          }
        }
      })
    }
    return body.html()
  }
  return projection.renderBlocks(blocks, {
    fallbackOf: id => typeof blocks[id]?.artifact?.fallbackHtml === 'string' ? blocks[id].artifact.fallbackHtml : '',
    clean: { preserved: html => clean(html, false), fallback: html => clean(html, true) },
  })
}

function splice(src, replacements) {
  let html = src
  for (const { node, text } of replacements.sort((a, b) => (b.node.sourceCodeLocation?.startOffset ?? -1) - (a.node.sourceCodeLocation?.startOffset ?? -1))) {
    const location = node.sourceCodeLocation
    if (location?.startOffset == null || location.endOffset == null) refuse('Page source has no stable location')
    html = html.slice(0, location.startOffset) + text + html.slice(location.endOffset)
  }
  return html
}

function withArticle(load, src, projection) {
  const $ = load(src, { sourceCodeLocationInfo: true })
  const nodes = pageNodes($)
  const article = $(nodes.article)
  article.html(projection.html)
  article.attr('data-rev', projection.rev)
  return splice(src, [{ node: nodes.article, text: $.html(nodes.article) }])
}

function rulesOf($, options) {
  if (Object.prototype.hasOwnProperty.call(options, 'rules')) {
    const rules = options.rules
    if (rules === null || !['string', 'object'].includes(typeof rules)) {
      throw new RulesParseError('Invalid extraction rules: expected a selector, array, or object.')
    }
    return rules
  }
  const token = options.token ?? 'api'
  const found = findRulesIn(cheerioAdapter, $.root(), token)
  if (!found) throw new NoRulesTag(token)
  return found.rules
}

function projectData(load, html, options) {
  const $ = load(html)
  return extract(cheerioAdapter, $.root(), rulesOf($, options))
}

function markKey(marks) {
  return MARKS.map(code => marks[code] ? code + (Array.isArray(marks[code]) ? JSON.stringify(marks[code]) : '') : '').join('')
}

function contentOf(node, type, projection) {
  const { ATOM, BREAK, normalizeText, runsOf } = projection
  if (type === 'code_block') {
    const code = node.children?.find(child => child.name === 'code')
    const text = (code || node).children?.map(child => child.data ?? '').join('') ?? ''
    return { c: text }
  }
  const root = type === 'toggle' ? node.children?.find(child => child.name === 'summary') : node
  if (!root) refuse('A page text block lost its content element')
  let c = ''
  const units = []
  const walk = (parent, marks) => {
    for (const child of parent.children || []) {
      if (type === 'list_item' && (child.name === 'input' || child.name === 'ul' || child.name === 'ol')) continue
      if (child.type === 'text') {
        c += child.data
        units.push(...Array(child.data.length).fill(markKey(marks)))
        continue
      }
      if (child.type !== 'tag') continue
      if (child.name === 'br' || child.name === 'span' && child.attribs?.['data-atom']) {
        c += ATOM
        units.push(child.name === 'br' ? BREAK : child.attribs['data-atom'])
        continue
      }
      const next = { ...marks }
      if (child.name === 'strong' || child.name === 'b') next.b = true
      else if (child.name === 'em' || child.name === 'i') next.i = true
      else if (['s', 'del', 'strike'].includes(child.name)) next.s = true
      else if (child.name === 'code') next.c = true
      else if (child.name === 'a' && child.attribs?.href) next.a = [child.attribs.href]
      walk(child, next)
    }
  }
  walk(root, {})
  const normalized = normalizeText(c, units)
  const content = { c: normalized.c }
  if (normalized.units.some(Boolean)) content.m = runsOf(normalized.units)
  return content
}

function attrsOf($, node, type, stored) {
  const el = $(node)
  const attr = name => el.attr(name) ?? null
  if (type === 'heading') return { level: Number(node.name.slice(1)) }
  if (type === 'code_block') return { lang: attr('data-lang') ?? '' }
  if (type === 'toggle') return { open: attr('open') !== null }
  if (type === 'list_item') return {
    checked: el.children('input[type="checkbox"]').attr('checked') !== undefined,
    owner: attr('data-owner'), due: attr('data-due'),
  }
  if (type === 'image') {
    const image = el.find('img').first()
    const width = image.attr('width')
    return {
      src: image.attr('src') ?? '', alt: image.attr('alt') ?? '',
      caption: el.children('figcaption').text(),
      width: width === undefined ? null : Number(width), align: attr('data-align'),
    }
  }
  if (type === 'file') {
    const size = attr('data-size')
    return { src: attr('data-src') ?? '', name: attr('data-name') ?? '', size: size === null ? null : Number(size), mime: attr('data-mime') }
  }
  if (type === 'chart') {
    let series
    try { series = JSON.parse(attr('data-series') ?? '[]') } catch { refuse('Invalid chart series') }
    return {
      source: attr('data-source'), kind: attr('data-kind') ?? 'line', x: attr('data-x'),
      series, title: el.children('figcaption').text(), highlight: attr('data-highlight'),
    }
  }
  if (type === 'table') {
    let sort
    try { sort = JSON.parse(attr('data-sort') ?? 'null') } catch { refuse('Invalid table sort') }
    const cols = { ...stored.cols }
    const headers = el.find('thead tr').first().children('th')
    headers.each((_, th) => {
      const id = $(th).attr('data-col')
      if (!Object.hasOwn(cols, id)) return
      const column = { ...cols[id], name: $(th).text() }
      if ($(th).attr('data-kind') === undefined) delete column.kind
      else column.kind = $(th).attr('data-kind')
      cols[id] = column
    })
    const rows = { ...stored.rows }
    el.find('tbody tr').each((_, tr) => {
      const id = $(tr).attr('data-id')
      if (!Object.hasOwn(rows, id)) return
      const cells = { ...rows[id].cells }
      $(tr).children('td').each((index, td) => {
        const col = headers.eq(index).attr('data-col')
        if (Object.hasOwn(cols, col)) cells[col] = $(td).text()
      })
      rows[id] = { ...rows[id], cells }
    })
    return { cols, rows, sort }
  }
  if (type === 'board') {
    const columns = { ...stored.columns }
    const cards = { ...stored.cards }
    el.children('div[data-col]').each((_, div) => {
      const col = $(div).attr('data-col')
      if (Object.hasOwn(columns, col)) columns[col] = { ...columns[col], name: $(div).children('h4').text() }
      $(div).find('ul > li[data-id]').each((_, li) => {
        const id = $(li).attr('data-id')
        if (!Object.hasOwn(cards, id)) return
        cards[id] = {
          ...cards[id], col, title: $(li).text(),
          owner: $(li).attr('data-owner') ?? null, due: $(li).attr('data-due') ?? null,
        }
      })
    })
    return { columns, cards }
  }
  return {}
}

function blockNode($, article, id) {
  const matches = $(article).find('[data-id]').filter((_, node) => $(node).attr('data-id') === id)
  if (matches.length !== 1) refuse(`Page block ${id} is missing or duplicated`)
  return matches[0]
}

function pageChanges($, article, baseline$, baselineArticle, blocks, model, projection) {
  const { canon } = projection
  const changes = []
  for (const block of model) {
    const node = blockNode($, article, block.id)
    const old = blockNode(baseline$, baselineArticle, block.id)
    const change = { id: block.id }
    if (TEXT.has(block.t)) {
      const content = contentOf(node, block.t, projection)
      if (canon(content) !== canon(contentOf(old, block.t, projection))) change.content = content
    }
    const attrs = attrsOf($, node, block.t, blocks[block.id])
    const previous = attrsOf(baseline$, old, block.t, blocks[block.id])
    const changedAttrs = Object.fromEntries(Object.keys(attrs).filter(key => canon(attrs[key]) !== canon(previous[key])).map(key => [key, attrs[key]]))
    if (Object.keys(changedAttrs).length) change.attrs = changedAttrs
    if (change.content || change.attrs) changes.push(change)
  }
  return changes
}

function sameArticle($, article, projected) {
  const expected = $(article).clone()
  expected.html(projected.html)
  return $(article).html() === expected.html()
}

function proposedBlocks(blocks, changes) {
  const proposed = { ...blocks }
  for (const { id, content, attrs } of changes) {
    const block = { ...blocks[id], ...attrs }
    if (content) {
      block.c = content.c
      delete block.m
      if (content.m) block.m = content.m
    }
    proposed[id] = block
  }
  return proposed
}

function codecError(error) {
  if (error?.code === 'missing-revision') return new PageWriteRefused('revision-required', error.message)
  if (error?.code === 'stale-revision') return new PageWriteRefused('revision-stale', error.message)
  if (error?.name === 'YDecodeError') {
    return new PageWriteRefused('invalid-content', error.message)
  }
  return error
}

export async function readPageDocument(load, html, options = {}) {
  const $ = load(html, { sourceCodeLocationInfo: true })
  const nodes = pageNodes($)
  if (!nodes) return { data: projectData(load, html, options), blocks: null, revision: null }
  const projection = options.codec?.projection
  if (!projection) throw new TypeError('A page codec.projection is required')
  if (typeof options.codec?.readYValue !== 'function') refuse('A page codec is required')
  let page
  try { page = await options.codec.readYValue(valueOf($, nodes.tag)) } catch (error) { throw codecError(error) }
  const aligned = withArticle(load, html, projectionOf(load, page.blocks, projection))
  return { data: projectData(load, aligned, options), blocks: page.blocks, revision: page.revision }
}

export async function writePageDocument(load, html, data, options = {}) {
  const $ = load(html, { sourceCodeLocationInfo: true })
  const nodes = pageNodes($)
  if (!nodes) return writeDocument(load, html, data, options)
  const projection = options.codec?.projection
  if (!projection) throw new TypeError('A page codec.projection is required')
  if (typeof options.codec?.readYValue !== 'function' || typeof options.codec?.writeYValue !== 'function') refuse('A page codec is required')
  const { canon } = projection
  if (typeof options.expectedRevision !== 'string' || !options.expectedRevision) {
    throw new PageWriteRefused('revision-required', 'A page revision is required')
  }
  const value = valueOf($, nodes.tag)
  let page
  try { page = await options.codec.readYValue(value) } catch (error) { throw codecError(error) }
  if (page.revision !== options.expectedRevision) {
    throw new PageWriteRefused('revision-stale', 'The page revision has changed')
  }
  const before = projectionOf(load, page.blocks, projection)
  const aligned = withArticle(load, html, before)
  const candidate = writeDocument(load, aligned, data, options)
  const next$ = load(candidate.html, { sourceCodeLocationInfo: true })
  const nextNodes = pageNodes(next$)
  const aligned$ = load(aligned)
  const alignedArticle = pageNodes(aligned$).article
  const changes = pageChanges(next$, nextNodes.article, aligned$, alignedArticle, page.blocks, before.model, projection)
  const unchangedAttrs = canon(next$(nextNodes.article).attr()) === canon(aligned$(alignedArticle).attr())
  const proposed = projectionOf(load, proposedBlocks(page.blocks, changes), projection)
  if (!unchangedAttrs || !sameArticle(next$, nextNodes.article, proposed)) {
    refuse('The article edit cannot be represented in the page store')
  }
  let written = { value, blocks: page.blocks, revision: page.revision }
  if (changes.length) {
    try {
      written = await options.codec.writeYValue(value, { expectedRevision: page.revision, changes })
    } catch (error) { throw codecError(error) }
  }
  const after = projectionOf(load, written.blocks, projection)
  if (!sameArticle(next$, nextNodes.article, after)) {
    refuse('The article edit cannot be represented in the page store')
  }
  const article = next$(nextNodes.article)
  article.html(after.html)
  article.attr('data-rev', after.rev)
  const tag = next$(nextNodes.tag)
  if (changes.length) tag.text(JSON.stringify(written.value).replace(/</g, '\\u003c'))
  const replacements = [{ node: nextNodes.article, text: next$.html(nextNodes.article) }]
  if (changes.length) replacements.push({ node: nextNodes.tag, text: next$.html(nextNodes.tag) })
  return { html: splice(candidate.html, replacements), revision: written.revision }
}
