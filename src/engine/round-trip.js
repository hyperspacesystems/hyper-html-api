import {
  DOM_PROPERTIES_SET,
  DOM_PROPERTIES_WRITE_SET,
  coercePropValue,
} from './dom-properties.js'
import { WriteNotRoundTripped } from './errors.js'
import { codecOf, ruleAttrIndex, splitRule } from './rule-syntax.js'
import { isCustomPropertyName } from './style-vars.js'

// Props whose read-side value keeps its whitespace. Every other text rule reads
// trimmed, which is what writeText compares against.
const UNTRIMMED_PROPS = new Set(['textContent', 'innerText'])

// Elements whose content loses one leading LF to the HTML parser: the tokenizer
// drops a newline that immediately follows the start tag.
// Compares what the caller asked for against a fresh extraction of the
// serialized source, so a write that serialized away or never landed throws
// WriteNotRoundTripped instead of returning a false success. Only the supplied
// projection is checked: omitted keys and undefined are skipped exactly as the
// writer skips them, which is what keeps partial updates working.
// A codec value is compared by its codec's own same(), from `codecs`.
export function assertRoundTrip(rules, requested, actual, codecs = {}) {
  check(rules, requested, actual, [], codecs)
}

function check(rule, want, got, path, codecs) {
  if (want === undefined) return
  if (typeof rule === 'string') {
    const form = codecOf(rule)
    if (form) {
      if (!codecs[form.name].same(want, got)) fail(path)
      return
    }
    checkScalarRule(rule, want, got, path)
    return
  }
  if (Array.isArray(rule)) {
    checkList(rule[1], want, got, path, codecs)
    return
  }
  if (typeof rule === 'object' && rule !== null) {
    checkObject(rule, want, got, path, codecs)
  }
}

function checkScalarRule(rule, want, got, path) {
  if (rule.endsWith('[]')) {
    checkTextList(want, got, path)
    return
  }
  if (rule.startsWith('@')) {
    checkPropOrAttr(rule.slice(1), want, got, path)
    return
  }
  const at = ruleAttrIndex(rule)
  if (splitRule(rule).all) {
    if (!Array.isArray(got) || got.length === 0) fail(path)
    for (const one of got) {
      if (at !== -1) checkPropOrAttr(rule.slice(at + 1), want, one, path)
      else checkText(want, one, path)
    }
    return
  }
  if (at !== -1) {
    checkPropOrAttr(rule.slice(at + 1), want, got, path)
    return
  }
  checkText(want, got, path)
}

function checkText(want, got, path) {
  if (textOf(want) !== textOf(got)) fail(path)
}

function checkTextList(want, got, path) {
  if (!Array.isArray(want) || !Array.isArray(got) || want.length !== got.length) fail(path)
  for (let i = 0; i < want.length; i++) checkText(want[i], got[i], [...path, i])
}

function checkObject(rule, want, got, path, codecs) {
  if (!isPlainObject(want) || !isPlainObject(got)) fail(path)
  for (const [key, sub] of Object.entries(rule)) {
    check(sub, want[key], got[key], [...path, key], codecs)
  }
}

function checkList(shape, want, got, path, codecs) {
  if (!Array.isArray(want) || !Array.isArray(got) || want.length !== got.length) fail(path)
  for (let i = 0; i < want.length; i++) check(shape, want[i], got[i], [...path, i], codecs)
}

function checkPropOrAttr(name, want, got, path) {
  if (isCustomPropertyName(name)) {
    if ((want == null ? '' : String(want).trim()) !== (got ?? '')) fail(path)
    return
  }
  if (!DOM_PROPERTIES_SET.has(name)) {
    if (want == null) {
      if (got != null) fail(path)
      return
    }
    if (!sameString(String(want), got)) fail(path)
    return
  }
  if (UNTRIMMED_PROPS.has(name)) {
    if (!sameUntrimmed(String(want ?? ''), got)) fail(path)
    return
  }
  if (DOM_PROPERTIES_WRITE_SET.has(name)) {
    if (got !== String(coercePropValue(name, want))) fail(path)
    return
  }
  if (want == null) {
    if (got != null) fail(path)
    return
  }
  if (!sameString(String(want), got)) fail(path)
}

function textOf(value) {
  return normalizeNewlines(String(value ?? '').trim())
}

// A document normalizes newlines: parsing turns CRLF and a lone CR into LF, so
// a value that differs only by that is the value the source carries.
function normalizeNewlines(value) {
  return value.replace(/\r\n?/g, '\n')
}

function sameString(want, got) {
  return got != null && normalizeNewlines(want) === normalizeNewlines(got)
}

// @textContent compares exactly. The writer serializes the extra newline a
// pre/textarea start tag needs, so a leading newline comes back too.
function sameUntrimmed(want, got) {
  return got != null && normalizeNewlines(want) === normalizeNewlines(got)
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function fail(path) {
  throw new WriteNotRoundTripped(path)
}
