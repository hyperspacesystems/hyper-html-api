import cheerioAdapter from './adapters/cheerio.js'
import { findRulesIn } from './engine/rules-tag.js'
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
  const write = (html, part) => writeDocument(load, html, { [SITE_KEY]: part }, { token, rules: found.rules }).html
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
