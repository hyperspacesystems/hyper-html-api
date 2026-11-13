import { parseRelaxed } from '../engine/rules.js'
import { SUPPORTED_VERSIONS } from '../engine/rules-tag.js'
import { UnknownRulesVersion } from '../engine/errors.js'

const RULES_SELECTOR = 'script[data-rules-name]'

export function normalizeName(raw) {
  return typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : ''
}

/**
 * Collect every rules tag under `root` as [{ name, rules, version }], keyed by the
 * whitespace-normalized data-rules-name attribute value. Duplicate names:
 * first tag wins with a warning (mirrors findRulesIn). Unsupported
 * data-rules-version throws so engine-format skew fails loudly instead of
 * corrupting a migration.
 */
export function collectRulesTags(adapter, root) {
  const tags = adapter.find(root, RULES_SELECTOR, { includeRulesTag: true })
  const seen = new Set()
  const out = []
  for (const tag of tags) {
    const name = normalizeName(adapter.attr(tag, 'data-rules-name'))
    if (!name) continue
    if (seen.has(name)) {
      console.warn(
        `hyper-html-api: duplicate rules tag name "${name}"; using the first.`,
      )
      continue
    }
    const version = adapter.attr(tag, 'data-rules-version')
    if (!SUPPORTED_VERSIONS.includes(version)) throw new UnknownRulesVersion(version)
    seen.add(name)
    out.push({ name, rules: parseRelaxed(adapter.text(tag)), version })
  }
  return out
}
