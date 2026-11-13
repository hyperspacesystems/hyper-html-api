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

// Applies a patch list to a sheet document's source, rewriting only the rows it
// touches. `load` is cheerio.load. patch is
//   [{ sheet?, range: "B3", values: [[450]] } | { sheet?, append: [["Porto", 12]] }]
// where `sheet` is a tab name or id (none means the first tab). Values are typed
// input: null clears, a number or boolean is that value, a string starting with
// "=" is a formula, any other string is text.
//
// options.newId() names appended rows (default: random ids); a test or the
// conformance runner passes a counter so the output is the same on every run.
//
// Returns { html, changed: { cells, rows }, stale: true }: the host cannot
// recalculate, so every patched table carries `stale` until a browser saves it.
// Throws before producing output: NoRulesTag; RulesParseError or UnknownCodec for
// a rules tag that cannot hold a sheet; CodecRefused 'no-sheet' when no single
// sheet rule matches; QueryRefused (bad_patch, bad_value, bad_range,
// outside_sheet, covered_cell, unknown_sheet) for a patch the sheet cannot take;
// CodecRefused 'sheet-not-canonical' (hosts answer 409) for a table edited
// outside the editor.
export function patchDocument(load, src, patch, options = {}) {
  const { token = 'api', newId } = options
  if (!Array.isArray(patch) || patch.length === 0) {
    throw new QueryRefused('bad_patch', 'patch is a non-empty list of operations')
  }
  const tabs = locateTabs(load, src, token)

  const groups = new Map()
  for (const op of patch) {
    if (!op || typeof op !== 'object' || Array.isArray(op)) {
      throw new QueryRefused('bad_patch', 'an operation is { sheet, range, values } or { sheet, append }')
    }
    const { sheet: wanted, ...gridOp } = op
    const tab = pickTab(tabs, wanted)
    if (!groups.has(tab)) groups.set(tab, [])
    groups.get(tab).push(gridOp)
  }

  const edits = []
  let cells = 0
  let rows = 0
  for (const [tab, ops] of groups) {
    if (!tab.region) throw new CodecRefused('sheet-not-canonical', NOT_CANONICAL_MESSAGE)
    const { bytes, changed } = patchGrid(src.slice(tab.region.start, tab.region.end), ops, newId ? { newId } : {})
    edits.push({ ...tab.region, bytes })
    cells += changed.cells
    rows += changed.rows
  }

  edits.sort((a, b) => b.start - a.start)
  let html = src
  for (const edit of edits) html = html.slice(0, edit.start) + edit.bytes + html.slice(edit.end)
  return { html, changed: { cells, rows }, stale: true }
}

// [{ id, name, region: { start, end } | null }]: region is where the tab's
// canonical table sits in src, or null when the table is missing or not canonical.
// The cut route first, as readDocument reads; when its holes do not verify, one
// parse with source positions, then a strict scan at each table's start.
function locateTabs(load, src, token) {
  const marker = holeMarker(src)
  const { rest, regions } = sheet.cut(src, marker)
  if (regions.length > 0) {
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
  return tabNodes(cheerioAdapter, container).map(({ id, name, table }) => ({
    id, name, region: table ? scannedRegion(table, src) : null,
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
