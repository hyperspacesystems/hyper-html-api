import { codecOf } from './rule-syntax.js'

// The JSON Schema of the value extractData reads for a rule, so an agent can be
// asked for exactly what the page would write back. extractData reads every
// scalar as a string, a "x[]" rule as a list of strings, and a list rule as a
// list of its row shape. A codec reads its own shape, so it is left open. Every
// object lists all its keys as required and allows no others. `omit` drops keys
// of the top-level object only: the fields the page fills itself.
export function schemaFor(rule, omit = []) {
  if (typeof rule === 'string') {
    if (codecOf(rule)) return {}
    return rule.endsWith('[]') ? { type: 'array', items: { type: 'string' } } : { type: 'string' }
  }
  if (Array.isArray(rule)) return { type: 'array', items: schemaFor(rule[1]) }
  if (rule && typeof rule === 'object') {
    const keys = Object.keys(rule).filter((key) => !omit.includes(key))
    return {
      type: 'object',
      additionalProperties: false,
      required: keys,
      properties: Object.fromEntries(keys.map((key) => [key, schemaFor(rule[key])])),
    }
  }
  throw new TypeError('schemaFor: a rule is a string, a [selector, shape] list or an object')
}
