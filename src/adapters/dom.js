import { createContentView } from '../lib/content-dom.js'
import { capabilitySelector } from '../lib/region-capabilities.js'

function isRulesTag(node) {
  return node && node.nodeType === 1 && node.tagName === 'SCRIPT'
    && node.hasAttribute && node.hasAttribute('data-rules-name')
}

function resolveSearchRoot(ctx) {
  if (!ctx) return null
  if (ctx.nodeType === 9) return ctx
  if (ctx.nodeType === 11) return ctx
  return ctx
}

function mirrorLiveState(node, name, value) {
  if (!node || node.nodeType !== 1) return
  if (name === 'value' && node.tagName === 'INPUT') node.value = value === null ? '' : value
  else if (name === 'checked' && node.tagName === 'INPUT') node.checked = value !== null
  else if (name === 'selected' && node.tagName === 'OPTION') node.selected = value !== null
}

function syncTextareaValue(node, value) {
  if (node && node.tagName === 'TEXTAREA') node.value = value
}

function resetFormState(node) {
  if (!node || node.nodeType !== 1) return
  const controls = [node, ...(node.querySelectorAll ? node.querySelectorAll('textarea, input, option') : [])]
  for (const control of controls) {
    if (control.tagName === 'TEXTAREA') {
      control.value = control.defaultValue
    } else if (control.tagName === 'INPUT') {
      const type = control.type
      // A checkbox or radio has no value content attribute by default, and
      // assigning one writes the attribute: the clone would carry value="".
      if (type !== 'file' && type !== 'checkbox' && type !== 'radio') control.value = control.defaultValue
      control.checked = control.defaultChecked
    } else if (control.tagName === 'OPTION') {
      control.selected = control.defaultSelected
    }
  }
}

const dom = {
  semanticExclude: true,
  find(ctx, selector, opts = {}) {
    const root = resolveSearchRoot(ctx)
    if (!root || !root.querySelectorAll) return []
    let all = Array.from(root.querySelectorAll(selector))
    if (!opts.includeRulesTag) all = all.filter((n) => !isRulesTag(n))
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
      all = all.filter((n) => !n.closest || !n.closest(combined))
    }
    return all
  },

  parent(node) {
    return node ? node.parentElement : null
  },

  children(node) {
    return node ? Array.from(node.children) : []
  },

  matches(node, selector) {
    return !!(node && node.matches) && node.matches(selector)
  },

  text(node, value) {
    if (value === undefined) return (node.textContent || '').trim()
    node.textContent = value
    syncTextareaValue(node, value)
  },

  attrNames(node) {
    return node && node.getAttributeNames ? node.getAttributeNames() : []
  },

  attr(node, name, value) {
    if (value === undefined) {
      return node.hasAttribute && node.hasAttribute(name) ? node.getAttribute(name) : null
    }
    node.setAttribute(name, value)
    mirrorLiveState(node, name, value)
  },

  removeAttr(node, name) {
    if (node && node.removeAttribute) node.removeAttribute(name)
    mirrorLiveState(node, name, null)
  },

  prop(node, name, value) {
    if (value === undefined) {
      const v = node ? node[name] : undefined
      return v !== undefined ? v : null
    }
    node[name] = value
  },

  clone(node) {
    const copy = node.cloneNode(true)
    resetFormState(copy)
    return copy
  },

  insertAt(parent, node, index) {
    const ref = parent.children[index] || null
    parent.insertBefore(node, ref)
  },

  insertBefore(ref, node) {
    ref.parentNode.insertBefore(node, ref)
  },

  insertAfter(ref, node) {
    ref.parentNode.insertBefore(node, ref.nextSibling)
  },

  identity(node) {
    return node || null
  },

  remove(node) {
    if (node && node.parentNode) node.parentNode.removeChild(node)
  },

  replaceWith(node, html) {
    if (!node || !node.parentNode) {
      throw new Error('dom.replaceWith: node has no parent')
    }
    const doc = node.ownerDocument
    const template = doc.createElement('template')
    template.innerHTML = html
    const newNode = template.content.firstElementChild
    if (!newNode) {
      throw new Error('dom.replaceWith: html did not parse to an element')
    }
    node.parentNode.replaceChild(newNode, node)
    return newNode
  },

  stripIds(node) {
    let count = 0
    if (node.id) {
      node.removeAttribute('id')
      count++
    }
    const inner = node.querySelectorAll ? node.querySelectorAll('[id]') : []
    inner.forEach((el) => {
      el.removeAttribute('id')
      count++
    })
    return count
  },

  sameNode(a, b) {
    return a === b
  },
}

