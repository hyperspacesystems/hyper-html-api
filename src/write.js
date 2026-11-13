import cheerioAdapter from './adapters/cheerio.js'
import { apply } from './engine/apply.js'
import { extract } from './engine/extract.js'
import { findRulesIn } from './engine/rules-tag.js'
import { guardAdapter } from './engine/write-policy.js'
import { planWrite } from './engine/write-plan.js'
import { assertRoundTrip } from './engine/round-trip.js'
import { trackAdapter, spliceDocument } from './engine/splice.js'
import { NoRulesTag, RulesParseError, WriteRejected } from './engine/errors.js'
import { sheet } from './codecs/sheet.js'
import { codecOf } from './engine/rule-syntax.js'

// Applies a JSON body to a document's source through caller-provided rules
// (options.rules) or the document's own rules tag, under the content-only
// policy. `load` is cheerio.load, passed in so this package keeps cheerio out
// of its browser bundles. Returns the new source and whether anything changed.
// Throws NoRulesTag, RulesParseError, WriteRejected, WriteRefused, ShapeMismatch,
// EmptyListInsert, UnknownCodec or WriteNotRoundTripped, always before producing
// any output. options.codecs maps a name to a codec for `@codec(name)` rules,
// which only a version 2 rules tag may use (default: the sheet codec).
export function writeDocument(load, src, data, options = {}) {
  const { token = 'api', codecs = { sheet } } = options
  const $ = load(src, { sourceCodeLocationInfo: true })
  const root = $.root()
  let rules
  let version = '1'
  if (Object.prototype.hasOwnProperty.call(options, 'rules')) {
    rules = options.rules
    if (rules === null || !['string', 'object'].includes(typeof rules)) {
      throw new RulesParseError('Invalid extraction rules: expected a selector, array, or object.')
    }
  } else {
    const found = findRulesIn(cheerioAdapter, root, token)
    if (!found) throw new NoRulesTag(token)
    rules = found.rules
    version = found.version
  }
  const plan = planWrite(cheerioAdapter, root, rules, data, { version, codecs })
  if (plan.unknownKeys.length || plan.unmatched.length) throw new WriteRejected(plan.unknownKeys, plan.unmatched)
  const opts = { templateAttr: 'cms-template', version, codecs }
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
  assertRoundTrip(written, data, extract(cheerioAdapter, writtenRoot, written, { ...opts, allMatches: true }), codecs)
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

export { patchDocument, NOT_CANONICAL_MESSAGE } from './patch-document.js'

// The one rule every host uses to tell a patch body from a data write: an
// object whose `patch` value is an array and whose only other key is
// `operationId`, sent to a document whose rules have no top level key named
// `patch`. Anything else is a data write, exactly as before patches existed.
export function isPatchBody(body, rules) {
  if (!isPlainObject(body) || !Array.isArray(body.patch)) return false
  if (Object.keys(body).some((key) => key !== 'patch' && key !== 'operationId')) return false
  return !(isPlainObject(rules) && Object.prototype.hasOwnProperty.call(rules, 'patch'))
}

// Rows in a write body, for a host's size limit: every array item counts, at
// any depth. Under a version 2 rules tag a top level key whose rule is a
// `@codec(name)` rule is skipped, because its value is not a list of rows (a
// sheet's size is its cells, and hosts limit those per patch).
export function countRows(value, rules, version = '1') {
  if (version === '2' && isPlainObject(value) && isPlainObject(rules)) {
    let sum = 0
    for (const [key, item] of Object.entries(value)) {
      if (!codecOf(rules[key])) sum += countAll(item)
    }
    return sum
  }
  return countAll(value)
}

function countAll(value) {
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + 1 + countAll(item), 0)
  if (value !== null && typeof value === 'object') return Object.values(value).reduce((sum, item) => sum + countAll(item), 0)
  return 0
}
