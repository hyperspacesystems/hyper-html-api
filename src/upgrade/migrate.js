import { apply } from '../engine/apply.js'
import { collectRulesTags } from './rules-tags.js'
import { shapeMatch, countScalarLeaves } from './shape-match.js'

/**
 * Pour keyed v1 data into the v2 document. Exact-name join: each v2 rules
 * tag pulls the entry with the same normalized name; tags with no matching
 * entry keep their template defaults; v1 entries with no matching tag are
 * counted as discarded. Renames are the transform's job, not the join's.
 */
export function migrateInto(adapter, root, dataByName) {
  const tags = collectRulesTags(adapter, root)
  const totals = { carriedOver: 0, discarded: 0, listItems: 0 }
  const byName = {}
  const v2Names = new Set()

  for (const { name, rules } of tags) {
    v2Names.add(name)
    if (!Object.prototype.hasOwnProperty.call(dataByName, name)) {
      byName[name] = { carriedOver: 0, discarded: 0, listItems: 0 }
      continue
    }
    const { data, summary } = shapeMatch(dataByName[name], rules)
    // A row whose nested list is empty at that spot in v2 grows from the page's seeds, as a write does.
    apply(adapter, root, rules, data, { templateAttr: 'cms-template' })
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
