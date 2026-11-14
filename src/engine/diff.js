import { EmptyListInsert } from './errors.js'
import { extract } from './extract.js'
import { finalChildCombinatorLeft } from './rule-syntax.js'
import { matchRows } from './row-match.js'

/**
 * Reconcile `newItems` (array of incoming items) into the DOM subtree matched
 * by `parentCtx.find(selector)`. `shape` is null for scalar lists (items are
 * strings) or the rule shape for object lists.
 *
 * applyItem is passed in (normally `applyAt` from apply.js) to avoid a
 * circular import; object-list items use it to recursively apply their shape.
 */
export function listDiff(adapter, parentCtx, selector, shape, newItems, trace, applyItem, opts = {}) {
  const oldNodes = adapter.find(parentCtx, selector, opts)

  if (newItems.length === 0) {
    oldNodes.forEach((n) => adapter.remove(n))
    // Still once per list: a consumer keyed by path has to learn it settled empty.
    callHook(opts, 'onRowsApplied', trace.path, [])
    return
  }

  const needsTemplate = newItems.length > oldNodes.length
  let templateSource = oldNodes[0] || null
  if (needsTemplate && !templateSource) {
    templateSource = findFallbackTemplate(adapter, parentCtx, selector, opts)
    if (!templateSource) throw new EmptyListInsert(trace.path)
  }

  const oldValues = oldNodes.map((n) => extractItem(adapter, n, shape, opts))

  // Only a list that grew can need a clone, because matchRows pairs every row
  // it can. Cloning unconditionally made a plain edit strip the ids off a
  // template it never used, and warn about it, on every keystroke.
  let template = null
  if (needsTemplate && templateSource) {
    template = adapter.clone(templateSource)
    const seed = opts.templateAttr && adapter.attr(templateSource, opts.templateAttr) != null
    if (opts.templateAttr) adapter.removeAttr(template, opts.templateAttr)
    // A seed is often hidden with the hidden attribute; its clones are real items.
    if (seed) adapter.removeAttr(template, 'hidden')
    const stripped = adapter.stripIds(template)
    if (stripped > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[hyper-html-api] stripped ${stripped} id attribute(s) from cloned template at "${trace.path.join('.') || '(root)'}"`,
      )
    }
  }

  const matches = matchRows(newItems, oldValues, shape, lockSuppliedRows(adapter, oldNodes, newItems, trace, opts))

  const parent = oldNodes.length > 0
    ? adapter.parent(oldNodes[0])
    : destinationFor(adapter, parentCtx, selector, templateSource, trace, opts)
  const anchorIdx = oldNodes.length > 0
    ? indexInParent(adapter, parent, oldNodes[0])
    : 0
  const contiguous = isContiguousRun(adapter, oldNodes)

  const used = new Set()
  const fresh = []
  const finalNodes = newItems.map((_, i) => {
    const oldIdx = matches[i]
    if (oldIdx >= 0) {
      used.add(oldIdx)
      fresh.push(false)
      return oldNodes[oldIdx]
    }
    fresh.push(true)
    const cloned = adapter.clone(template)
    adapter.stripIds(cloned)
    return cloned
  })

  // Remove only unmatched old nodes. Matched nodes stay attached so DOM
  // identity (focus, observers, animations) survives the reorder.
  oldNodes.forEach((n, i) => {
    if (!used.has(i)) adapter.remove(n)
  })

  if (contiguous) {
    placeContiguous(adapter, parent, anchorIdx, finalNodes, fresh)
  } else {
    // The matched nodes are not a contiguous run of siblings, so this list has
    // no DOM order to restore: any repositioning would move elements the list
    // does not own. Anchoring every node to parent(oldNodes[0]) is what
    // reparents a cross-parent list into its first container and compacts past
    // unowned siblings, and both destroy content on a write that changed
    // nothing. Leave every surviving node exactly where the author put it and
    // only place the grown ones.
    placeGrownItems(adapter, finalNodes, fresh, parent, anchorIdx)
  }

  writeItems(adapter, finalNodes, shape, newItems, trace, applyItem, opts)

  // writeItems can replace a node (@outerHTML on the item itself) and updates
  // finalNodes in place, so this reports the nodes the list actually ended with.
  callHook(opts, 'onRowsApplied', trace.path, finalNodes)
}

// Consumer code runs in the middle of an engine write, and onRowsApplied runs
// after the list is already written. Letting it throw left the page written and
// the apply reported as failed, which in hypercms meant an error banner, a stale
// fingerprint, and a page that no longer matched it. A hook is an optional
// report; a broken one is the consumer's bug to see, not a reason to abandon a
// finished write.
function callHook(opts, name, path, arg) {
  if (typeof opts[name] !== 'function') return undefined
  try {
    return opts[name](path.slice(), arg)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[hyper-html-api] ${name} threw at "${path.join('.') || '(root)'}"`, err)
    return undefined
  }
}

