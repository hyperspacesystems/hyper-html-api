import { extract } from './extract.js'
import { apply } from './apply.js'
import { findRulesIn } from './rules-tag.js'

export { extract } from './extract.js'
export { apply } from './apply.js'
export { findRulesIn } from './rules-tag.js'
export { parseStrict, parseRelaxed } from './rules.js'
export { ruleAttrIndex, splitRule, codecOf } from './rule-syntax.js'
export { registerCodec, getCodec, registeredCodecs, checkCodecRules } from './codecs.js'
export { SUPPORTED_VERSION, SUPPORTED_VERSIONS } from './rules-tag.js'
export * as errors from './errors.js'
export { DOM_PROPERTIES, DOM_PROPERTIES_SET, DOM_PROPERTIES_READ_ONLY_SET } from './dom-properties.js'
export { WRITE_POLICY, guardAdapter, checkAttribute, checkCustomPropertyValue, urlScheme } from './write-policy.js'
export { planWrite } from './write-plan.js'
export { isCustomPropertyName, readStyleVar, writeStyleVar } from './style-vars.js'
export { assertRoundTrip } from './round-trip.js'
export { trackAdapter, spliceDocument } from './splice.js'

// source: object literal → use as-is (no tag); string → look up by token.
// For an element root, search the whole document (root.ownerDocument) so a
// head-mounted tag is found; get/set still scope to the passed root.
// For a Document root or the cheerio $.root(), ownerDocument is absent → no-op.
export function resolveRules(adapter, root, source) {
  if (source && typeof source === 'object') {
    return { rules: source, tagNode: null, version: '1' }
  }
  if (typeof source === 'string') {
    const searchRoot = (root && root.ownerDocument) ? root.ownerDocument : root
    return findRulesIn(adapter, searchRoot, source)
  }
  return null
}

export function bind(adapter, root, source, opts) {
  const found = resolveRules(adapter, root, source)
  if (!found) {
    const what = typeof source === 'string' ? `data-rules-name~="${source}"` : 'the provided rules object'
    throw new Error(`hyper-html-api: could not resolve rules for ${what}`)
  }
  const { rules, tagNode, version } = found
  const callOpts = { version, ...opts }
  return {
    rules,
    tagNode,                                                // informational only; null for a literal object
    version,
    get: () => extract(adapter, root, rules, callOpts),     // opts (skip/templateAttr/codecs) forwarded
    set: (data) => apply(adapter, root, rules, data, callOpts),
  }
}
