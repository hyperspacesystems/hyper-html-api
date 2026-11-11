import { DOM_PROPERTIES_READ_ONLY_SET } from '../engine/dom-properties.js'
import { ruleAttrIndex } from '../engine/rule-syntax.js'

/**
 * Walk v2Rules pulling matching values from v1Data.
 *
 * Outside a list, what v1 has no value for keeps v2's template default:
 *
 *   - Scalar leaves: carry the v1 value if defined, else leave undefined so
 *     the engine keeps v2's template default on apply.
 *   - Lists: carry v1's items, trimmed to v1's count; a list v1 never had
 *     keeps v2's rows.
 *   - Objects: recurse per key.
 *
 * Inside a list item nothing keeps a default. A row is the owner's own. It is
 * written over a v2 sample row, or over a clone of one, so a field left
 * undefined would take that sample's value (its label, its cover, its done
 * mark, its id). So in a row:
 *
 *   - A field v1 read as null, a field v1 never had (v2 added it), and a
 *     scalar field where v1 holds an object are all carried as null, and the
 *     write clears them.
 *   - A list v1 never had is carried as an empty list.
 *   - A property nothing can write (tagName, childElementCount) stays
 *     undefined, because writing null to it refuses the whole write.
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
      if (!Array.isArray(v1)) return inRow ? [] : undefined
      summary.listItems += v1.length
      summary.carriedOver += v1.length
      return v1
    }
    // A scalar slot can't hold an object/array from v1 (collectDiscards counts
    // the dropped leaves), so it is treated as a slot v1 has no value for.
    if (v1 == null || typeof v1 === 'object') return inRow && !readOnly(rule) ? null : undefined
    summary.carriedOver++
    return v1
  }
  if (Array.isArray(rule)) {
    const [, shape] = rule
    if (!Array.isArray(v1)) return inRow ? [] : undefined
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
