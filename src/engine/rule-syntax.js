// The scalar rule grammar: "<selector>@<prop>", plus a trailing "[]" for a list
// of values, a leading "@" for a prop on the context node, and "." for its text.
//
// Locating the "@" is the only subtle part of it. It is the LAST one, because a
// prop name never contains "@" but a selector often does: a mailto link
// (a[href="mailto:hi@example.com"]), a container query, a Tailwind arbitrary
// variant. Every one of those carries its "@" inside brackets, parens or
// quotes, so a separator is an "@" at bracket depth zero and outside any quote.
// Scanning with a plain lastIndexOf finds the one in the mailto and splits the
// rule into `a[href="mailto:hi` and `example.com"]`, which reads downstream as
// an invalid selector when the rule the author wrote was correct.

import { RulesParseError } from './errors.js'

// Index of the separator "@", or -1 when the rule has no prop part.
export function ruleAttrIndex(rule) {
  let depth = 0
  let quote = null
  let found = -1
  for (let i = 0; i < rule.length; i++) {
    const ch = rule[i]
    if (ch === '\\') {
      i++
    } else if (quote) {
      if (ch === quote) quote = null
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (ch === '[' || ch === '(') {
      depth++
    } else if (ch === ']' || ch === ')') {
      if (depth > 0) depth--
    } else if (ch === '@' && depth === 0) {
      found = i
    }
  }
  return found
}

const ALL = '[*]'

// "<selector>@<prop>" split at that separator. selector is "" for a leading "@"
// (the context node itself); prop is null when the rule names no prop. A selector
// that ends in "[*]" names every match instead of the first: `all` is true and
// the marker is removed, because "[*]" is not CSS and no adapter can run it.
export function splitRule(rule) {
  const at = ruleAttrIndex(rule)
  const head = at === -1 ? rule : rule.slice(0, at)
  const all = head.endsWith(ALL)
  const split = {
    selector: all ? head.slice(0, -ALL.length) : head,
    prop: at === -1 ? null : rule.slice(at + 1) || null,
  }
  if (all) split.all = true
  return split
}

// The list grammar needs a second split: "container > row" says where a row
// goes. Only the FINAL top-level ">" separates them, and a ">" inside brackets,
// parens or quotes is not a combinator at all: a[data-note="a > b"] and
// :is(a > b) both carry one, and splitting there names a container that cannot
// exist. A top-level "," is a group whose members may name different
// containers, so the fallback refuses it rather than guessing one of them.
//
// What follows that ">" also has to be the ONE compound selector it introduces.
// "ul > li span" and "ul > li + li" put the row below that ">", so its left
// side is not the row's parent and cannot stand in as the row's container.
//
// Left side of that final top-level ">", or null when the selector names no
// container for the row.
export function finalChildCombinatorLeft(selector) {
  let depth = 0
  let quote = null
  let found = -1
  let group = false
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i]
    if (ch === '\\') {
      i++
    } else if (quote) {
      if (ch === quote) quote = null
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (ch === '[' || ch === '(') {
      depth++
    } else if (ch === ']' || ch === ')') {
      if (depth > 0) depth--
    } else if (depth === 0 && ch === '>') {
      found = i
    } else if (depth === 0 && ch === ',') {
      group = true
    }
  }
  if (group || found === -1) return null
  if (!isSingleCompound(selector, found + 1)) return null
  return selector.slice(0, found).trim() || null
}

// The text after the ">", ignoring the whitespace that belongs to the
// combinator itself, is a single compound selector when no top-level
// descendant, "+" or "~" follows it. Depth and quotes are tracked the same way
// as above, so whitespace inside a[title="a b"] or :is(a b) is not a
// combinator.
function isSingleCompound(selector, start) {
  let i = start
  const end = selector.replace(/\s+$/, '').length
  while (i < end && /\s/.test(selector[i])) i++
  let depth = 0
  let quote = null
  for (; i < end; i++) {
    const ch = selector[i]
    if (ch === '\\') {
      i++
    } else if (quote) {
      if (ch === quote) quote = null
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (ch === '[' || ch === '(') {
      depth++
    } else if (ch === ']' || ch === ')') {
      if (depth > 0) depth--
    } else if (depth === 0 && (ch === '+' || ch === '~' || /\s/.test(ch))) {
      return false
    }
  }
  return true
}

const CODEC_PROP = /^codec\(([a-z][a-z0-9-]*)\)$/

// { selector, name } when a scalar rule calls a codec, else null.
export function codecOf(rule) {
  if (typeof rule !== 'string') return null
  const at = ruleAttrIndex(rule)
  if (at === -1) return null
  const match = CODEC_PROP.exec(rule.slice(at + 1))
  if (!match) return null
  const { selector, all } = splitRule(rule)
  if (all) throw new RulesParseError('A @codec(name) rule cannot use [*].')
  return { selector, name: match[1] }
}
