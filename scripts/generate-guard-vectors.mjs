import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { grid } from '../src/codecs/sheet.js'

const at = process.argv.indexOf('--core')
assert(at >= 0 && process.argv[at + 1], 'Pass --core <data-loss-core.cjs>')
const corePath = resolve(process.argv[at + 1])
const core = createRequire(import.meta.url)(corePath)
const codecs = { sheet: { rowChange: grid.rowChange } }
const clone = value => structuredClone(value)
const tab = (rows, cols = ['a', 'b', 'c'], id = 's1') => ({
  id, name: 'Budget', ...grid.tabDigest({
    cols: cols.map(id => ({ id })),
    rows: rows.map(([id, ...cells]) => ({ id, cells: cells.map(text => typeof text === 'object' ? text : { text }) }))
  })
})
const island = tabs => ({ api: { sheets: tabs }, '@codecs': { api: { sheets: 'sheet' } }, '@form': 'stored' })
const rows = Array.from({ length: 100 }, (_, i) => [`r${i}`, `item ${i}`, `value ${i}`, `note ${i}`])
const base = island([tab(rows)])
const cases = []
function add(name, before, after, wantFire, opts = {}) {
  // A person's own save comes through the page's save lane, never the agent lane, so it is
  // never a proven reader.
  const { provenance = 'external', pending = true, lane = provenance.startsWith('ui') ? 'save' : 'agent', ifMatch = '"v1"' } = opts
  const tags = typeof ifMatch === 'string' ? ifMatch.split(',').map(t => t.trim()).filter(Boolean) : []
  const ifMatched = lane === 'agent' && tags.length > 0 && !tags.includes('*')
  const D = core.classifyDestruction(before, after, { codecs })
  // An agent that named the exact version it read is a proven reader (David, 2026-11-13).
  const fire = core.shouldFire(provenance, pending && !ifMatched, before, after, D, ifMatched)
  assert.equal(fire, wantFire, name)
  cases.push({ name, base: before, inc: after, provenance, pending, lane, ifMatch, D, fire })
}
add('unchanged', base, base, false)
add('insert row at top', base, island([tab([['new', '', '', ''], ...rows])]), false, { provenance: 'ui-gestured' })
add('reverse rows', base, island([tab([...rows].reverse())]), false)
const changed = clone(rows); changed[0][2] = 'replacement'
for (const [name, opts, fires] of [
  ['agent exact version', {}, false],
  ['agent no version', { ifMatch: null }, true],
  ['agent wildcard', { ifMatch: '*' }, true],
  ['device exact version', { lane: 'device' }, true],
  ['agent no pending work', { pending: false, ifMatch: null }, false],
  ['human overwrite', { provenance: 'ui-gestured' }, false],
]) add(name, base, island([tab(changed)]), fires, opts)
const cleared = clone(rows); cleared[0][2] = ''
add('agent clears one cell with exact version', base, island([tab(cleared)]), false)
add('human clears one cell', base, island([tab(cleared)]), false, { provenance: 'ui-gestured' })
add('agent removes one row', base, island([tab(rows.slice(1))]), false)
add('agent exact version removes one row of many', base, island([tab(rows.slice(1))]), false)
const emptied = rows.map(([id]) => [id, '', '', ''])
add('agent exact version empties every cell', base, island([tab(emptied)]), true)
add('human removes two rows of 100', base, island([tab(rows.slice(2))]), false, { provenance: 'ui-gestured' })
add('human removes most rows', base, island([tab(rows.slice(70))]), true, { provenance: 'ui-gestured' })
add('agent removes tab', base, island([]), true)
add('human empties tiny sheet', island([tab([['r1', 'only']], ['a'])]), island([]), false, { provenance: 'ui-gestured' })
add('agent empties tiny sheet', island([tab([['r1', 'only']], ['a'])]), island([]), true)
add('replaced filled column', island([tab([['r1', 'a', 'b']], ['a', 'b'])]), island([tab([['r1', 'a', 'b']], ['x', 'b'])]), false)
add('removed filled column and inserted another', island([tab([['r1', 'a', 'b', 'c']])]), island([tab([['r1', 'a', 'c', 'd']], ['a', 'c', 'd'])]), false)
add('removed empty column', island([tab([['r1', 'a', '', 'c']])]), island([tab([['r1', 'a', 'c']], ['a', 'c'])]), false)
add('cleared and filled with equal count', island([tab([['r1', 'a', '', 'c']])]), island([tab([['r1', '', 'b', 'c']])]), false)
add('columns acquire ids', island([tab([['r1', 'a', '', 'c']], ['', '', ''])]), island([tab([['r1', 'a', '', 'c']])]), false)
const duplicates = [['same', 'first', '', ''], ['same', '', 'second', '']]
add('duplicate rows reorder', island([tab(duplicates)]), island([tab([...duplicates].reverse())]), false)
add('duplicate row removed', island([tab(duplicates)]), island([tab(duplicates.slice(1))]), false)
const blankIds = [['', 'first', '', ''], ['', '', 'second', '']]
add('empty row ids reorder', island([tab(blankIds)]), island([tab([...blankIds].reverse())]), false)
add('empty row id removed', island([tab(blankIds)]), island([tab(blankIds.slice(1))]), false)
const first = tab([['r1', 'first']], ['a'], 'same'), second = tab([['r1', 'second']], ['a'], 'same')
add('duplicate tabs reorder', island([first, second]), island([second, first]), false)
add('duplicate tab removed', island([first, second]), island([second]), false)
const renamed = clone(base); renamed.api.sheets[0].name = 'Renamed'
add('tab rename', base, renamed, false)
const unreadable = clone(base); delete unreadable.api.sheets; unreadable['@codecs'].api.sheets = 'unknown'
add('unreadable codec', base, unreadable, true)
add('unreadable document', base, null, true)
add('codec removed', base, { api: {}, '@form': 'stored' }, true)
add('ordinary replaced with codec', { api: { sheets: 'important notes' } }, island([]), true)
add('codec replaced with ordinary', base, { api: { sheets: 'replacement' } }, true)
const ordinary = { api: { entries: rows.map(([id, title]) => ({ id, title })) } }
add('ordinary human removes two rows', ordinary, { api: { entries: ordinary.api.entries.slice(2) } }, true, { provenance: 'ui-gestured' })
add('ordinary inserts into long list', ordinary, { api: { entries: [{ id: 'new', title: 'new row' }, ...ordinary.api.entries] } }, false, { provenance: 'ui-gestured' })
add('ordinary tiny document cleared', { api: { note: 'saved' } }, { api: { note: '' } }, true, { provenance: 'ui-gestured' })
const mixed = island([tab([['r1', 'cell']], ['a'])]); mixed.api.note = 'saved'
const mixedAfter = clone(mixed); mixedAfter.api.note = ''
add('ordinary cleared beside tiny sheet', mixed, mixedAfter, false, { provenance: 'ui-gestured' })
add('tiny mixed document cleared', mixed, { ...island([]), api: { sheets: [], note: '' } }, true, { provenance: 'ui-gestured' })
add('marker removed changes no data', { api: { note: 'saved' }, '@form': 'stored', '@codecs': { api: {} } }, { api: { note: 'saved' } }, false, { lane: 'device' })
add('metadata is not user data', { '@form': 'stored', '@codecs': { api: { sheets: 'sheet' } } }, null, false)
const recalculatedBefore = island([tab([['r1', { f: '=1+1', v: '2', text: '2' }]], ['a'])])
const recalculatedAfter = island([tab([['r1', { f: '=1+1', v: '3', text: '3' }]], ['a'])])
add('formula display only', recalculatedBefore, recalculatedAfter, false)

const metadata = [
  { name: 'marker excluded from hash', fn: 'islandHash', args: [{ api: { note: 'saved' }, '@form': 'stored', '@codecs': { api: {} } }], expect: core.islandHash({ api: { note: 'saved' } }) },
  { name: 'marker excluded from equality', fn: 'islandsEqual', args: [{ api: { note: 'saved' }, '@form': 'stored', '@codecs': {} }, { api: { note: 'saved' } }], expect: true },
  { name: 'metadata only is empty', fn: 'isEmptyIsland', args: [{ '@form': 'stored', '@codecs': { api: { sheets: 'sheet' } } }], expect: true },
  { name: 'nested marker is user data', fn: 'isEmptyIsland', args: [{ api: { '@form': 'saved' } }], expect: false },
]
for (const entry of metadata) assert.deepEqual(core[entry.fn](...entry.args), entry.expect, entry.name)
const destination = fileURLToPath(new URL('../conformance/sheet-guard.json', import.meta.url))
writeFileSync(destination, JSON.stringify({ schema: 1, source: { coreSha256: createHash('sha256').update(readFileSync(corePath)).digest('hex') }, cases, metadata }, null, 2) + '\n')
console.log(`wrote ${cases.length} guard cases and ${metadata.length} metadata cases`)
