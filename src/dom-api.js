import * as engineMod from './engine/index.js'
import domAdapter, { createDomAdapter } from './adapters/dom.js'

// The DOM-bound engine: every engine call pre-wired with the DOM adapter. Lives
// here (instead of inline in hyper-html-api.js) so both the full CDN bundle and
// the lean `data.js` entry share one definition.
// Calls default `codecs` to the ones registered with engine.codecs.register.
const withCodecs = (opts) => ({ codecs: engineMod.registeredCodecs(), ...opts })

export const engine = {
  extract: (root, rules, opts = {}) => engineMod.extract(createDomAdapter(root, opts), root, rules, withCodecs(opts)),
  apply: (root, rules, data, opts = {}) => engineMod.apply(createDomAdapter(root, { ...opts, _write: true }), root, rules, data, withCodecs(opts)),
  findRulesIn: (root, token) => engineMod.findRulesIn(domAdapter, root, token),
  findRules: (root, source) => engineMod.resolveRules(domAdapter, root, source),
  bind: (root, source, opts = {}) => {
    const found = engineMod.resolveRules(domAdapter, root, source)
    if (!found) {
      const what = typeof source === 'string' ? `data-rules-name~="${source}"` : 'the provided rules object'
      throw new Error(`hyper-html-api: could not resolve rules for ${what}`)
    }
    const callOpts = withCodecs({ version: found.version, ...opts })
    return {
      ...found,
      get: () => engineMod.extract(createDomAdapter(root, opts), root, found.rules, callOpts),
      set: data => engineMod.apply(createDomAdapter(root, { ...opts, _write: true }), root, found.rules, data, callOpts),
    }
  },
  codecs: { register: engineMod.registerCodec, get: engineMod.getCodec },
  parseStrict: engineMod.parseStrict,
  parseRelaxed: engineMod.parseRelaxed,
  // Adapter-free, like the parsers above: a consumer that has to split a rule
  // the way the engine does needs this, and reimplementing it is exactly how
  // four copies of the split drifted apart.
  ruleAttrIndex: engineMod.ruleAttrIndex,
  splitRule: engineMod.splitRule,
  errors: engineMod.errors,
  DOM_PROPERTIES: engineMod.DOM_PROPERTIES,
}

const isNode = (x) => !!x && typeof x.nodeType === 'number'

function defaultRules(root) {
  const searchRoot = root && root.ownerDocument ? root.ownerDocument : root
  const found = engineMod.findRulesIn(domAdapter, searchRoot, 'api')
  if (!found) throw new engineMod.errors.NoRulesTag('api')
  return { rules: found.rules, version: found.version }
}

function containingTree(root) {
  if (root.nodeType === 9) return root
  const documentElement = root.ownerDocument?.documentElement
  if (documentElement?.contains(root)) return documentElement
  let tree = root
  while (tree.parentNode) tree = tree.parentNode
  return tree
}

function cloneContainingTree(tree) {
  if (tree.nodeType !== 11 || !tree.host) return tree.cloneNode(true)
  const clone = tree.ownerDocument.createDocumentFragment()
  for (const child of tree.childNodes) clone.appendChild(child.cloneNode(true))
  return clone
}

function childIndexPath(tree, node) {
  const path = []
  while (node !== tree) {
    const parent = node.parentNode
    path.push(Array.prototype.indexOf.call(parent.childNodes, node))
    node = parent
  }
  return path.reverse()
}

function nodeAtPath(tree, path) {
  return path.reduce((node, index) => node.childNodes[index], tree)
}

function matchingNodes(root, selector) {
  const nodes = root.querySelectorAll ? Array.from(root.querySelectorAll(selector)) : []
  if (root.matches?.(selector)) nodes.unshift(root)
  return nodes
}

function copyLiveFormState(source, clone) {
  const sourceOptions = matchingNodes(source, 'option')
  const cloneOptions = matchingNodes(clone, 'option')
  sourceOptions.forEach((node, index) => cloneOptions[index].selected = node.selected)

  const sourceInputs = matchingNodes(source, 'input')
  const cloneInputs = matchingNodes(clone, 'input')
  sourceInputs.forEach((node, index) => {
    const type = node.type.toLowerCase()
    if (type !== 'file') cloneInputs[index].value = node.value
    if (type === 'checkbox' || type === 'radio') cloneInputs[index].checked = node.checked
  })

  const sourceTextareas = matchingNodes(source, 'textarea')
  const cloneTextareas = matchingNodes(clone, 'textarea')
  sourceTextareas.forEach((node, index) => cloneTextareas[index].value = node.value)
}