// A caller that already knows which node each incoming item belongs to can say
// so, and content matching cannot tell two byte-identical rows apart however
// good it gets. `identifyRows` returns an array parallel to newItems of
// Node | null. A node that is not in this list right now is ignored, so a stale
// handle degrades to matching rather than corrupting the list.
function lockSuppliedRows(adapter, oldNodes, newItems, trace, opts) {
  const supplied = callHook(opts, 'identifyRows', trace.path, newItems)
  if (!Array.isArray(supplied)) return null
  const locked = new Array(newItems.length).fill(-1)
  const taken = new Set()
  const position = new Map(oldNodes.map((n, j) => [adapter.identity(n), j]))
  for (let i = 0; i < newItems.length; i++) {
    if (!supplied[i]) continue
    const j = position.get(adapter.identity(supplied[i]))
    if (j === undefined || taken.has(j)) continue
    locked[i] = j
    taken.add(j)
  }
  return locked
}

// Apply per-item content. Skip when the existing value already matches
// — saves a write on no-op applies and avoids spurious mutation events.
function writeItems(adapter, finalNodes, shape, newItems, trace, applyItem, opts) {
  finalNodes.forEach((node, i) => {
    if (shape === null) {
      const v = newItems[i]
      const target = v == null ? '' : String(v)
      if (adapter.text(node) !== target) adapter.text(node, target)
    } else {
      // applyItem may replace the node (e.g. @outerHTML on the item itself);
      // capture the return so finalNodes stays current for later passes.
      const newNode = applyItem(adapter, node, shape, newItems[i], {
        depth: trace.depth + 1,
        path: [...trace.path, i],
      }, opts)
      if (newNode && newNode !== node) finalNodes[i] = newNode
    }
  })
}

function extractItem(adapter, node, shape, opts) {
  if (shape === null) return adapter.text(node)
  // This is a per-row read whose path restarts at the row, so a caller's
  // onRowsRead would see a nested list under a truncated path and bind it to the
  // wrong parent. The read hook belongs to a top-level extract only, and
  // engine.bind() hands one opts object to both halves, so the caller cannot
  // always keep them apart. Drop it here instead of documenting a rule the API
  // does not let everyone follow.
  return extract(adapter, node, shape, opts.onRowsRead ? { ...opts, onRowsRead: undefined } : opts)
}

function indexInParent(adapter, parent, targetNode) {
  const siblings = adapter.children(parent)
  for (let i = 0; i < siblings.length; i++) {
    if (adapter.sameNode(siblings[i], targetNode)) return i
  }
  return -1
}

// Look for a template-marked node matching the selector. Walks up from
// parentCtx so a template defined once in an ancestor (e.g. on a sibling
// product's variant) is found even when the immediate container has none.
function findFallbackTemplate(adapter, parentCtx, selector, opts) {
  if (!opts.templateAttr) return null
  // A leading ":scope >" anchors a row to its own context, so an ancestor seed
  // bank can never answer that query: no element is a direct child of its own
  // descendant. Dropping just that anchor searches the ancestors for the rest of
  // the selector, so a checklist item seed still cannot pass for a comment seed.
  const anchored = /^\s*:scope\s*>\s*/.test(selector)
  // A row selector that excludes seeds by hand (":not([cms-template])") would hide
  // the very seed this lookup is for.
  const exclusion = new RegExp(':not\\(\\[' + opts.templateAttr.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&') + '\\]\\)', 'g')
  const search = selector.replace(/^\s*:scope\s*>\s*/, '').replace(exclusion, '')
  // The stripped anchor makes the rest of the selector far too loose on its own:
  // "p" or "div" matches any seed in any ancestor, including the seed bank root
  // itself. The seed's own selector says how deep its row's context sits and what
  // that node has to look like, and its container has to be the one it names, so
  // a person seed under div.people cannot answer for a checklist.
  const steps = anchored ? childSteps(search) : 0
  const container = finalChildCombinatorLeft(search)
  let scope = parentCtx
  while (scope) {
    // templateAttr:null opts out of the adapter's default cms-template skip — the
    // fallback lookup MUST see the seed element to clone it for grow-from-zero.
    const candidates = adapter.find(scope, search, { includeRulesTag: false, templateAttr: null })
    for (const n of candidates) {
      if (adapter.attr(n, opts.templateAttr) == null) continue
      if (anchored && !matchesContextShape(adapter, parentCtx, n, steps)) continue
      if (container && !adapter.matches(adapter.parent(n), container)) continue
      return n
    }
    scope = adapter.parent(scope)
  }
  return null
}

