import { DOM_PROPERTIES_READ_ONLY_SET } from '../engine/dom-properties.js'
import { ruleAttrIndex } from '../engine/rule-syntax.js'

/**
 * Walk v2Rules pulling matching values from v1Data.
 *
 *   - Scalar leaves: carry the v1 value if defined, else leave undefined so
 *     the engine keeps v2's template default on apply.
 *   - Object arrays ([sel, shape]): carry v1's items, trimmed to v1's count;
 *     each item shape-matches recursively. Fields v2 added that didn't exist
 *     in v1 are left undefined → template default.
 *   - Inside a list item, a field v1 read as null is carried as null, so the
 *     write clears it. A row is written over a v2 sample row, or over a clone
 *     of one, and an empty field left undefined would keep that sample's
 *     value (its label, its cover, its done mark). A property nothing can
 *     write (tagName, childElementCount) stays undefined.
 *   - Scalar arrays (`sel[]`): carry as-is.
 *   - Objects: recurse per key.
 *
 * Returns { data, summary } where summary counts scalar leaves carried,
 * dropped, and total list items preserved.
 */
export function shapeMatch(v1Data, v2Rules) {
  const summary = { carriedOver: 0, discarded: 0, listItems: 0 }
  const data = walk(v2Rules, v1Data, summary)
  collectDiscards(v2Rules, v1Data, summary)
  return { data, summary }
}

function walk(rule, v1, summary, inRow = false) {
  if (typeof rule === 'string') {
    if (rule.endsWith('[]')) {
      if (!Array.isArray(v1)) return undefined
      summary.listItems += v1.length
      summary.carriedOver += v1.length
      return v1
    }
    if (v1 === undefined) return undefined
    if (v1 === null) return inRow && !readOnly(rule) ? null : undefined
    // A scalar slot can't hold an object/array from v1; leave the template
    // default (collectDiscards counts the dropped leaves).
    if (typeof v1 === 'object') return undefined
    summary.carriedOver++
    return v1
  }
  if (Array.isArray(rule)) {
    const [, shape] = rule
    if (!Array.isArray(v1)) return undefined
    summary.listItems += v1.length
    return v1.map((item) => walk(shape, item, summary, true))
  }
  if (typeof rule === 'object' && rule !== null) {
    const out = {}
    for (const [k, sub] of Object.entries(rule)) {
      const v = walk(sub, v1 == null ? undefined : v1[k], summary, inRow)
      if (v !== undefined) out[k] = v
    }
    return out
  }
  return undefined
}

function readOnly(rule) {
  const at = ruleAttrIndex(rule)
  return at !== -1 && DOM_PROPERTIES_READ_ONLY_SET.has(rule.slice(at + 1))
}

function collectDiscards(rule, v1, summary) {
  if (v1 == null) return
  if (typeof rule === 'object' && rule !== null && !Array.isArray(rule)) {
    if (typeof v1 !== 'object' || Array.isArray(v1)) return
    const known = new Set(Object.keys(rule))
    for (const k of Object.keys(v1)) {
      if (!known.has(k)) {
        summary.discarded += countScalarLeaves(v1[k])
      } else {
        collectDiscards(rule[k], v1[k], summary)
      }
    }
    return
  }
  if (Array.isArray(rule) && Array.isArray(v1)) {
    const shape = rule[1]
    v1.forEach((item) => collectDiscards(shape, item, summary))
    return
  }
  if (
    typeof rule === 'string' &&
    !rule.endsWith('[]') &&
    typeof v1 === 'object' &&
    v1 !== null
  ) {
    summary.discarded += countScalarLeaves(v1)
  }
}

export function countScalarLeaves(v) {
  if (v === null || v === undefined) return 0
  if (Array.isArray(v)) return v.reduce((n, x) => n + countScalarLeaves(x), 0)
  if (typeof v === 'object') {
    return Object.values(v).reduce((n, x) => n + countScalarLeaves(x), 0)
  }
  return 1
}
