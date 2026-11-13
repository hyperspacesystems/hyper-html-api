import { codecOf } from '../engine/rule-syntax.js'

// Under a version 2 rules tag, a top level `@codec(name)` key (a sheet) is
// carried whole on upgrade: the extract side keeps its container's markup as
// a string, and the migrate side puts that string into the same key's
// container in the new template. The value is never read into data and
// written back, so the codec needs no whole-value write and the canonical
// bytes its grammar reads stay as they were.
export function splitCarried(rules, version) {
  if (version !== '2' || !rules || typeof rules !== 'object' || Array.isArray(rules)) return { rules, carried: [] }
  const rest = {}
  const carried = []
  for (const [key, rule] of Object.entries(rules)) {
    const codec = codecOf(rule)
    if (codec) carried.push({ key, selector: codec.selector })
    else rest[key] = rule
  }
  return { rules: rest, carried }
}

export function carriedNode(adapter, root, selector) {
  return adapter.find(root, selector)[0] || null
}
