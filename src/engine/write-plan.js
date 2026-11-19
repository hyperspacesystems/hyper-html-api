import { splitRule } from './rule-syntax.js'
import { checkCodecRules } from './codecs.js'

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function label(path) {
  return path.reduce((out, part) => (typeof part === 'number' ? `${out}[${part}]` : out ? `${out}.${part}` : part), '')
}

// Walks rules against data without touching the document. Reports data keys
// the rules do not define, and scalar rules whose selector matches nothing.
// Shape problems are left to apply(), which already reports them. Inside list
// items only unknown keys are checked, because new rows do not exist yet.
export function planWrite(adapter, root, rules, data, opts = {}) {
  checkCodecRules(rules, opts)
  const unknownKeys = []
  const unmatched = []

  function checkKeys(rule, value, path) {
    if (Array.isArray(rule)) {
      const [, shape] = rule
      if (!Array.isArray(value) || !isPlainObject(shape)) return
      value.forEach((item, i) => checkKeys(shape, item, [...path, i]))
      return
    }
    if (!isPlainObject(rule) || !isPlainObject(value)) return
    for (const key of Object.keys(value)) {
      if (!Object.prototype.hasOwnProperty.call(rule, key)) unknownKeys.push(label([...path, key]))
      else checkKeys(rule[key], value[key], [...path, key])
    }
  }

  function checkTargets(ctx, rule, value, path) {
    if (value === undefined) return
    if (typeof rule === 'string') {
      if (rule.endsWith('[]') || rule === '.' || rule.startsWith('@')) return
      const { selector } = splitRule(rule)
      if (!selector) return
      if (adapter.find(ctx, selector, opts).length === 0) unmatched.push({ path: label(path), selector })
      return
    }
    if (Array.isArray(rule)) return
    if (isPlainObject(rule) && isPlainObject(value)) {
      for (const [key, sub] of Object.entries(rule)) checkTargets(ctx, sub, value[key], [...path, key])
    }
  }

  checkKeys(rules, data, [])
  checkTargets(root, rules, data, [])
  return { unknownKeys, unmatched }
}

// A host answers a write with a top level `__meta__` key (stale, why), and an agent
// may post that object back whole. Unless the rules define `__meta__` as data, the
// key is dropped before anything plans, applies or checks the write.
export function withoutMeta(rules, data) {
  const has = (obj) => Object.prototype.hasOwnProperty.call(Object(obj), '__meta__')
  if (!has(data) || has(rules)) return data
  const { __meta__, ...rest } = data
  return rest
}
