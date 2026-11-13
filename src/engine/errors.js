export class RulesParseError extends Error {
  constructor(message, originalError) {
    super(message)
    this.name = 'RulesParseError'
    this.cause = originalError
  }
}

export class UnknownRulesVersion extends Error {
  constructor(version) {
    super(`unknown rules version: ${version}. Library supports "1" and "2".`)
    this.name = 'UnknownRulesVersion'
    this.version = version
  }
}

export const MAX_RULE_DEPTH = 20

export class MaxRuleDepthExceeded extends Error {
  constructor(path) {
    super(`rule depth exceeded ${MAX_RULE_DEPTH} at path: ${path.join('.')}`)
    this.name = 'MaxRuleDepthExceeded'
    this.path = path
  }
}

export class ShapeMismatch extends Error {
  constructor(mismatches) {
    super(`shape mismatch: ${mismatches.length} field(s) failed validation`)
    this.name = 'ShapeMismatch'
    this.mismatches = mismatches
  }
}

export class EmptyListInsert extends Error {
  constructor(path, reason) {
    super(
      reason
        ? `cannot add items to empty list at "${path.join('.')}" — ${reason}`
        : `cannot add items to empty list at "${path.join('.')}" — no sibling to clone as template. Seed the list with a hidden item first.`,
    )
    this.name = 'EmptyListInsert'
    this.path = path
  }
}

export class RuleTargetReadOnly extends Error {
  constructor(name) {
    super(`cannot write to read-only DOM property "${name}"`)
    this.name = 'RuleTargetReadOnly'
    this.target = name
  }
}

export class WriteRefused extends Error {
  constructor(refusals) {
    super(`write refused: ${refusals.length} write(s) broke the content-only policy`)
    this.name = 'WriteRefused'
    this.refusals = refusals
  }
}

function pathLabel(path) {
  const label = path.reduce(
    (out, part) => (typeof part === 'number' ? `${out}[${part}]` : out ? `${out}.${part}` : String(part)),
    '',
  )
  return label || '(root)'
}

export class WriteNotRoundTripped extends Error {
  constructor(path) {
    super(`write did not round-trip at "${pathLabel(path)}"`)
    this.name = 'WriteNotRoundTripped'
    this.path = path
  }
}

export class NoRulesTag extends Error {
  constructor(token) {
    super(`no <script data-rules-name~="${token}"> rules tag in this document`)
    this.name = 'NoRulesTag'
    this.token = token
  }
}

export class WriteRejected extends Error {
  constructor(unknownKeys, unmatched) {
    super(`write rejected: ${unknownKeys.length} unknown key(s), ${unmatched.length} rule(s) with no matching element`)
    this.name = 'WriteRejected'
    this.unknownKeys = unknownKeys
    this.unmatched = unmatched
  }
}

export class UnknownCodec extends Error {
  constructor(name) {
    super(`unknown codec "${name}": no codec by that name is given to this call`)
    this.name = 'UnknownCodec'
    this.code = 'unknown-codec'
    this.codec = name
  }
}

// Thrown by a codec that will not take a write, with its own code (for
// example "sheet-not-canonical"). A client error, like UnknownCodec.
export class CodecRefused extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'CodecRefused'
    this.code = code
  }
}
