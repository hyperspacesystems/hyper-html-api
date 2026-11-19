import { capabilitySelector } from '../lib/region-capabilities.js'

const NO_DATA = capabilitySelector('data')
const NO_DATA_TOKENS = ['no-data', 'editor-ui']

function isElement(node) {
  const t = node && node[0] && node[0].type
  return t === 'tag' || t === 'script' || t === 'style'
}

// The same test as the NO_DATA selector, without running css-select once per sibling:
// children() and insertAt() call it for every row of a list, and .is() made list writes quadratic
// with a large constant.
export function isNoDataEl(el) {
  const attribs = el && el.attribs
  if (!attribs) return false
  if (NO_DATA_TOKENS.some((t) => Object.prototype.hasOwnProperty.call(attribs, t))) return true
  const clay = attribs.clay
  return typeof clay === 'string' && clay.split(/[\t\n\f\r ]+/).some((t) => NO_DATA_TOKENS.includes(t))
}

function isNoData(node) {
  return isElement(node) && isNoDataEl(node[0])
}

function hasNoData(node) {
  return !!node && node.length > 0 && isElement(node) && (node.is(NO_DATA) || node.find(NO_DATA).length > 0)
}

function inNoData(node) {
  return !!node && !!node.closest && node.closest(NO_DATA).length > 0
}

function projectedClone(node) {
  const copy = node.clone()
  copy.find(NO_DATA).remove()
  return copy
}

