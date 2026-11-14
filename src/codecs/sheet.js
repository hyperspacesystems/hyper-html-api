// The sheet codec as the engine sees it, for the rule "[items=sheets]@codec(sheet)".
// The rule selects the tabs container. Each tab is a <section item data-id> holding
// an <h2 bind="name"> and one <table grid> (sapjs/src/grid/codec/GRAMMAR.md).
//
// A read takes a table's canonical bytes from ctx.region(table) when a host cut
// them out of the source (the fast route, readDocument), and otherwise reads the
// table the HTML parser built (the tree route). Both give the same model.
//
// Query shapes (ctx.query):
//   none                         -> [{ id, name, cols, rows, stale? }]   every tab
//   { shape: 'index' }           -> [{ id, name, rows, cols, frozenRows }]
//   { sheet }                    -> { id, name, cols, rows, stale? }     one tab
//   { sheet?, range, render? }   -> { sheet, range, values } or { sheet, range, cols, rows }
// ctx.view === 'digest'          -> [{ id, name, cols, rows }]          for the data loss guard:
//                                    cols names the column behind each row digest's mask bits
// `sheet` matches a tab's name first, then its id; a range with no sheet reads the first tab.

import { CodecRefused } from '../engine/errors.js'
import {
  QueryRefused,
  STYLE_PROPERTIES,
  cutGrids,
  gridModel,
  readRange,
  tabIndex,
  tabDigest,
  tabJson,
  treeModel,
} from './sheet.vendor.js'

const TAGS = ['table', 'colgroup', 'col', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption']

// The engine adapter as the codec's tree route wants it. Text is textContent,
// never the engine's trimmed text(), because a cell's text is never trimmed.
export function treeAdapter(adapter) {
  return {
    name: (node) => TAGS.find((tag) => adapter.matches(node, tag)) ?? '',
    attr: (node, name) => adapter.attr(node, name) ?? null,
    children: (node) => adapter.children(node),
    text: (node) => String(adapter.prop(node, 'textContent') ?? ''),
  }
}

const childMatching = (adapter, node, selector) => adapter.children(node).find((child) => adapter.matches(child, selector))

// Each tab under the container: { id, name, section, table } (table is null when the
// section has none). A cms-template seed or a sapjs template item is not a tab: it is
// the shape a new tab is cloned from. Shared by reads and by patchDocument.
export function tabNodes(adapter, node) {
  const tree = treeAdapter(adapter)
  return adapter.children(node)
    .filter((child) => adapter.matches(child, 'section[item]') && adapter.attr(child, 'cms-template') == null && adapter.attr(child, 'template') == null)
    .map((section) => {
      const heading = childMatching(adapter, section, 'h2[bind="name"]')
      return {
        id: adapter.attr(section, 'data-id') ?? '',
        name: heading ? tree.text(heading) : '',
        section,
        table: childMatching(adapter, section, 'table[grid]') ?? null,
      }
    })
}

function tabsOf(adapter, node, ctx) {
  const tree = treeAdapter(adapter)
  return tabNodes(adapter, node).map(({ id, name, table }) => {
    const bytes = table && typeof ctx.region === 'function' ? ctx.region(table) : null
    const sheet = bytes != null ? gridModel(bytes, 0) : table ? treeModel(tree, table) : { cols: [], rows: [] }
    return { id, name, sheet }
  })
}

// The tab a query or a patch names: by name first, then by id; no name means the first tab.
export function pickTab(tabs, wanted) {
  if (wanted === undefined) {
    if (tabs.length === 0) throw new QueryRefused('unknown_sheet', 'this document has no sheets')
    return tabs[0]
  }
  const tab = tabs.find((t) => t.name === wanted) ?? tabs.find((t) => t.id === wanted)
  if (!tab) throw new QueryRefused('unknown_sheet', `no sheet named ${JSON.stringify(wanted)}; ask for shape=index to list them`)
  return tab
}

function read(adapter, node, ctx = {}) {
  const tabs = tabsOf(adapter, node, ctx)
  const query = ctx.query ?? {}
  if (ctx.view === 'digest') return tabs.map(({ id, name, sheet }) => ({ id, name, ...tabDigest(sheet) }))
  if (query.shape !== undefined && query.shape !== 'index') {
    throw new QueryRefused('bad_shape', `unknown shape ${JSON.stringify(query.shape)}; the only shape is index`)
  }
  if (query.render !== undefined && query.range === undefined) {
    throw new QueryRefused('bad_render', 'render needs a range, for example range=A1:C10&render=formulas')
  }
  if (query.shape === 'index') return tabs.map(({ id, name, sheet }) => ({ id, name, ...tabIndex(sheet) }))
  if (query.range !== undefined) {
    const tab = pickTab(tabs, query.sheet)
    return { sheet: tab.name, range: query.range, ...readRange(tab.sheet, query.range, query.render ?? 'values') }
  }
  if (query.sheet !== undefined) {
    const { id, name, sheet } = pickTab(tabs, query.sheet)
    return { id, name, ...tabJson(sheet) }
  }
  return tabs.map(({ id, name, sheet }) => ({ id, name, ...tabJson(sheet) }))
}

export const WRITE_UNAVAILABLE_MESSAGE =
  'A sheet cannot be replaced as a whole value yet: send patch operations instead, for example [{ "sheet": "Budget", "range": "B3", "values": [[450]] }].'

// Whole replace is a follow-up with its own spec (whether a missing tab is
// deleted changes user data). Hosts answer this refusal with 409.
function write() {
  throw new CodecRefused('sheet-write-unavailable', WRITE_UNAVAILABLE_MESSAGE)
}

function same(written, reread) {
  return JSON.stringify(written) === JSON.stringify(reread)
}

export const sheet = {
  name: 'sheet',
  read,
  write,
  same,
  styles: STYLE_PROPERTIES,
  cut: cutGrids,
}

export { QueryRefused }
export * as grid from './sheet.vendor.js'
