import { apply } from '../engine/apply.js'
import { collectRulesTags } from './rules-tags.js'
import { shapeMatch, countScalarLeaves } from './shape-match.js'
import { splitCarried, carriedNode } from './codec-carry.js'

/**
 * Pour keyed v1 data into the v2 document. Exact-name join: each v2 rules
 * tag pulls the entry with the same normalized name; tags with no matching
 * entry keep their template defaults; v1 entries with no matching tag are
 * counted as discarded. Renames are the transform's job, not the join's.
 * A `@codec(name)` key takes its markup string whole into the new
 * template's container for that key.
 */
export function migrateInto(adapter, root, dataByName) {
  const tags = collectRulesTags(adapter, root)
  const totals = { carriedOver: 0, discarded: 0, listItems: 0 }
  const byName = {}
  const v2Names = new Set()

  for (const { name, rules, version } of tags) {
    v2Names.add(name)
    if (!Object.prototype.hasOwnProperty.call(dataByName, name)) {
      byName[name] = { carriedOver: 0, discarded: 0, listItems: 0 }
      continue
    }
    const { rules: plain, carried } = splitCarried(rules, version)
    const entry = dataByName[name]
    const { data, summary } = shapeMatch(withoutCarried(entry, carried), plain)
    // A row whose nested list is empty at that spot in v2 grows from the page's seeds, as a write does.
    apply(adapter, root, plain, data, { templateAttr: 'cms-template' })
    for (const { key, selector } of carried) {
      const markup = isPlainObject(entry) ? entry[key] : undefined
      if (markup === undefined || markup === null) continue
      const node = carriedNode(adapter, root, selector)
      if (typeof markup === 'string' && node) {
        adapter.prop(node, 'innerHTML', markup)
        summary.carriedOver += 1
      } else {
        summary.discarded += 1
      }
    }
    byName[name] = summary
    totals.carriedOver += summary.carriedOver
    totals.discarded += summary.discarded
    totals.listItems += summary.listItems
  }

  for (const key of Object.keys(dataByName)) {
    if (!v2Names.has(key)) totals.discarded += countScalarLeaves(dataByName[key])
  }

  return { totals, byName, rulesTagCount: tags.length }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function withoutCarried(entry, carried) {
  if (!carried.length || !isPlainObject(entry)) return entry
  const rest = { ...entry }
  for (const { key } of carried) delete rest[key]
  return rest
}