function assertNoReadOnlyTargets(rule, value) {
  if (value === undefined) return
  if (typeof rule === 'string') {
    if (rule.endsWith('[]')) return
    const at = rule.startsWith('@') ? 0 : engineMod.ruleAttrIndex(rule)
    if (at === -1) return
    const name = rule.slice(at + 1)
    if (engineMod.DOM_PROPERTIES_READ_ONLY_SET.has(name)) {
      throw new engineMod.errors.RuleTargetReadOnly(name)
    }
    return
  }
  if (Array.isArray(rule)) {
    if (!Array.isArray(value)) return
    value.forEach(item => assertNoReadOnlyTargets(rule[1], item))
    return
  }
  if (rule && typeof rule === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, subrule] of Object.entries(rule)) {
      assertNoReadOnlyTargets(subrule, value[key])
    }
  }
}

function guardedApply(root, rules, data, version) {
  const opts = withCodecs({ templateAttr: 'cms-template', version })
  const liveTree = containingTree(root)
  const rootPath = childIndexPath(liveTree, root)
  const detachedTree = cloneContainingTree(liveTree)
  copyLiveFormState(liveTree, detachedTree)
  const detachedRoot = nodeAtPath(detachedTree, rootPath)
  const detachedAdapter = createDomAdapter(detachedTree, {
    ...opts,
    _write: true,
  })
  const plan = engineMod.planWrite(detachedAdapter, detachedRoot, rules, data, opts)
  if (plan.unknownKeys.length || plan.unmatched.length) {
    throw new engineMod.errors.WriteRejected(plan.unknownKeys, plan.unmatched)
  }
  const guarded = engineMod.guardAdapter(detachedAdapter)
  engineMod.apply(guarded, detachedRoot, rules, data, opts)
  guarded.assertClean()
  assertNoReadOnlyTargets(rules, data)
  const liveGuarded = engineMod.guardAdapter(createDomAdapter(liveTree, { ...opts, _write: true }))
  engineMod.apply(liveGuarded, root, rules, data, opts)
  liveGuarded.assertClean()
}

function exposeWriteError(error) {
  if (!(error instanceof Error)) return error
  const keepsCode = error instanceof engineMod.errors.UnknownCodec || error instanceof engineMod.errors.CodecRefused
  const code = keepsCode ? error.code : error.name || 'Error'
  try {
    error.code = code
  } catch {
    Object.defineProperty(error, 'code', { value: code, configurable: true, enumerable: true })
  }
  if (error instanceof engineMod.errors.WriteRefused) {
    error.details = error.refusals
  } else if (error instanceof engineMod.errors.WriteRejected) {
    error.details = {
      unknownKeys: error.unknownKeys,
      unmatched: error.unmatched,
    }
  } else if (error instanceof engineMod.errors.ShapeMismatch) {
    error.details = error.mismatches
  } else if (Array.isArray(error.path)) {
    error.details = { path: error.path }
  } else if (typeof error.target === 'string') {
    error.details = { target: error.target }
  } else if (error.token !== undefined) {
    error.details = { token: error.token }
  } else if (error.version !== undefined) {
    error.details = { version: error.version }
  } else {
    error.details = {}
  }
  return error
}

// extractData()                       → document + api rules tag
// extractData(el)                     → el + api rules tag
// extractData('api' | {title:'h1'})   → document + named/inline rules
// extractData(el, 'api' | {...})      → explicit root + source
// One-shot read; returns the extracted data.
export function extractData(a, b) {
  const root = isNode(a) ? a : document
  const source = isNode(a) ? b : a
  if (source === undefined) {
    const { rules, version } = defaultRules(root)
    return engineMod.extract(createDomAdapter(root), root, rules, withCodecs({ version }))
  }
  return engine.bind(root, source).get()
}

// applyData(root, data, source?) validates the complete write on a detached
// clone, then repeats it against the live nodes so their identities survive.
export function applyData(root, data, source) {
  try {
    if (!isNode(root)) {
      throw new Error('hyper-html-api: applyData(root, data, source?) needs a DOM root as the first argument.')
    }
    const { rules, version } = source === undefined ? defaultRules(root) : engine.bind(root, source)
    guardedApply(root, rules, data, version)
  } catch (error) {
    throw exposeWriteError(error)
  }
  return root
}