// How many top-level child steps a stripped selector walks through ("p" is one,
// "ul.checklist-items > li" is two), or null when a descendant, "+" or "~"
// combinator makes the row's own context uncountable. Whitespace around a
// combinator is part of it, not a descendant step of its own.
function childSteps(selector) {
  let depth = 0
  let quote = null
  let steps = 1
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i]
    if (ch === '\\') {
      i++
    } else if (quote) {
      if (ch === quote) quote = null
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (ch === '[' || ch === '(') {
      depth++
    } else if (ch === ']' || ch === ')') {
      if (depth > 0) depth--
    } else if (depth === 0 && ch === '>') {
      steps++
    } else if (depth === 0 && (ch === '+' || ch === '~')) {
      return null
    } else if (depth === 0 && /\s/.test(ch)) {
      if (!combinatorSpace(selector, i)) return null
      while (i + 1 < selector.length && /\s/.test(selector[i + 1])) i++
    }
  }
  return steps
}

// Whitespace written next to ">", "+" or "~" belongs to that combinator; with a
// compound on both sides it is a descendant step of its own.
function combinatorSpace(selector, index) {
  let end = index
  while (end < selector.length && /\s/.test(selector[end])) end++
  const before = index > 0 ? selector[index - 1] : ''
  const after = end < selector.length ? selector[end] : ''
  return isCombinator(before) || isCombinator(after)
}

function isCombinator(ch) {
  return ch === '>' || ch === '+' || ch === '~'
}

// The node a stripped ":scope > ..." seed's own selector climbs to has to have
// this context's shape: the same tag, and every class this context carries. A
// bank's row seed reaches a seed of its own kind, while an unrelated seed
// (a person seed's div.people, the bank root's body) reaches something else.
function matchesContextShape(adapter, parentCtx, candidate, steps) {
  if (steps === null) return true
  let node = candidate
  for (let i = 0; i < steps; i++) {
    node = adapter.parent(node)
    if (!node) return false
  }
  const contextTag = adapter.prop(parentCtx, 'tagName')
  // A document or fragment context has no tag or class of its own to compare.
  if (!contextTag) return true
  const tag = adapter.prop(node, 'tagName')
  if (!tag || String(tag).toLowerCase() !== String(contextTag).toLowerCase()) return false
  const own = new Set(classNames(adapter, node))
  return classNames(adapter, parentCtx).every((name) => own.has(name))
}

function classNames(adapter, node) {
  const value = adapter.attr(node, 'class')
  return value ? String(value).split(/\s+/).filter(Boolean) : []
}

// Where the rows of an empty list go. The clone source says what a row looks
// like; the selector's container inside the context says where rows live. A seed
// that sits in a container of this context knows its own list, and stands in for
// the selector whatever it looks like: the last ">" in a selector can trail a
// descendant or sibling combinator, and then the text left of it is not the
// row's parent. A seed from outside the context (a hidden bank) says nothing
// about where the rows live, so the selector has to name the container.
function destinationFor(adapter, parentCtx, selector, templateSource, trace, opts) {
  const seedParent = adapter.parent(templateSource)
  if (seedParent && isWithin(adapter, parentCtx, seedParent) && !isSeedOrNoData(adapter, seedParent, opts)) {
    return seedParent
  }
  const container = finalChildCombinatorLeft(selector)
  if (!container) {
    throw new EmptyListInsert(
      trace.path,
      `the list selector "${selector}" names no container to hold the new rows — write it as "container > row" (for example "ol.comments > li") so the cloned row lands in the list`,
    )
  }
  // ":scope" names the context itself. A document or a fragment is not a
  // container that can hold rows, and placing a row at index zero of one would
  // put it outside <html>, so it counts as no destination at all.
  // find() already scopes the query to the context, so every candidate belongs
  // to it; a candidate inside a seed bank or a no-data region does not.
  const found = container === ':scope'
    ? (adapter.prop(parentCtx, 'tagName') ? [parentCtx] : [])
    : adapter.find(parentCtx, container, opts)
  const destinations = found.filter((node) => !isSeedOrNoData(adapter, node, opts))
  if (destinations.length === 0) {
    throw new EmptyListInsert(
      trace.path,
      `no container matching "${container}" inside this context to hold the new rows`,
    )
  }
  if (destinations.length > 1) {
    throw new EmptyListInsert(
      trace.path,
      `"${container}" matches ${destinations.length} containers inside this context, so the new rows have no single destination`,
    )
  }
  return destinations[0]
}

