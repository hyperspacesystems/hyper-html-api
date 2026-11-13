import {
  DOM_PROPERTIES_WRITE_SET,
  DOM_PROPERTIES_READ_ONLY_SET,
  coercePropValue,
} from './dom-properties.js'
import {
  MaxRuleDepthExceeded,
  MAX_RULE_DEPTH,
  RuleTargetReadOnly,
  ShapeMismatch,
} from './errors.js'
import { listDiff } from './diff.js'
import { codecOf, ruleAttrIndex, splitRule } from './rule-syntax.js'
import { isCustomPropertyName, setStyleVar } from './style-vars.js'
import { checkCodecRules, codecForRule } from './codecs.js'

export function apply(adapter, root, rules, data, opts = {}) {
  if (Object.prototype.hasOwnProperty.call(opts, 'exclude') && adapter.semanticExclude === false) {
    throw new Error('This adapter does not support semantic exclude queries; omit exclude or use the DOM adapter.')
  }
  checkCodecRules(rules, opts)
  const mismatches = []
  validateShape(rules, data, [], mismatches)
  if (mismatches.length) throw new ShapeMismatch(mismatches)

  applyAt(adapter, root, rules, data, { depth: 0, path: [] }, opts)
}

// applyAt returns the (possibly new) ctx node. Most rules don't change
// ctx, but writes targeting `@outerHTML` on ctx itself replace the node;
// downstream code (object-rule sub-walks, listDiff) needs to refresh its
// pointer from the return value.
export function applyAt(adapter, ctx, rule, value, trace, opts = {}) {
  if (trace.depth > MAX_RULE_DEPTH) throw new MaxRuleDepthExceeded(trace.path)
  if (value === undefined) return ctx

  if (typeof rule === 'string') return applyScalar(adapter, ctx, rule, value, trace, opts)

  if (Array.isArray(rule)) {
    const [selector, shape] = rule
    listDiff(adapter, ctx, selector, shape, value, trace, applyAt, opts)
    return ctx
  }

  if (typeof rule === 'object' && rule !== null) {
    for (const [key, sub] of Object.entries(rule)) {
      const newCtx = applyAt(
        adapter,
        ctx,
        sub,
        value == null ? value : value[key],
        { depth: trace.depth + 1, path: [...trace.path, key] },
        opts,
      )
      if (newCtx && newCtx !== ctx) ctx = newCtx
    }
    return ctx
  }
  return ctx
}

function applyScalar(adapter, ctx, rule, value, trace, opts) {
  if (rule.endsWith('[]')) {
    const selector = rule.slice(0, -2)
    listDiff(adapter, ctx, selector, null, value, trace, applyAt, opts)
    return ctx
  }

  const codec = codecForRule(rule, opts)
  if (codec) {
    const matches = codec.selector ? adapter.find(ctx, codec.selector, opts) : [ctx]
    if (matches.length) codec.codec.write(adapter, matches[0], value, { query: opts.query })
    return ctx
  }

  if (rule.startsWith('@')) {
    return writePropOrAttr(adapter, ctx, rule.slice(1), value)
  }

  const at = ruleAttrIndex(rule)
  if (at !== -1) {
    const { selector, all } = splitRule(rule)
    const name = rule.slice(at + 1)
    const matches = selector ? adapter.find(ctx, selector, opts) : [ctx]
    for (const node of all ? matches : matches.slice(0, 1)) writePropOrAttr(adapter, node, name, value)
    return ctx
  }

  if (rule === '.') {
    writeText(adapter, ctx, value)
    return ctx
  }

  const { selector, all } = splitRule(rule)
  const matches = adapter.find(ctx, selector, opts)
  for (const node of all ? matches : matches.slice(0, 1)) writeText(adapter, node, value)
  return ctx
}

// Writing identical text still replaces the text node, so an apply of unchanged
// data emitted a childList record for every text rule on the page. The CMS
// re-applies the whole page on each keystroke, so those records reached the undo
// observer and live sync on every one. Scalar lists already compared before
// writing (see writeItems); this is the same comparison for every other text
// rule. adapter.text reads trimmed, so surrounding whitespace alone no longer
// counts as a change, which is exactly what writeItems has always done.
function writeText(adapter, node, value) {
  const target = value == null ? '' : String(value)
  if (adapter.text(node) !== target) adapter.text(node, target)
}

