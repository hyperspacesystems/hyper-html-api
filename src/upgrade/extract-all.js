import { extract } from '../engine/extract.js'
import domAdapter from '../adapters/dom.js'
import { collectRulesTags } from './rules-tags.js'
import { splitCarried, carriedNode } from './codec-carry.js'
import { readMeta } from './check.js'

/**
 * Keyed extraction: one entry per rules tag under `root`, keyed by the
 * normalized data-rules-name value. This is the v1 side of an upgrade:
 * pack the page's data into labeled boxes. A `@codec(name)` key (a sheet,
 * version 2 tags only) packs as its container's markup string, which a
 * transform passes through unchanged.
 */
export function extractAllFrom(adapter, root) {
  const dataByName = {}
  for (const { name, rules, version } of collectRulesTags(adapter, root)) {
    const { rules: plain, carried } = splitCarried(rules, version)
    const data = extract(adapter, root, plain, { version })
    for (const { key, selector } of carried) {
      const node = carriedNode(adapter, root, selector)
      data[key] = node ? adapter.prop(node, 'innerHTML') : null
    }
    dataByName[name] = data
  }
  return dataByName
}

export function extractAll(root) {
  const r = root || document
  const doc = r.nodeType === 9 ? r : r.ownerDocument || r
  return {
    dataByName: extractAllFrom(domAdapter, r),
    version: readMeta(doc, 'hyper-version'),
  }
}