function escapeText(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Mirrors dom.js replaceProjectedContent: remove only the children that are
// not no-data, then insert the new content where the first removed child was,
// so no-data children stay where they are.
function replaceProjected(node, html) {
  const contents = node.contents()
  const all = []
  for (let i = 0; i < contents.length; i++) all.push(contents.eq(i))
  const included = all.filter((k) => !isNoData(k))
  const includedSet = new Set(included.map((k) => k[0]))
  let anchorIdx = included.length ? all.findIndex((k) => k[0] === included[0][0]) : -1
  while (anchorIdx !== -1 && anchorIdx < all.length && includedSet.has(all[anchorIdx][0])) anchorIdx++
  const anchor = anchorIdx === -1 || anchorIdx >= all.length ? null : all[anchorIdx]
  for (const k of included) k.remove()
  if (html === '') return
  if (anchor) anchor.before(html)
  else node.append(html)
}

function isRulesTag(node) {
  if (!node || !node.attr) return false
  const tag = node.prop ? node.prop('tagName') : ''
  if (String(tag || '').toUpperCase() !== 'SCRIPT') return false
  return node.attr('data-rules-name') !== undefined
}

function toWrappers(cheerioSet) {
  const out = []
  for (let i = 0; i < cheerioSet.length; i++) out.push(cheerioSet.eq(i))
  return out
}

const cheerioAdapter = {
  semanticExclude: false,
  find(ctx, selector, opts = {}) {
    if (Object.prototype.hasOwnProperty.call(opts, 'exclude')) {
      throw new Error('Cheerio does not support semantic exclude queries; omit exclude or use the DOM adapter.')
    }
    if (!ctx || !ctx.find) return []
    let matches = toWrappers(ctx.find(selector))
    if (!opts.includeRulesTag) matches = matches.filter((n) => !isRulesTag(n))
    matches = matches.filter((n) => !inNoData(n))
    const skipParts = []
    if (opts.skip) skipParts.push(opts.skip)
    // The cms-template seed marker means "not data" for EVERY consumer, so skip
    // it by DEFAULT (not just when a caller opts in). Pass templateAttr:null to
    // include seed elements — used by the grow-from-zero fallback lookup, which
    // must still see the seed to clone it.
    const tplAttr = opts.templateAttr === null ? null : (opts.templateAttr || 'cms-template')
    if (tplAttr) skipParts.push('[' + tplAttr + ']')
    if (skipParts.length) {
      const combined = skipParts.join(', ')
      matches = matches.filter((n) => !n.closest || n.closest(combined).length === 0)
    }
    return matches
  },

  parent(node) {
    if (!node || !node.parent) return null
    const p = node.parent()
    return p && p.length ? p : null
  },

  matches(node, selector) {
    return !!node && node.length > 0 && isElement(node) && node.is(selector)
  },

  children(node) {
    if (!node || !node.children) return []
    const kids = node.children()
    const out = []
    for (let i = 0; i < kids.length; i++) {
      if (!isNoDataEl(kids[i])) out.push(kids.eq(i))
    }
    return out
  },

  text(node, value) {
    if (value === undefined) {
      if (!hasNoData(node)) return node.text().trim()
      if (isNoData(node)) return ''
      return projectedClone(node).text().trim()
    }
    if (!hasNoData(node)) {
      node.text(value)
      return
    }
    replaceProjected(node, escapeText(value))
  },

  attrNames(node) {
    const attribs = node && node[0] && node[0].attribs
    return attribs ? Object.keys(attribs) : []
  },

  attr(node, name, value) {
    if (value === undefined) {
      // Read the raw attribs map rather than .attr(): cheerio's getter returns
      // the attribute NAME for HTML boolean attributes (hidden, open, required,
      // multiple, autofocus...), which is not what the DOM adapter reports.
      const attribs = node[0] && node[0].attribs
      if (!attribs || !Object.prototype.hasOwnProperty.call(attribs, name)) return null
      return attribs[name]
    }
    node.attr(name, value)
  },

  removeAttr(node, name) {
    if (node) node.removeAttr(name)
  },

  prop(node, name, value) {
    if (value === undefined) {
      // Cheerio's .prop() doesn't expose innerHTML/textContent/className as
      // proper properties. Route reads through the matching cheerio API so
      // they're symmetric with the writes below (and with the DOM adapter).
      if (name === 'innerHTML') {
        if (!hasNoData(node)) return node.html()
        return isNoData(node) ? '' : projectedClone(node).html()
      }
      if (name === 'textContent' || name === 'innerText') {
        if (!hasNoData(node)) return node.text()
        return isNoData(node) ? '' : projectedClone(node).text()
      }
      if (name === 'className') {
        const v = node.attr('class')
        return v !== undefined ? v : null
      }
      if (name === 'type') {
        const v = node.attr('type')
        return v !== undefined ? v : null
      }
      const v = node.prop(name)
      return v !== undefined ? v : null
    }
    // Cheerio's .prop() setter writes a literal attribute named `name`; it
    // does NOT mutate the underlying property (cheerio has no live DOM).
    // For names that have semantic write meaning, route through the right
    // cheerio API instead.
    const v = value == null ? '' : String(value)
    if (name === 'innerHTML') return hasNoData(node) ? replaceProjected(node, v) : node.html(v)
    if (name === 'textContent' || name === 'innerText') return hasNoData(node) ? replaceProjected(node, escapeText(v)) : node.text(v)
    if (name === 'className') return node.attr('class', v)
    if (name === 'type') return node.attr('type', v)
    node.prop(name, value)
  },

  replaceWith(node, html) {
    // Capture the parent + index before detaching, then reparse the html
    // and replace. Returns a fresh cheerio wrapper around the new node so
    // callers can keep operating on it.
    const parent = node.parent()
    if (!parent || !parent.length) {
      // Detached node — nothing meaningful we can do. Mirror DOM throwing.
      throw new Error('cheerio.replaceWith: node has no parent')
    }
    const idx = parent.children().index(node[0])
    node.replaceWith(html)
    return parent.children().eq(idx)
  },

  clone(node) {
    return hasNoData(node) ? projectedClone(node) : node.clone()
  },

  insertAt(parent, node, index) {
    const siblings = parent.children()
    const all = toWrappers(siblings)
    const content = all.filter((k) => !isNoDataEl(k[0]))
    if (content.length === all.length) {
      if (index >= siblings.length) parent.append(node)
      else siblings.eq(index).before(node)
      return
    }
    if (index < content.length) content[index].before(node)
    else if (content.length) content[content.length - 1].after(node)
    else if (all.length) all[0].before(node)
    else parent.append(node)
  },

  insertBefore(ref, node) {
    ref.before(node)
  },

  insertAfter(ref, node) {
    ref.after(node)
  },

  identity(node) {
    return node && node[0] ? node[0] : null
  },

  remove(node) {
    if (node) node.remove()
  },

  stripIds(node) {
    let count = 0
    if (node.attr('id')) {
      node.removeAttr('id')
      count++
    }
    node.find('[id]').each(function () {
      if (this.attribs && this.attribs.id !== undefined) {
        delete this.attribs.id
        count++
      }
    })
    return count
  },

  sameNode(a, b) {
    if (!a || !b) return false
    const aEl = a[0]
    const bEl = b[0]
    return !!aEl && aEl === bEl
  },
}

export default cheerioAdapter
