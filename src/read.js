import cheerioAdapter from './adapters/cheerio.js'
import { extract } from './engine/extract.js'
import { findRulesIn } from './engine/rules-tag.js'
import { codecOf } from './engine/rule-syntax.js'
import { sheet } from './codecs/sheet.js'
import { checkCodecRules } from './engine/codecs.js'
import { holeMarker, QueryRefused } from './codecs/sheet.vendor.js'

// The URL parameters a host passes to readDocument as `query`, from a
// URLSearchParams. Returns null when none of them is present (a whole read,
// exactly as before). Each may appear once with a value, and none may be
// mixed with ?data= (a caller-supplied rule set); anything else is
// QueryRefused('bad_query'), which hosts answer with 400. Values are not
// checked here: readDocument refuses a bad one with its own code.
export const SHEET_QUERY_PARAMS = ['shape', 'sheet', 'range', 'render']

export function parseSheetQuery(params) {
  const query = {}
  for (const key of SHEET_QUERY_PARAMS) {
    const values = params.getAll(key)
    if (values.length === 0) continue
    if (values.length > 1) throw new QueryRefused('bad_query', `${key} appears ${values.length} times; send it once`)
    if (values[0] === '') throw new QueryRefused('bad_query', `${key} is empty; give it a value or leave it out`)
    query[key] = values[0]
  }
  if (Object.keys(query).length === 0) return null
  if (params.has('data')) throw new QueryRefused('bad_query', `data cannot be combined with ${Object.keys(query).join(', ')}; a sheet query reads the document's own rules`)
  return query
}

// Reads a document's data through its rules tag, from source. `load` is
// cheerio.load, passed in so this package keeps cheerio out of its browser
// bundles. Returns { data, version, fast }; data is null when no rules tag
// carries `token`.
//
// A codec with cut() lets a host skip parsing its regions: the source is cut,
// only the rest is parsed, and each hole hands the codec its region's bytes.
// The holes are verified first: every hole is a real element, each index
// appears exactly once and in order, and every hole lies under the element a
// rule naming that codec selected, which only that codec reads. Anything else
// (a grid inside a comment, a script or a textarea, a grid outside the sheet)
// discards the cut and reads the whole source through the tree. `fast` is false whenever a
// `<table grid` was read through the tree (that fallback, or a hand-edited table
// the cut left in place), so a host can count how often the slow route runs.
//
// options: { token = 'api', query, view, codecs = { sheet } }. query and view
// reach every codec rule (see src/codecs/sheet.js for the sheet's shapes).
export function readDocument(load, src, options = {}) {
  const { token = 'api', query, view, codecs = { sheet } } = options
  const call = { codecs, query, view }
  const cutting = Object.entries(codecs).filter(([, codec]) => typeof codec.cut === 'function')
  if (cutting.length > 1) throw new Error('hyper-html-api: readDocument supports one codec with cut()')

  if (cutting.length === 1) {
    const [name, codec] = cutting[0]
    const marker = holeMarker(src)
    const { rest, regions } = codec.cut(src, marker)
    if (regions.length > 0) {
      const $ = load(rest)
      const root = $.root()
      const found = findRulesIn(cheerioAdapter, root, token)
      const fast = countGrids(rest) === regions.length
      if (!found) return { data: null, version: null, fast }
      if (codec === sheet && readHolesHold($, root, found.rules, name, marker, regions.length)) {
        const region = (table) => regionBytes(table, src, marker, regions)
        const opts = { ...call, version: found.version, region }
        checkCodecRules(found.rules, opts)
        let tree
        const data = {}
        for (const [key, rule] of Object.entries(found.rules)) {
          const codec = codecOf(rule)
          const context = codec ? root : (tree ??= load(src).root())
          data[key] = extract(cheerioAdapter, context, { [key]: rule }, { ...opts, region: codec ? region : undefined })[key]
        }
        return { data, version: found.version, fast }
      }
    }
  }

  const fast = !src.includes(GRID)

  const root = load(src).root()
  const found = findRulesIn(cheerioAdapter, root, token)
  if (!found) return { data: null, version: null, fast }
  return { data: extract(cheerioAdapter, root, found.rules, { ...call, version: found.version }), version: found.version, fast }
}

// A document's rules tag as { rules, version }, or null when no tag carries
// `token`, without parsing its canonical tables: what a host needs to classify
// a request body (isPatchBody) before it reads or patches. Same cut and checks
// as readDocument; anything they reject is found by parsing the whole source.
export function documentRules(load, src, options = {}) {
  const { token = 'api', codecs = { sheet } } = options
  const cutting = Object.entries(codecs).filter(([, codec]) => typeof codec.cut === 'function')
  if (cutting.length === 1) {
    const [name, codec] = cutting[0]
    const marker = holeMarker(src)
    const { rest, regions } = codec.cut(src, marker)
    if (regions.length > 0) {
      const $ = load(rest)
      const root = $.root()
      const found = findRulesIn(cheerioAdapter, root, token)
      if (!found) return null
      if (holesHold($, root, found.rules, name, marker, regions.length)) return { rules: found.rules, version: found.version }
    }
  }
  const found = findRulesIn(cheerioAdapter, load(src).root(), token)
  return found ? { rules: found.rules, version: found.version } : null
}

const GRID = '<table grid'

function countGrids(text) {
  let n = 0
  for (let at = text.indexOf(GRID); at !== -1; at = text.indexOf(GRID, at + 1)) n++
  return n
}

export function holesHold($, root, rules, name, marker, count) {
  const holes = $('table[data-hole]').toArray()
  if (holes.length !== count) return false
  const containers = codecContainers(root, rules, name)
  if (containers.length === 0) return false
  return holes.every((hole, n) =>
    hole.attribs['data-hole'] === `${marker}-${n}` &&
    containers.some((container) => container === hole || $.contains(container, hole)))
}

// Only this selector cannot match within canonical grid bytes or depend on their children.
const SHEET_CONTAINER = /^\[items\s*=\s*(?:sheets|"sheets"|'sheets')\]$/

function readHolesHold($, root, rules, name, marker, count) {
  if (!rules || typeof rules !== 'object' || Array.isArray(rules)) return false
  for (const rule of Object.values(rules)) {
    const form = codecOf(rule)
    if (form && (form.name !== name || !SHEET_CONTAINER.test(form.selector))) return false
  }
  if (!holesHold($, root, rules, name, marker, count)) return false
  const containers = new Set(codecContainers(root, rules, name))
  return $('table[grid]').length === count && $('table[data-hole]').toArray().every(hole =>
    hole.parent?.name === 'section' && Object.hasOwn(hole.parent.attribs, 'item') && containers.has(hole.parent.parent))
}

// The element each top level `selector@codec(name)` rule selects, as the engine
// would read it: the first match, or the document itself for a bare "@codec(name)".
function codecContainers(root, rules, name) {
  if (!rules || typeof rules !== 'object' || Array.isArray(rules)) return []
  const out = []
  for (const rule of Object.values(rules)) {
    const form = codecOf(rule)
    if (!form || form.name !== name) continue
    const node = form.selector ? cheerioAdapter.find(root, form.selector)[0] : root
    if (node && node.get(0)) out.push(node.get(0))
  }
  return out
}

function regionBytes(table, src, marker, regions) {
  const hole = cheerioAdapter.attr(table, 'data-hole')
  if (!hole || !hole.startsWith(`${marker}-`)) return null
  const region = regions[Number(hole.slice(marker.length + 1))]
  return region ? src.slice(region.start, region.end) : null
}
