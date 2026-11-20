import { codecOf } from './rule-syntax.js'

const isPlain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

function blankFor(rule) {
  if (typeof rule === 'string') {
    if (codecOf(rule)) return undefined
    return rule.endsWith('[]') ? [] : ''
  }
  if (Array.isArray(rule)) return []
  const out = {}
  for (const [key, sub] of Object.entries(rule)) {
    const value = blankFor(sub)
    if (value !== undefined) out[key] = value
  }
  return out
}

function fill(rule, blank, start) {
  if (Array.isArray(rule)) {
    const shape = rule[1]
    if (!Array.isArray(start) || !isPlain(shape)) return start
    const itemBlank = blankFor(shape)
    return start.map((item) => (isPlain(item) ? fill(shape, itemBlank, item) : item))
  }
  if (isPlain(rule) && isPlain(start)) {
    const out = { ...blank }
    for (const key of Object.keys(rule)) {
      if (Object.prototype.hasOwnProperty.call(start, key)) {
        out[key] = fill(rule[key], blank[key], start[key])
      }
    }
    return out
  }
  return start
}

export function blankData(rules, starting) {
  if (!isPlain(rules)) throw new TypeError('blankData: rules must be an object')
  return fill(rules, blankFor(rules), isPlain(starting) ? starting : {})
}
