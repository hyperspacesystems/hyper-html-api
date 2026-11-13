import cheerioAdapter from './adapters/cheerio.js'
import { extract } from './engine/extract.js'
import { findRulesIn } from './engine/rules-tag.js'
import { splitRule } from './engine/rule-syntax.js'
import { writeDocument } from './write.js'

export const SITE_KEY = 'site'

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

// The part of `value` that `rule` declares. Keys the rule does not name are
// dropped at every level, because the writer refuses unknown keys and a store
// holds keys other pages use. A key the store does not hold stays absent, and
// the writer skips an absent key, so the page keeps what it has.
export function projectSite(rule, value) {
  if (isPlainObject(rule)) {
    if (!isPlainObject(value)) return value
    const out = {}
    for (const key of Object.keys(rule)) {
      if (value[key] !== undefined) out[key] = projectSite(rule[key], value[key])
    }
    return out
  }
  if (Array.isArray(rule) && Array.isArray(value)) {
    return value.map((item) => projectSite(rule[1], item))
  }
  return value
}

// Writes the store's values into a page through the page's own `site` rule.
// Never throws for a page problem: a key that cannot be written is listed in
// `failed` and the other keys still land. `declared` is false when the page has
// no rules tag or no `site` object in it, and then `html` is `src`.
export function writeSite(load, src, store, options = {}) {
  const { token = 'api' } = options
  const none = { html: src, changed: false, declared: false, applied: [], failed: [] }
  if (!isPlainObject(store)) return none
  let found
  try {
    found = findRulesIn(cheerioAdapter, load(src).root(), token)
  } catch (error) {
    return { ...none, declared: true, failed: [{ key: null, code: error.name, message: error.message }] }
  }
  if (!found || !isPlainObject(found.rules) || !isPlainObject(found.rules[SITE_KEY])) return none
  const data = projectSite(found.rules[SITE_KEY], store)
  const keys = Object.keys(data)
  if (keys.length === 0) return { ...none, declared: true }
  const write = (html, part) => writeDocument(load, html, { [SITE_KEY]: part }, { token, rules: found.rules, version: found.version }).html
  try {
    const html = write(src, data)
    return { html, changed: html !== src, declared: true, applied: keys, failed: [] }
  } catch {
    // One key failed. Write them one at a time so the rest still land.
  }
  let html = src
  const applied = []
  const failed = []
  for (const key of keys) {
    try {
      html = write(html, { [key]: data[key] })
      applied.push(key)
    } catch (error) {
      failed.push({ key, code: error.name, message: error.message })
    }
  }
  return { html, changed: html !== src, declared: true, applied, failed }
}

// The same rule with each attribute read turned into a read of its element's text, which is
// null exactly where the element is missing: a missing element can then be told apart from
// an element without the attribute, which both read as a null attribute.
function presenceRule(rule) {
  if (typeof rule === 'string') {
    const { selector, prop } = splitRule(rule)
    return prop && !prop.endsWith('[]') ? (selector || '.') : rule
  }
  if (Array.isArray(rule)) return rule.length < 2 ? rule : [rule[0], presenceRule(rule[1])]
  if (isPlainObject(rule)) return Object.fromEntries(Object.entries(rule).map(([key, value]) => [key, presenceRule(value)]))
  return rule
}

// The page's own `site` rule and the values the page holds for it right now, read key by
// key: a key whose rule cannot be read (a broken selector) is listed in `broken` and left
// out of `data`, and the other keys still read. `present` mirrors `data` for
// siteValueProblem. Never throws: a page with no rules tag, or no `site` key, declares nothing.
export function readSite(load, src, options = {}) {
  const { token = 'api' } = options
  const none = { declared: false, rule: null, data: {}, present: {}, broken: [] }
  let root
  let found
  try {
    root = load(src).root()
    found = findRulesIn(cheerioAdapter, root, token)
  } catch {
    return none
  }
  if (!found || !isPlainObject(found.rules) || !isPlainObject(found.rules[SITE_KEY])) return none
  const rule = found.rules[SITE_KEY]
  const read = (keyRule, key) => extract(cheerioAdapter, root, { [key]: keyRule }, { templateAttr: 'cms-template' })[key]
  const data = {}
  const present = {}
  const broken = []
  for (const key of Object.keys(rule)) {
    try {
      data[key] = read(rule[key], key)
      present[key] = read(presenceRule(rule[key]), key)
    } catch {
      delete data[key]
      broken.push(key)
    }
  }
  return { declared: true, rule, data, present, broken }
}

// Why a value read from a page must not be written to the store, or null when it may.
// A text rule that matched no element reads null, and an emptied list cannot be regrown
// by writeSite, so both would damage every other page. A null attribute is a real value:
// it means the attribute is absent, unless `present` (readSite's mirror of the value) shows
// that the attribute's element is missing too.
export function siteValueProblem(rule, value, present) {
  if (typeof rule === 'string') {
    if (rule.endsWith('[]')) {
      if (!Array.isArray(value)) return 'unreadable'
      return value.length === 0 ? 'empty-list' : null
    }
    if (value !== null) return null
    return splitRule(rule).prop === null || present === null ? 'unreadable' : null
  }
  if (Array.isArray(rule)) {
    if (!Array.isArray(value)) return 'unreadable'
    if (value.length === 0) return 'empty-list'
    if (rule.length < 2) return null
    for (const [index, row] of value.entries()) {
      const problem = siteValueProblem(rule[1], row, Array.isArray(present) ? present[index] : undefined)
      if (problem) return problem
    }
    return null
  }
  if (isPlainObject(rule)) {
    if (!isPlainObject(value)) return 'unreadable'
    for (const key of Object.keys(rule)) {
      const problem = siteValueProblem(rule[key], value[key], isPlainObject(present) ? present[key] : undefined)
      if (problem) return problem
    }
    return null
  }
  return 'unreadable'
}

// The store's next value for one key after a page edit. An object keeps the fields the
// page's rule does not name, because other pages use them. A list is taken whole from
// the page: rows have no identity to merge by.
export function mergeSiteEdit(rule, stored, edited) {
  if (isPlainObject(rule) && isPlainObject(edited)) {
    const out = isPlainObject(stored) ? { ...stored } : {}
    for (const key of Object.keys(rule)) {
      if (edited[key] !== undefined) out[key] = mergeSiteEdit(rule[key], out[key], edited[key])
    }
    return out
  }
  return edited
}
