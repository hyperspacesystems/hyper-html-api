// Whether a document's rules read a computed value: one a page's script writes,
// which a host that applies a write without running the page cannot bring up to
// date. A host answers such a write as stale (calculator documents plan, M1a).
//
// A value is computed when the node a rule reads sits inside an <output>, a
// `clay="no-dirty"`, `no-dirty` or `save-ignore` region; when sapjs paints what the
// rule reads (the directives below, inside a [sap] app and outside a template or
// sap-ignore subtree, as sapjs/src/ownership.js decides); or when a sheet rule's
// table holds a formula or a `stale` mark. Nothing runs: only rules and markup are
// read, so a page whose script only touches its own editor UI is not computed.
//
// opts.sheets === false leaves sheet tables out: a host uses it to decide the
// stale mark, which never marks a value only a sheet computes.

import { codecOf, splitRule, ruleAttrIndex } from './engine/rule-syntax.js'
import { isCustomPropertyName } from './engine/style-vars.js'

const COMPUTED_REGION = 'output, [clay~="no-dirty"], [no-dirty], [save-ignore]'
const INERT = 'template, [template], [cms-template], [sap-ignore]'
const NEVER = new Set(['id', 'data-id', 'sap', 'scope', 'items', 'item', 'bind', 'state', 'template', 'cms-template', 'sap-ignore'])
const FORM_STATE = new Set(['value', 'checked', 'selected'])
const WHEN = /^(show-when|hide-when|option|option-not):/
const TEXT_PROPS = new Set(['textContent', 'innerText', 'innerHTML', 'outerHTML'])
const ANY_MARKER = `[sap], table[grid], ${COMPUTED_REGION}`

export function hasComputedRules(adapter, root, rules, opts = {}) {
  if (typeof adapter.attrNames !== 'function') throw new TypeError('hasComputedRules needs an adapter with attrNames()')
  if (!holdsMarker(adapter, root)) return false
  return readsComputed(adapter, root, rules, { allMatches: true, ...opts })
}

// Most pages hold nothing that computes; they answer without walking any rule.
function holdsMarker(adapter, root) {
  for (let cur = root; cur; cur = adapter.parent(cur)) if (adapter.matches(cur, ANY_MARKER)) return true
  return findAll(adapter, root, ANY_MARKER, { templateAttr: null }).length > 0
}

// A rule whose selector cannot run reads nothing, computed or not; it must not fail
// a write that does not name it.
function findAll(adapter, ctx, selector, opts) {
  try {
    return adapter.find(ctx, selector, opts)
  } catch {
    return []
  }
}

function readsComputed(adapter, ctx, rule, opts) {
  if (typeof rule === 'string') return scalarComputed(adapter, ctx, rule, opts)
  if (Array.isArray(rule)) {
    const [selector, shape] = rule
    return findAll(adapter, ctx, selector, opts).some((node) => readsComputed(adapter, node, shape, opts))
  }
  if (rule !== null && typeof rule === 'object') {
    return Object.values(rule).some((sub) => readsComputed(adapter, ctx, sub, opts))
  }
  return false
}

// A scalar rule reads its first match only, unless it is a [*] rule.
function scalarComputed(adapter, ctx, rule, opts) {
  if (rule.endsWith('[]')) return findAll(adapter, ctx, rule.slice(0, -2), opts).some((node) => textComputed(adapter, node))
  const codec = codecOf(rule)
  if (codec) {
    const nodes = codec.selector ? findAll(adapter, ctx, codec.selector, opts).slice(0, 1) : [ctx]
    return codec.name === 'sheet' && nodes.some((node) => sheetComputed(adapter, node, opts))
  }
  if (rule.startsWith('@')) return attrComputed(adapter, ctx, rule.slice(1))
  if (rule === '.') return textComputed(adapter, ctx)
  const { selector, prop, all } = splitRule(rule)
  const found = selector ? findAll(adapter, ctx, selector, opts) : [ctx]
  const nodes = all ? found : found.slice(0, 1)
  if (ruleAttrIndex(rule) !== -1) return nodes.some((node) => attrComputed(adapter, node, prop))
  return nodes.some((node) => textComputed(adapter, node))
}

// Text is computed when the node is in a computed region, or it or anything under
// it holds a computed region or painted text.
function textComputed(adapter, node) {
  if (inComputedRegion(adapter, node)) return true
  if (findAll(adapter, node, COMPUTED_REGION, { templateAttr: null }).length > 0) return true
  if (paintsText(adapter, node)) return true
  return findAll(adapter, node, '*', { templateAttr: null }).some((el) => paintsText(adapter, el))
}

// Attribute names are lower case in HTML, so a property rule (@readOnly) reads the
// attribute sapjs paints under the lower case name. sapjs's css:name paints --name.
function attrComputed(adapter, node, prop) {
  if (TEXT_PROPS.has(prop)) return textComputed(adapter, node)
  if (inComputedRegion(adapter, node)) return true
  if (!prop || !appOf(adapter, node)) return false
  const names = adapter.attrNames(node)
  if (isCustomPropertyName(prop)) return names.includes(`css:${prop.slice(2).toLowerCase()}`)
  const name = prop === 'className' || prop === 'classList' ? 'class' : prop.toLowerCase()
  if (name === 'hidden') return names.some((n) => n === 'show' || WHEN.test(n))
  if (name === 'class') return names.some((n) => n.startsWith('class:'))
  if (name === 'style') return names.some((n) => n.startsWith('css:'))
  if (NEVER.has(name)) return false
  if (FORM_STATE.has(name) && ownsFormState(adapter, node)) return false
  return names.includes(`attr:${name}`) && !declares(adapter, node, name)
}

function paintsText(adapter, node) {
  if (adapter.attr(node, 'bind') !== null) return false
  if (!adapter.attrNames(node).some((n) => n === 'text' || n.startsWith('text:'))) return false
  return appOf(adapter, node)
}

function sheetComputed(adapter, node, opts) {
  if (opts.sheets === false) return false
  const found = adapter.matches(node, 'table[grid]') ? [node] : findAll(adapter, node, 'table[grid]', opts)
  const tables = found.filter((table) => !insideInert(adapter, table))
  return tables.some((table) => adapter.attr(table, 'stale') !== null || findAll(adapter, table, 'td[f], th[f]', opts).length > 0)
}

function inComputedRegion(adapter, node) {
  for (let cur = node; cur; cur = adapter.parent(cur)) if (adapter.matches(cur, COMPUTED_REGION)) return true
  return false
}

// A tab's blueprint (a template inside the tab list) is not a live table.
function insideInert(adapter, node) {
  for (let cur = node; cur; cur = adapter.parent(cur)) if (adapter.matches(cur, INERT)) return true
  return false
}

// Whether node sits in a [sap] app that paints it: no inert subtree on the way up.
function appOf(adapter, node) {
  for (let cur = node; cur; cur = adapter.parent(cur)) {
    if (adapter.matches(cur, INERT)) return false
    if (adapter.attr(cur, 'sap') !== null) return true
  }
  return false
}

function ownsFormState(adapter, node) {
  if (adapter.attr(node, 'bind') !== null || adapter.attr(node, 'persist') !== null) return true
  for (let cur = node; cur; cur = adapter.parent(cur)) if (adapter.matches(cur, 'select[bind]')) return true
  return false
}

function declares(adapter, node, name) {
  const decl = adapter.attr(node, 'state')
  if (!decl) return false
  return decl.trim().split(/\s+/).some((token) => token.split('=')[0].split(':')[0] === name)
}
