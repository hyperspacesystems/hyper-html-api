import { DOM_PROPERTIES_SET } from './dom-properties.js'
import { MaxRuleDepthExceeded, MAX_RULE_DEPTH } from './errors.js'
import { ruleAttrIndex, splitRule } from './rule-syntax.js'
import { isCustomPropertyName, readStyleVar } from './style-vars.js'

export function extract(adapter, root, rules, opts = {}) {
  if (Object.prototype.hasOwnProperty.call(opts, 'exclude') && adapter.semanticExclude === false) {
    throw new Error('This adapter does not support semantic exclude queries; omit exclude or use the DOM adapter.')
  }
  return extractAt(adapter, root, rules, { depth: 0, path: [] }, opts)
}

function extractAt(adapter, ctx, rule, trace, opts) {
  if (trace.depth > MAX_RULE_DEPTH) throw new MaxRuleDepthExceeded(trace.path)

  if (typeof rule === 'string') return extractScalar(adapter, ctx, rule, trace, opts)

  if (Array.isArray(rule)) {
    const [selector, shape] = rule
    const matches = adapter.find(ctx, selector, opts)
    // The read-side mirror of apply's onRowsApplied: it tells a caller which
    // node each item came from, so identity can be established before anything
    // is written. Only pass this to a TOP-LEVEL extract. listDiff extracts each
    // existing row through this same function with a fresh path, so an opts
    // carrying this hook into apply() would report nested lists under a
    // truncated path.
    reportRows(opts, trace, matches)
    return matches.map((node, i) =>
      extractAt(adapter, node, shape, {
        depth: trace.depth + 1,
        path: [...trace.path, i],
      }, opts),
    )
  }

  if (typeof rule === 'object' && rule !== null) {
    const result = {}
    for (const [key, sub] of Object.entries(rule)) {
      result[key] = extractAt(adapter, ctx, sub, {
        depth: trace.depth + 1,
        path: [...trace.path, key],
      }, opts)
    }
    return result
  }

  return null
}

function extractScalar(adapter, ctx, rule, trace, opts) {
  if (rule.endsWith('[]')) {
    const selector = rule.slice(0, -2)
    const matches = adapter.find(ctx, selector, opts)
    // A scalar list is still a list, and its rows still need identity. Reported
    // here as well as in the tuple branch, because this one returns before it.
    reportRows(opts, trace, matches)
    return matches.map((n) => adapter.text(n))
  }

  if (rule.startsWith('@')) {
    return readPropOrAttr(adapter, ctx, rule.slice(1))
  }

  const at = ruleAttrIndex(rule)
  if (at !== -1) {
    const { selector, all } = splitRule(rule)
    const name = rule.slice(at + 1)
    const matches = selector ? adapter.find(ctx, selector, opts) : [ctx]
    if (all && opts.allMatches) return matches.map((n) => readPropOrAttr(adapter, n, name))
    if (matches.length === 0) return null
    return readPropOrAttr(adapter, matches[0], name)
  }

  if (rule === '.') return adapter.text(ctx)

  const { selector, all } = splitRule(rule)
  const matches = adapter.find(ctx, selector, opts)
  if (all && opts.allMatches) return matches.map((n) => adapter.text(n))
  return matches.length === 0 ? null : adapter.text(matches[0])
}

// The path is copied because the caller is handed it and every nested path is
// built from the same array. A throwing hook must not abandon the extract.
function reportRows(opts, trace, nodes) {
  if (typeof opts.onRowsRead !== 'function') return
  try {
    opts.onRowsRead(trace.path.slice(), nodes)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[hyper-html-api] onRowsRead threw at "${trace.path.join('.') || '(root)'}"`, err)
  }
}

function readPropOrAttr(adapter, node, name) {
  if (isCustomPropertyName(name)) return readStyleVar(adapter.attr(node, 'style'), name)
  if (DOM_PROPERTIES_SET.has(name)) {
    const v = adapter.prop(node, name)
    return v == null ? null : String(v)
  }
  const v = adapter.attr(node, name)
  return v == null ? null : v
}