export function createDomAdapter(operationRoot, opts = {}) {
  if (opts.exclude === null) return dom
  const semanticSelector = [capabilitySelector('data'), opts.exclude].filter(Boolean).join(', ')
  const searchContext = operationRoot.nodeType === 9 ? operationRoot : (operationRoot.ownerDocument || operationRoot)
  const rootElement = operationRoot.nodeType === 9 ? operationRoot.documentElement : operationRoot
  if (!opts._write && !rootElement?.matches?.(semanticSelector) && !rootElement?.querySelector?.(semanticSelector) &&
      !searchContext?.querySelector?.(semanticSelector)) return dom
  const ownerContext = operationRoot.nodeType === 9 || !operationRoot.isConnected
    ? operationRoot
    : operationRoot.ownerDocument
  const outputDocument = operationRoot.nodeType === 9 ? operationRoot : operationRoot.ownerDocument
  let view = null
  const contentView = () => view || (view = createContentView(ownerContext, { capability: 'data', exclude: opts.exclude || null }))
  const projected = node => {
    const current = contentView()
    return node === operationRoot ? current.cloneOf(operationRoot) : (current.cloneOf(node) || node)
  }
  const live = node => view?.original(node) || node
  const mapParallel = (liveNode, cloneNode) => {
    contentView().liveToClone.set(liveNode, cloneNode)
    contentView().cloneToLive.set(cloneNode, liveNode)
    const liveKids = liveNode.childNodes || []
    const cloneKids = cloneNode.childNodes || []
    for (let i = 0; i < Math.min(liveKids.length, cloneKids.length); i++) mapParallel(liveKids[i], cloneKids[i])
  }
  const replaceProjectedContent = (target, copy, name, value) => {
    const included = Array.from(target.childNodes).filter(node => view.cloneOf(node))
    const first = included[0]
    let anchor = first
    while (anchor && included.includes(anchor)) anchor = anchor.nextSibling
    for (const node of included) node.remove()
    if (name === 'innerHTML') {
      const template = outputDocument.createElement('template')
      template.innerHTML = value
      for (const child of Array.from(template.content.childNodes)) target.insertBefore(child, anchor || null)
    } else {
      target.insertBefore(outputDocument.createTextNode(value), anchor || null)
      syncTextareaValue(target, value)
    }
    const filteredView = createContentView(target, { capability: 'data', exclude: opts.exclude || null })
    copy.replaceChildren(...Array.from(filteredView.root?.childNodes || []))
    const mapFiltered = cloneNode => {
      const liveNode = filteredView.original(cloneNode)
      if (liveNode) {
        view.liveToClone.set(liveNode, cloneNode)
        view.cloneToLive.set(cloneNode, liveNode)
      }
      for (const child of Array.from(cloneNode.childNodes || [])) mapFiltered(child)
    }
    for (const child of Array.from(copy.childNodes)) mapFiltered(child)
  }

  const adapter = {
    ...dom,
    find(ctx, selector, findOpts = {}) {
      const projectedContext = projected(ctx)
      if (!projectedContext?.querySelectorAll) return []
      let matches = contentView().query(selector, projectedContext)
      if (!findOpts.includeRulesTag) matches = matches.filter(node => !isRulesTag(node))
      const skipParts = []
      if (findOpts.skip) skipParts.push(findOpts.skip)
      const tplAttr = findOpts.templateAttr === null ? null : (findOpts.templateAttr || 'cms-template')
      if (tplAttr) skipParts.push(`[${tplAttr}]`)
      if (skipParts.length) {
        const combined = skipParts.join(', ')
        matches = matches.filter(node => !node.closest?.(combined))
      }
      return matches
    },
    parent(node) {
      const result = projected(node)?.parentElement
      return result ? live(result) : null
    },
    children(node) {
      return Array.from(projected(node)?.children || [], live)
    },
    text(node, value) {
      if (value === undefined) {
        const target = live(node)
        if (!target?.matches?.(semanticSelector) && !target?.querySelector?.(semanticSelector)) return dom.text(target)
        return (projected(node)?.textContent || '').trim()
      }
      const target = live(node)
      if (!target?.matches?.(semanticSelector) && !target?.querySelector?.(semanticSelector) && !view) {
        dom.text(target, value)
        return
      }
      const copy = contentView().cloneOf(target)
      if (copy) replaceProjectedContent(target, copy, 'textContent', value)
      else dom.text(target, value)
    },
    attrNames(node) {
      return dom.attrNames(live(node))
    },
    attr(node, name, value) {
      const target = live(node)
      if (value === undefined) return dom.attr(target, name)
      dom.attr(target, name, value)
      const copy = view?.cloneOf(target)
      if (copy) {
        dom.attr(copy, name, value)
        if (createContentView(target, { capability: 'data', exclude: opts.exclude || null }).root === null) {
          copy.remove()
          view.liveToClone.delete(target)
          view.cloneToLive.delete(copy)
        }
      }
    },
    removeAttr(node, name) {
      const target = live(node)
      dom.removeAttr(target, name)
      const copy = view?.cloneOf(target)
      if (copy) dom.removeAttr(copy, name)
    },
    prop(node, name, value) {
      const target = live(node)
      if (value === undefined) {
        if (name === 'innerHTML' || name === 'outerHTML' || name === 'textContent' || name === 'innerText') {
          return dom.prop(projected(target), name)
        }
        return dom.prop(target, name)
      }
      const semanticContent = name === 'innerHTML' || name === 'textContent' || name === 'innerText'
      const copy = semanticContent ? contentView().cloneOf(target) : view?.cloneOf(target)
      if (copy && semanticContent) {
        replaceProjectedContent(target, copy, name, value)
      } else {
        dom.prop(target, name, value)
        if (copy) dom.prop(copy, name, value)
      }
    },
    clone(node) {
      const copy = projected(node)
      if (copy === node) return dom.clone(node)
      const clone = outputDocument.importNode(copy, true)
      resetFormState(clone)
      return clone
    },
    insertAt(parent, node, index) {
      const targetParent = live(parent)
      const contentChildren = adapter.children(targetParent)
      const ref = contentChildren[index] || (() => {
        for (let i = targetParent.children.length - 1; i >= 0; i--) {
          const child = targetParent.children[i]
          if (contentView().cloneOf(child)) return child.nextElementSibling
        }
        return targetParent.firstElementChild
      })()
      const targetNode = live(node)
      targetParent.insertBefore(targetNode, ref || null)
      const parentCopy = contentView().cloneOf(targetParent)
      if (parentCopy) {
        let nodeCopy = contentView().cloneOf(targetNode)
        if (!nodeCopy) {
          nodeCopy = outputDocument.importNode(targetNode, true)
          mapParallel(targetNode, nodeCopy)
        }
        const copyContentChildren = Array.from(parentCopy.children)
        parentCopy.insertBefore(nodeCopy, copyContentChildren[index] || null)
      }
    },
    insertBefore(ref, node) {
      const targetRef = live(ref)
      const targetNode = live(node)
      targetRef.parentNode.insertBefore(targetNode, targetRef)
      const parentCopy = contentView().cloneOf(targetRef.parentNode)
      if (parentCopy) {
        let nodeCopy = contentView().cloneOf(targetNode)
        if (!nodeCopy) {
          nodeCopy = outputDocument.importNode(targetNode, true)
          mapParallel(targetNode, nodeCopy)
        }
        const refCopy = contentView().cloneOf(targetRef)
        if (refCopy) refCopy.before(nodeCopy)
        else parentCopy.appendChild(nodeCopy)
      }
    },
    insertAfter(ref, node) {
      const targetRef = live(ref)
      const targetNode = live(node)
      targetRef.parentNode.insertBefore(targetNode, targetRef.nextSibling)
      const parentCopy = contentView().cloneOf(targetRef.parentNode)
      if (parentCopy) {
        let nodeCopy = contentView().cloneOf(targetNode)
        if (!nodeCopy) {
          nodeCopy = outputDocument.importNode(targetNode, true)
          mapParallel(targetNode, nodeCopy)
        }
        const refCopy = contentView().cloneOf(targetRef)
        if (refCopy) refCopy.after(nodeCopy)
        else parentCopy.appendChild(nodeCopy)
      }
    },
    identity(node) {
      return live(node) || null
    },
    remove(node) {
      const target = live(node)
      const copy = contentView().cloneOf(target)
      dom.remove(target)
      if (copy) dom.remove(copy)
    },
    replaceWith(node, html) {
      const target = live(node)
      const copy = contentView().cloneOf(target)
      const replacement = dom.replaceWith(target, html)
      if (copy) {
        const filteredView = createContentView(replacement, { capability: 'data', exclude: opts.exclude || null })
        if (!filteredView.root) {
          copy.remove()
        } else {
          copy.replaceWith(filteredView.root)
          const mapFiltered = cloneNode => {
            const liveNode = filteredView.original(cloneNode)
            if (liveNode) {
              view.liveToClone.set(liveNode, cloneNode)
              view.cloneToLive.set(cloneNode, liveNode)
            }
            for (const child of Array.from(cloneNode.childNodes || [])) mapFiltered(child)
          }
          mapFiltered(filteredView.root)
        }
      }
      return replacement
    },
  }
  return adapter
}

export default dom
