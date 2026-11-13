import { MAX_RULE_DEPTH, RulesParseError, UnknownCodec } from './errors.js'
import { codecOf } from './rule-syntax.js'

// A codec reads and writes one element's whole value as JSON, for content the
// rule grammar cannot describe (a sheet's grid). It is named by the rule form
// "selector@codec(name)", valid only under data-rules-version="2" and only as the
// value of a top level key.
//
// codec = {
//   name,
//   read(adapter, node, ctx)          -> JSON value       ctx = { query?, view?, region? }
//   write(adapter, node, value, ctx)  -> void | { regions }
//   patch?(adapter, node, ops, ctx)   -> { changed, stale, regions }
//   same(written, reread)             -> boolean
//   styles?: string[]
//   cut?(src, marker)                 -> { rest, regions }
// }

const NAME_RE = /^[a-z][a-z0-9-]*$/
const registry = new Map()

// The browser registry. Hosts pass `codecs` per call instead, so no state is
// shared between requests.
export function registerCodec(name, codec) {
  if (typeof name !== 'string' || !NAME_RE.test(name)) {
    throw new Error(`hyper-html-api: invalid codec name ${JSON.stringify(name)} (must match ${NAME_RE})`)
  }
  if (!codec || typeof codec.read !== 'function' || typeof codec.write !== 'function' || typeof codec.same !== 'function') {
    throw new Error(`hyper-html-api: codec "${name}" needs read, write and same functions`)
  }
  registry.set(name, codec)
}

export function getCodec(name) {
  return registry.get(name) ?? null
}

export function registeredCodecs() {
  return Object.fromEntries(registry)
}

export const NEEDS_VERSION_2 = 'The @codec(name) rule form needs a rules tag with data-rules-version="2".'
export const NEEDS_TOP_LEVEL = 'A @codec(name) rule must be the value of a top level key.'

// The codec a rule names, or null for any other rule. Assumes checkCodecRules
// already accepted the tree.
export function codecForRule(rule, opts) {
  const form = codecOf(rule)
  return form ? { ...form, codec: opts.codecs[form.name] } : null
}

// Walks the whole rule tree once, before anything is read or written, so a
// rules tree the call cannot honor refuses without a partial write. A codec
// rule read as a plain attribute would return null for the whole value, and a
// null that reaches a draft store or a guard baseline looks like the owner
// emptied it, which is why every refusal here is loud.
export function checkCodecRules(rules, opts = {}) {
  const version = opts.version ?? '1'
  const codecs = opts.codecs ?? {}
  walk(rules, 0)

  function walk(rule, depth) {
    if (depth > MAX_RULE_DEPTH) return
    if (typeof rule === 'string') {
      const form = codecOf(rule)
      if (!form) return
      if (version !== '2') throw new RulesParseError(NEEDS_VERSION_2)
      if (depth !== 1) throw new RulesParseError(NEEDS_TOP_LEVEL)
      if (!Object.prototype.hasOwnProperty.call(codecs, form.name)) throw new UnknownCodec(form.name)
      return
    }
    if (Array.isArray(rule)) {
      walk(rule[1], depth + 1)
      return
    }
    if (rule && typeof rule === 'object') {
      for (const sub of Object.values(rule)) walk(sub, depth + 1)
    }
  }
}