// One custom property in the style attribute. A guarded adapter takes it
// through styleVar(), so its policy sees the property name and the value,
// never a whole style string it would have to diff.
function writeCustomProperty(adapter, node, name, want) {
  if (adapter.styleVar) {
    adapter.styleVar(node, name, want)
    return
  }
  setStyleVar(adapter, node, name, want)
}

// Returns the (possibly new) node. For outerHTML, the original is detached
// and a freshly parsed element takes its place; that new node is returned.
// For every other write, returns the original node unchanged.
function writePropOrAttr(adapter, node, name, value) {
  if (isCustomPropertyName(name)) {
    writeCustomProperty(adapter, node, name, value == null ? '' : String(value).trim())
    return node
  }
  if (DOM_PROPERTIES_READ_ONLY_SET.has(name)) {
    const current = adapter.prop(node, name)
    if (current === value || (current != null && value != null && String(current) === String(value))) return node
    throw new RuleTargetReadOnly(name)
  }
  if (name === 'outerHTML') {
    const html = value == null ? '' : String(value)
    return adapter.replaceWith(node, html)
  }
  // Compare before writing, exactly as writeText does. A property write of an
  // identical value is not a no-op: assigning innerHTML destroys and rebuilds
  // every child, and setting an attribute to the value it already has still
  // emits a mutation record. The CMS re-applies the whole page on each
  // keystroke, so without this every rich-text region on the page was torn
  // down per keystroke (losing the caret, restarting an embedded video or
  // iframe) and every attribute rule emitted a record to undo and live sync.
  if (DOM_PROPERTIES_WRITE_SET.has(name)) {
    const next = coercePropValue(name, value)
    if (adapter.prop(node, name) !== next) adapter.prop(node, name, next)
    return node
  }
  if (value == null) {
    if (adapter.attr(node, name) != null) adapter.removeAttr(node, name)
  } else {
    const next = String(value)
    if (adapter.attr(node, name) !== next) adapter.attr(node, name, next)
  }
  return node
}

function validateShape(rule, value, path, mismatches) {
  // undefined = key omitted by caller; treat as "skip this rule entirely".
  // null / '' are valid for scalar rules (clears the value), but NOT for
  // list or object rules — those mismatch explicitly.
  if (value === undefined) return

  if (typeof rule === 'string') {
    // A codec judges its own value when it writes.
    if (codecOf(rule)) return
    if (rule.endsWith('[]')) {
      if (!Array.isArray(value)) {
        mismatches.push({ path: pathStr(path), expected: 'array', got: typeofX(value) })
      } else {
        value.forEach((v, i) => {
          if (typeof v === 'object' && v !== null) {
            mismatches.push({
              path: pathStr([...path, i]),
              expected: 'scalar',
              got: typeofX(v),
            })
          }
        })
      }
      return
    }
    // Scalar rule. null / '' are valid (clears text/attribute). Reject
    // only nested objects/arrays.
    if (value !== null && typeof value === 'object') {
      mismatches.push({ path: pathStr(path), expected: 'scalar', got: typeofX(value) })
    }
    return
  }

  if (Array.isArray(rule)) {
    if (!Array.isArray(value)) {
      mismatches.push({ path: pathStr(path), expected: 'array', got: typeofX(value) })
      return
    }
    const shape = rule[1]
    value.forEach((item, i) => validateShape(shape, item, [...path, i], mismatches))
    return
  }

  if (typeof rule === 'object' && rule !== null) {
    if (value === null || Array.isArray(value) || typeof value !== 'object') {
      mismatches.push({ path: pathStr(path), expected: 'object', got: typeofX(value) })
      return
    }
    for (const [k, sub] of Object.entries(rule)) {
      validateShape(sub, value[k], [...path, k], mismatches)
    }
  }
}

function typeofX(v) {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  return typeof v
}

function pathStr(path) {
  return path.join('.')
}