function isWithin(adapter, ancestor, node) {
  let current = node
  while (current) {
    if (adapter.sameNode(current, ancestor)) return true
    current = adapter.parent(current)
  }
  // A document (or cheerio's root) is not an element, so a parentElement walk
  // from inside it stops at <html> and never reaches it. Ask the adapter whether
  // it sees the node from there instead; a detached node in another tree stays
  // outside, because that query cannot see it either.
  if (adapter.parent(ancestor)) return false
  return adapter
    .find(ancestor, '*', { includeRulesTag: true, templateAttr: null })
    .some((n) => adapter.sameNode(n, node))
}

// The no-data tokens the adapters already filter reads with, read here through
// the adapter so both of them answer the same way.
const NO_DATA_ATTRS = ['no-data', 'editor-ui']

function isSeedOrNoData(adapter, node, opts) {
  let current = node
  while (current) {
    if (opts.templateAttr && adapter.attr(current, opts.templateAttr) != null) return true
    if (NO_DATA_ATTRS.some((name) => adapter.attr(current, name) != null)) return true
    const clay = adapter.attr(current, 'clay')
    if (clay && clay.split(/\s+/).some((token) => NO_DATA_ATTRS.includes(token))) return true
    current = adapter.parent(current)
  }
  return false
}

// Puts finalNodes at anchorIdx onward among the parent's content children and leaves every other
// child in its order. A node already in place is not touched, so an unchanged apply moves nothing.
// The children are read once and each move is mirrored in a local copy: reading them per row, as
// this used to, made a list write cost the square of its length.
//
// Every surviving node sits at or after its target when its turn comes, because the run started at
// anchorIdx and the earlier targets are already filled. So removing a node from the copy never
// shifts the target it is moving to.
function placeContiguous(adapter, parent, anchorIdx, finalNodes, fresh) {
  const siblings = adapter.children(parent)
  const order = siblings.map((s) => adapter.identity(s))
  // Past the end of the content children, insertAt appends to the very end of the
  // parent when the parent has no no-data child, which is past any trailing text:
  // "after the last content child" is NOT what it does there, and the document
  // has to come out byte-identical. So the first row that lands past the end still
  // goes through insertAt, and the rows after it follow that node, which is now
  // the parent's last child. Only one row ever pays for the index insert, because
  // the targets only move forward and the local copy grows with them.
  let appended = false
  finalNodes.forEach((node, i) => {
    const id = adapter.identity(node)
    const target = anchorIdx + i
    if (order[target] === id) return
    if (!fresh[i]) {
      const current = order.indexOf(id)
      if (current !== -1) {
        order.splice(current, 1)
        siblings.splice(current, 1)
      }
    }
    const at = Math.min(target, siblings.length)
    if (at < siblings.length) adapter.insertBefore(siblings[at], node)
    else if (!siblings.length) adapter.insertAt(parent, node, 0)
    else if (appended) adapter.insertAfter(siblings[siblings.length - 1], node)
    else {
      adapter.insertAt(parent, node, target)
      appended = true
    }
    order.splice(at, 0, id)
    siblings.splice(at, 0, node)
  })
}

// Repositioning only means something when the list occupies a contiguous run of
// element siblings under one parent. Two containers, or an unowned sibling
// sitting between two owned nodes, has no list order to restore.
function isContiguousRun(adapter, nodes) {
  if (nodes.length <= 1) return true
  const parent = adapter.parent(nodes[0])
  if (!parent) return false
  const position = new Map(adapter.children(parent).map((s, i) => [adapter.identity(s), i]))
  const indices = []
  for (const node of nodes) {
    const i = position.get(adapter.identity(node))
    if (i === undefined) return false
    indices.push(i)
  }
  indices.sort((a, b) => a - b)
  return indices[indices.length - 1] - indices[0] === indices.length - 1
}

// Grown items follow the surviving node before them, so a new row lands next to
// its neighbour rather than being teleported into the first container. With no
// surviving node before it, fall back to where the list started.
function placeGrownItems(adapter, finalNodes, fresh, fallbackParent, fallbackIdx) {
  let anchor = null
  let nextFallbackIdx = fallbackIdx
  for (let i = 0; i < finalNodes.length; i++) {
    if (!fresh[i]) {
      anchor = finalNodes[i]
      continue
    }
    const parent = anchor ? adapter.parent(anchor) : fallbackParent
    if (!parent) continue
    const at = anchor ? indexInParent(adapter, parent, anchor) + 1 : nextFallbackIdx++
    adapter.insertAt(parent, finalNodes[i], at)
    anchor = finalNodes[i]
  }
}
