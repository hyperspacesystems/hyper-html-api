import cheerioAdapter from './adapters/cheerio.js'
import { apply } from './engine/apply.js'
import { extract } from './engine/extract.js'
import { findRulesIn } from './engine/rules-tag.js'
import { guardAdapter } from './engine/write-policy.js'
import { planWrite } from './engine/write-plan.js'
import { assertRoundTrip } from './engine/round-trip.js'
import { trackAdapter, spliceDocument } from './engine/splice.js'
import { NoRulesTag, RulesParseError, WriteRejected } from './engine/errors.js'

// Applies a JSON body to a document's source through caller-provided rules
// (options.rules) or the document's own rules tag, under the content-only
// policy. `load` is cheerio.load, passed in so this package keeps cheerio out
// of its browser bundles. Returns the new source and whether anything changed.
// Throws NoRulesTag, RulesParseError, WriteRejected, WriteRefused, ShapeMismatch,
// EmptyListInsert or WriteNotRoundTripped, always before producing any output.
export function writeDocument(load, src, data, options = {}) {
  const { token = 'api' } = options
  const $ = load(src, { sourceCodeLocationInfo: true })
  const root = $.root()
  let rules
  if (Object.prototype.hasOwnProperty.call(options, 'rules')) {
    rules = options.rules
    if (rules === null || !['string', 'object'].includes(typeof rules)) {
      throw new RulesParseError('Invalid extraction rules: expected a selector, array, or object.')
    }
  } else {
    const found = findRulesIn(cheerioAdapter, root, token)
    if (!found) throw new NoRulesTag(token)
    rules = found.rules
  }
  const plan = planWrite(cheerioAdapter, root, rules, data)
  if (plan.unknownKeys.length || plan.unmatched.length) throw new WriteRejected(plan.unknownKeys, plan.unmatched)
  const opts = { templateAttr: 'cms-template' }
  const tracker = trackAdapter(cheerioAdapter)
  const guarded = guardAdapter(tracker)
  apply(guarded, root, rules, data, opts)
  guarded.assertClean()
  const { html, spliced } = tracker.dirty.size === 0
    ? { html: src, spliced: true }
    : spliceDocument(load, src, $, tracker)
  // The in-memory tree is not the contract: only the source the caller gets
  // back is. Re-parse it and compare the caller's projection, so a write that
  // serialization dropped throws instead of returning a false success. Only the
  // rules the payload names are re-extracted: a one-field write on a large page
  // pays for the field it wrote, not for every rule in the document.
  const written = writtenRules(rules, data)
  const writtenRoot = load(html).root()
  assertRoundTrip(written, data, extract(cheerioAdapter, writtenRoot, written, { ...opts, allMatches: true }))
  return { html, changed: html !== src, spliced }
}

// The top-level subset of `rules` that the payload names, which is exactly what
// the guard checks: an omitted rule is not part of this write and must not be
// able to fail it. A scalar or list rule already IS the whole projection.
function writtenRules(rules, data) {
  if (!isPlainObject(rules) || !isPlainObject(data)) return rules
  const subset = {}
  for (const key of Object.keys(data)) {
    if (Object.prototype.hasOwnProperty.call(rules, key)) subset[key] = rules[key]
  }
  return subset
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
