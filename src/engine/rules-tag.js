import { parseRelaxed } from './rules.js'
import { UnknownRulesVersion } from './errors.js'

export const SUPPORTED_VERSION = '1'
export const SUPPORTED_VERSIONS = ['1', '2']
const TOKEN_RE = /^[a-zA-Z0-9_-]+$/

// findRulesIn(adapter, root)         → first script[data-rules-name] (tooling/no-token)
// findRulesIn(adapter, root, token)  → first script[data-rules-name~="token"]
export function findRulesIn(adapter, root, token) {
  let selector
  if (token === undefined) {
    selector = 'script[data-rules-name]'
  } else {
    // Validate BEFORE interpolating into the selector (rejects, never sanitizes).
    // The charset also forecloses selector injection through the ~= match.
    if (typeof token !== 'string' || !TOKEN_RE.test(token)) {
      throw new Error(`hyper-html-api: invalid rules token ${JSON.stringify(token)} (must match ${TOKEN_RE})`)
    }
    selector = `script[data-rules-name~="${token}"]`
  }

  // includeRulesTag:true is REQUIRED: isRulesTag now matches any data-rules-name
  // script, so without the flag adapter.find would filter out the very tag we select.
  const candidates = adapter.find(root, selector, { includeRulesTag: true })
  if (candidates.length === 0) return null
  if (token !== undefined && candidates.length > 1) {
    console.warn(`hyper-html-api: ${candidates.length} rules tags match data-rules-name~="${token}"; using the first.`)
  }

  const tagNode = candidates[0]
  const version = adapter.attr(tagNode, 'data-rules-version')
  if (!SUPPORTED_VERSIONS.includes(version)) throw new UnknownRulesVersion(version)

  // Script tag bodies accept the same relaxed JSON syntax as the ?data=
  // URL parameter: unquoted keys, single-quoted strings, trailing commas.
  // parseRelaxed tries strict JSON.parse first, so valid JSON keeps
  // parsing identically.
  const rules = parseRelaxed(adapter.text(tagNode))
  return { rules, tagNode, version }
}
