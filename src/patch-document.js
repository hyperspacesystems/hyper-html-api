import cheerioAdapter from './adapters/cheerio.js'
import { checkCodecRules } from './engine/codecs.js'
import { CodecRefused, NoRulesTag } from './engine/errors.js'
import { findRulesIn } from './engine/rules-tag.js'
import { codecOf } from './engine/rule-syntax.js'
import { pickTab, sheet, tabNodes } from './codecs/sheet.js'
import { CodecMiss, QueryRefused, holeMarker, patchGrid, scanGrid } from './codecs/sheet.vendor.js'
import { holesHold } from './read.js'

export const NOT_CANONICAL_MESSAGE =
  'This sheet was edited outside the sheet editor, so the API cannot patch it: open the sheet in the editor and save once.'

// Applies a patch list to a sheet document's source, splicing only removed
// <section item> tabs, patched table rows, and needed `stale` attributes
// (changing nothing around deleted tabs except survivor `stale` attributes).
// `load` is cheerio.load. `patch` is a non-empty list of
//   { sheet?, range: "B3", values: [[450]] }
//   | { sheet?, append: [["Porto", 12]] }
//   | { sheet: "Archive", delete: true }
// where `sheet` matches tab name first, then id. Omitting `sheet` selects the
// first tab for `range` and `append`; deletion requires `sheet` and `delete`
// set to exactly `true`. Values are typed input: null clears, a number or
// boolean is that value, a string starting with "=" is a formula, any other
// string is text.
//
// options.token selects the version 2 rules tag (default 'api'). options.newId()
// names appended rows (default: random ids); a test or the conformance runner
// passes a counter so the output is the same on every run.
//
// Returns { html, changed, stale } with no host calculation: ordinary cell
// writes intentionally change cell values and formulas, while deletion and its
// `stale` marking leave surviving formula text and cached values unchanged.
// `changed` has `{ cells, rows }` and adds `sheets` only when tabs are deleted;
// removed cells and rows are not counted as writes. Cell-patched tables set
// `stale: true`. Pure deletion returns `stale: false` when surviving tabs have
// no formulas; otherwise every surviving formula-bearing table (including local
// formulas and already `stale` tables) is marked `stale` until a browser
// recalculates.
//
// Throws before producing output: NoRulesTag; RulesParseError or UnknownCodec
// for a rules tag that cannot hold a sheet; CodecRefused 'no-sheet' (hosts
// answer HTTP 400) when no single @codec(sheet) rule matches; and CodecRefused
// 'sheet-not-canonical' (the only case mapping to HTTP 409) when a cell-patched
// table lacks canonical bytes or a deleted <section item> lacks an explicit
// closing </section> (deleted or untouched noncanonical tables do not block
// deletion). Also throws QueryRefused with bad_value, bad_range, outside_sheet,
// or covered_cell for invalid cell writes, unknown_sheet for an unresolved
// target, last_sheet if no tab would remain, and bad_patch when a delete omits
// `sheet` or sets `delete` other than `true` (using distinct messages), or when
// a delete includes `range`, `append`, or `values` or shares a patch with any
// operation resolving to that tab by name, id, or omitted first-tab selector
// before or after deletion (mixed operations and same-tab conflicts ask to send
// the delete on its own). Multiple deletes of different tabs are allowed if one
// tab remains.
export function patchDocument(load, src, patch, options = {}) {
  const { token = 'api', newId } = options
  if (!Array.isArray(patch) || patch.length === 0) {
    throw new QueryRefused('bad_patch', 'patch is a non-empty list of operations')
  }
  const deleting = patch.some((op) => op && Object.hasOwn(op, 'delete'))
  const tabs = locateTabs(load, src, token, deleting)
  const groups = new Map()
  for (const op of patch) {
    if (!op || typeof op !== 'object' || Array.isArray(op)) {
      throw new QueryRefused('bad_patch', 'an operation is { sheet, range, values }, { sheet, append }, or { sheet, delete: true }')
    }
    if (Object.hasOwn(op, 'delete')) {
      if (op.delete !== true) throw new QueryRefused('bad_patch', 'delete must be exactly true')
      if (op.sheet === undefined) throw new QueryRefused('bad_patch', 'delete requires a sheet name or id')
      if (['range', 'append', 'values'].some((key) => Object.hasOwn(op, key))) {
        throw new QueryRefused('bad_patch', 'delete cannot include range, append, or values; send the delete on its own')
      }
    }
    const { sheet: wanted, ...gridOp } = op
    const tab = pickTab(tabs, wanted)
    if (!groups.has(tab)) groups.set(tab, [])
    groups.get(tab).push(gridOp)
  }

  const deleted = new Set()
  for (const [tab, ops] of groups) {
    if (!ops.some((op) => op.delete === true)) continue
    if (ops.length !== 1) {
      throw new QueryRefused('bad_patch', `another operation names sheet ${JSON.stringify(tab.name)}; send the delete on its own`)
    }
    deleted.add(tab)
  }
  if (deleted.size > 0 && deleted.size === tabs.length) {
    throw new QueryRefused('last_sheet', 'cannot delete the last sheet; keep at least one tab')
  }

  const edits = []
  let cells = 0
  let rows = 0
  let stale = false
  for (const [tab, ops] of groups) {
    if (deleted.has(tab)) {
      const location = tab.section.get(0)?.sourceCodeLocation
      if (!location?.endTag) throw new CodecRefused('sheet-not-canonical', NOT_CANONICAL_MESSAGE)
      edits.push({ start: location.startOffset, end: location.endOffset, bytes: '' })
      continue
    }
    if (!tab.region) throw new CodecRefused('sheet-not-canonical', NOT_CANONICAL_MESSAGE)
    const { bytes, changed } = patchGrid(src.slice(tab.region.start, tab.region.end), ops, newId ? { newId } : {})
    edits.push({ ...tab.region, bytes })
    cells += changed.cells
    rows += changed.rows
    stale = true
  }
  if (deleted.size > 0) {
    for (const tab of tabs) {
      if (groups.has(tab) || !tab.table?.find('[f]').length) continue
      stale = true
      if (tab.table.attr('stale') !== undefined) continue
      const location = tab.table.get(0).sourceCodeLocation
      const end = location.startTag.endOffset - 1
      const slashInValue = Object.values(location.attrs).some((attr) => attr.endOffset === end)
      const at = src[end - 1] === '/' && !slashInValue ? end - 1 : end
      edits.push({ start: at, end: at, bytes: ' stale' })
    }
  }

  edits.sort((a, b) => b.start - a.start)
  let html = src
  for (const edit of edits) html = html.slice(0, edit.start) + edit.bytes + html.slice(edit.end)
  return { html, changed: { cells, rows, ...(deleted.size ? { sheets: deleted.size } : {}) }, stale }
}

// [{ id, name, region: { start, end } | null }]: region is where the tab's
// canonical table sits in src, or null when the table is missing or not canonical.
// The cut route first, as readDocument reads; when its holes do not verify, one
// parse with source positions, then a strict scan at each table's start.
function locateTabs(load, src, token, deleting) {
  const marker = holeMarker(src)
  const { rest, regions } = sheet.cut(src, marker)
  if (!deleting && regions.length > 0) {
    const $ = load(rest)
    const root = $.root()
    const found = findRulesIn(cheerioAdapter, root, token)
    if (!found) throw new NoRulesTag(token)
    const container = sheetContainer(root, found)
    if (holesHold($, root, found.rules, 'sheet', marker, regions.length)) {
      return tabNodes(cheerioAdapter, container).map(({ id, name, table }) => ({
        id, name, region: table ? holeRegion(table, marker, regions) : null,
      }))
    }
  }

  const root = load(src, { sourceCodeLocationInfo: true }).root()
  const found = findRulesIn(cheerioAdapter, root, token)
  if (!found) throw new NoRulesTag(token)
  const container = sheetContainer(root, found)
  return tabNodes(cheerioAdapter, container).map(({ id, name, section, table }) => ({
    id, name, section, table, region: table ? scannedRegion(table, src) : null,
  }))
}

function sheetContainer(root, found) {
  checkCodecRules(found.rules, { version: found.version, codecs: { sheet } })
  const rules = found.rules
  const forms = rules && typeof rules === 'object' && !Array.isArray(rules)
    ? Object.values(rules).map(codecOf).filter((form) => form && form.name === 'sheet')
    : []
  if (forms.length !== 1) throw new CodecRefused('no-sheet', 'this document has no single @codec(sheet) rule to patch')
  const node = forms[0].selector ? cheerioAdapter.find(root, forms[0].selector)[0] : root
  if (!node) throw new CodecRefused('no-sheet', "the document's @codec(sheet) rule matches no element")
  return node
}

function holeRegion(table, marker, regions) {
  const hole = cheerioAdapter.attr(table, 'data-hole')
  if (!hole || !hole.startsWith(`${marker}-`)) return null
  return regions[Number(hole.slice(marker.length + 1))] ?? null
}

function scannedRegion(table, src) {
  const start = table.get(0)?.sourceCodeLocation?.startOffset
  if (start == null) return null
  try {
    return { start, end: scanGrid(src, start) }
  } catch (error) {
    if (error instanceof CodecMiss) return null
    throw error
  }
}
