import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { grid } from '../src/codecs/sheet.js'

const at = process.argv.indexOf('--core')
assert(at >= 0 && process.argv[at + 1], 'Pass --core <data-loss-core.cjs>')
const core = createRequire(import.meta.url)(resolve(process.argv[at + 1]))
const codecs = { sheet: { rowChange: grid.rowChange } }

const NOW = 1000000000000
const MINUTE = 60000
const HOUR = 60 * MINUTE

const cases = []
const digestOf = value => core.stableDigest(value)
const pathsOf = typed => typed.map(e => e.path)
const entryAt = (typed, path) => {
  const found = typed.find(e => e.path === path)
  assert(found, `no typed entry at ${path}`)
  return found
}
// Every leaf of an island, stamped with the time a person typed it.
const typedFrom = (island, when) => core.updateTyped(null, island, [], when)

const tab = (rows, cols = ['a', 'b', 'c'], id = 's1') => ({
  id, name: 'Budget', ...grid.tabDigest({
    cols: cols.map(id => ({ id })),
    rows: rows.map(([id, ...cells]) => ({ id, cells: cells.map(text => typeof text === 'object' ? text : { text }) }))
  })
})
const sheetIsland = tabs => ({ api: { sheets: tabs }, '@codecs': { api: { sheets: 'sheet' } }, '@form': 'stored' })

// ---------------------------------------------------------------------------
// updateTyped — a person's own save records what they typed.
// ---------------------------------------------------------------------------
function updateTypedCase(name, prev, inc, typed = []) {
  const want = core.updateTyped(prev, inc, typed, NOW)
  cases.push({ name, op: 'updateTyped', prev, inc, typed, now: NOW, want })
  return want
}

const formBefore = { api: { questions: [{ key: 'q1', answer: '' }] } }
const formAfter = { api: { questions: [{ key: 'q1', answer: 'Blue' }] } }
let want = updateTypedCase('first answer on a form is typed', formBefore, formAfter)
assert.equal(want.length, 1, 'first answer')
assert.equal(want[0].path, 'api.questions[key:q1].answer', 'first answer path')
assert.equal(want[0].digest, digestOf('Blue'), 'first answer digest')
assert.equal(want[0].at, NOW, 'first answer at')
assert.equal('prev' in want[0], false, 'first answer has no prev')

want = updateTypedCase('numeric item id names the path', { items: [{ id: 1, note: '' }] }, { items: [{ id: 1, note: 'bought milk' }] })
assert.deepEqual(pathsOf(want), ['items[id:1].note'], 'numeric id path')
assert.equal(want[0].digest, digestOf('bought milk'), 'numeric id digest')

want = updateTypedCase('string item id names the path', { items: [{ id: 'a1', note: '' }] }, { items: [{ id: 'a1', note: 'first note' }] })
assert.deepEqual(pathsOf(want), ['items[id:a1].note'], 'string id path')

want = updateTypedCase('id-less list records star paths', {}, { tags: ['draft', 'second'] })
assert.deepEqual(pathsOf(want), ['tags[*]', 'tags[*]'], 'id-less star paths')
assert.deepEqual(want.map(e => e.digest), [digestOf('draft'), digestOf('second')], 'id-less digests')

want = updateTypedCase('the identity field is not typed', { items: [{ id: 'a1', title: 'first', done: '' }] }, { items: [{ id: 'a1', title: 'first', done: 'yes' }] })
assert.deepEqual(pathsOf(want), ['items[id:a1].done'], 'identity field excluded')

want = updateTypedCase('replacing a name records what it was', { api: { name: 'Bob' } }, { api: { name: 'Alice' } })
assert.equal(want.length, 1, 'revert memory length')
assert.equal(want[0].digest, digestOf('Alice'), 'revert memory digest')
assert.equal(want[0].prev, digestOf('Bob'), 'revert memory prev')

const sheetBefore = sheetIsland([tab([['r1', 'a', 'b', 'c']])])
const sheetAfter = sheetIsland([tab([['r1', 'a', 'b', 'd']])])
want = updateTypedCase('a sheet records nothing', sheetBefore, sheetAfter)
assert.equal(want.length, 0, 'sheet records nothing')

want = updateTypedCase('guard bookkeeping is not typed', null, { api: { note: 'typed now' }, '@form': 'stored', '@codecs': {} })
assert.deepEqual(pathsOf(want), ['api.note'], 'markers skipped')

// ---------------------------------------------------------------------------
// judgeOutside — an outside write that showed no proof of reading.
// ---------------------------------------------------------------------------
function judgeCase(name, base, inc, typed = []) {
  // Each host computes its own destruction diff, so it is not stored.
  const d = core.classifyDestruction(base, inc, { codecs })
  const want = core.judgeOutside(base, inc, d, typed, NOW)
  cases.push({ name, op: 'judgeOutside', base, inc, typed, now: NOW, want })
  return want
}
const reasonOf = (name, want, fire, reason, gonePaths) => {
  assert.equal(want.fire, fire, `${name} fire`)
  assert.equal(want.reason, reason, `${name} reason`)
  if (gonePaths) assert.deepEqual(pathsOf(want.gone), gonePaths, `${name} gone`)
}

const answered = { api: { questions: [
  { key: 'q1', answer: 'Blue' },
  { key: 'q2', answer: 'Red' },
  { key: 'q3', answer: 'Green' },
  { key: 'q4', answer: '' },
] } }
const threeAnswers = typedFrom(answered, NOW)

const replacedBlank = { api: { questions: [
  { key: 'q1', answer: 'Blue' },
  { key: 'q2', answer: 'Red' },
  { key: 'q3', answer: 'Green' },
  { key: 'q5', answer: '' },
] } }
want = judgeCase('the incident: a tool replaces a blank question and keeps the answers', answered, replacedBlank, typedFrom(answered, NOW - 5 * MINUTE))
reasonOf('incident', want, false, '', [])

const q3Removed = { api: { questions: [
  { key: 'q1', answer: 'Blue' },
  { key: 'q2', answer: 'Red' },
  { key: 'q4', answer: '' },
] } }
want = judgeCase('a recent answer removed', answered, q3Removed, typedFrom(answered, NOW - 5 * MINUTE))
reasonOf('recent answer removed', want, true, 'recent', ['api.questions[key:q3].answer'])

// Pins the 10 minute window: a host with a shorter window fails here.
want = judgeCase('the same removal eight minutes later', answered, q3Removed, typedFrom(answered, NOW - 8 * MINUTE))
reasonOf('same removal eight minutes later', want, true, 'recent', ['api.questions[key:q3].answer'])

// And the edge: eleven minutes is outside it.
want = judgeCase('the same removal eleven minutes later', answered, q3Removed, typedFrom(answered, NOW - 11 * MINUTE))
reasonOf('same removal eleven minutes later', want, false, '', ['api.questions[key:q3].answer'])

want = judgeCase('the same removal two hours later', answered, q3Removed, typedFrom(answered, NOW - 2 * HOUR))
reasonOf('same removal two hours later', want, false, '', ['api.questions[key:q3].answer'])

const threeAnswered = { api: { questions: [
  { key: 'q1', answer: 'Blue' },
  { key: 'q2', answer: 'Red' },
  { key: 'q3', answer: 'Green' },
] } }
want = judgeCase('every typed answer removed', threeAnswered, { api: { questions: [] } }, typedFrom(threeAnswered, NOW - 2 * HOUR))
reasonOf('every typed answer removed', want, true, 'all-typed', ['api.questions[key:q1].answer', 'api.questions[key:q2].answer', 'api.questions[key:q3].answer'])

const manyFields = { api: { note: 'kept', a: 'one', b: 'two', c: 'three', d: 'four', e: 'five', f: 'six', g: 'seven', h: 'eight', i: 'nine', j: 'ten' } }
want = judgeCase('ninety percent of the values emptied', manyFields, { api: { note: 'kept' } }, typedFrom({ api: { note: 'kept' } }, NOW - 2 * HOUR))
reasonOf('ninety percent emptied', want, true, 'emptied', [])

const savedNote = { api: { note: 'saved' } }
want = judgeCase('an unreadable document with data', savedNote, null, typedFrom(savedNote, NOW - MINUTE))
reasonOf('unreadable with data', want, true, 'unreadable', [])

want = judgeCase('an unreadable document with no data', { '@form': 'stored' }, null, [])
reasonOf('unreadable with no data', want, false, '', [])

const todoTyped = [
  { path: 'todos[*].text', digest: digestOf('buy milk'), preview: 'buy milk', at: NOW - 20 * MINUTE },
  { path: 'todos[*].done', digest: digestOf(true), preview: 'true', at: NOW - MINUTE },
]
want = judgeCase('an id-less todo removed after a later toggle', { todos: [{ text: 'buy milk', done: true }] }, { todos: [] }, todoTyped)
reasonOf('id-less todo removed', want, true, 'recent', ['todos[*].text', 'todos[*].done'])

const nameTyped = [{ path: 'api.name', digest: digestOf('Alice'), preview: 'Alice', at: NOW - 5 * MINUTE, prev: digestOf('Bob') }]
want = judgeCase('the writer puts back exactly what the person replaced', { api: { name: 'Alice' } }, { api: { name: 'Bob' } }, nameTyped)
reasonOf('revert to prev', want, true, 'recent', ['api.name'])

want = judgeCase('the writer puts a third value in the same place', { api: { name: 'Alice' } }, { api: { name: 'Carol' } }, nameTyped)
reasonOf('third value', want, false, '', [])

const idlessAnswered = { api: { questions: [{ answer: 'Blue' }, { answer: '' }] } }
const idsAdded = { api: { questions: [{ id: 'a', answer: 'Blue' }, { id: 'b', answer: '' }] } }
want = judgeCase('ids added to an answered list with a blank question', idlessAnswered, idsAdded, typedFrom(idlessAnswered, NOW - 2 * HOUR))
reasonOf('ids added', want, false, '', [])

const oneItem = { api: { items: [{ id: 1, note: 'typed' }] } }
want = judgeCase('an add-only write', oneItem, { api: { items: [{ id: 1, note: 'typed' }, { id: 2, note: 'added' }] } }, typedFrom(oneItem, NOW - MINUTE))
reasonOf('add-only write', want, false, '', [])

const twoItems = { api: { items: [{ id: 1, note: 'one' }, { id: 2, note: 'two' }] } }
want = judgeCase('a numeric-id list loses an answered item', twoItems, { api: { items: [{ id: 1, note: 'one' }] } }, typedFrom(twoItems, NOW - 5 * MINUTE))
reasonOf('numeric-id removal', want, true, 'recent', ['api.items[id:2].note'])

want = judgeCase('one value of the same save kept, the other removed', twoItems, { api: { items: [{ id: 1, note: 'one' }, { id: 3, note: 'three' }] } }, typedFrom(twoItems, NOW - MINUTE))
reasonOf('same save', want, true, 'recent', ['api.items[id:2].note'])

// ---------------------------------------------------------------------------
// dropGone — an accepted outside write keeps only the values still in place.
// ---------------------------------------------------------------------------
function dropGoneCase(name, typed, inc) {
  const want = core.dropGone(typed, inc)
  cases.push({ name, op: 'dropGone', typed, inc, want })
  return want
}

want = dropGoneCase('a re-keyed string is kept', [{ path: 'api.items[*].title', digest: digestOf('one'), preview: 'one', at: NOW - MINUTE }], { api: { items: [{ id: 1, title: 'one' }] } })
assert.equal(want.length, 1, 're-keyed string kept')

want = dropGoneCase('a re-keyed boolean is dropped', [{ path: 'api.items[*].done', digest: digestOf(false), preview: 'false', at: NOW - MINUTE }], { api: { items: [{ id: 1, done: false }] } })
assert.equal(want.length, 0, 're-keyed boolean dropped')

want = dropGoneCase('a removed value is dropped', [{ path: 'api.items[id:2].note', digest: digestOf('two'), preview: 'two', at: NOW - MINUTE }], { api: { items: [{ id: 1, note: 'one' }] } })
assert.equal(want.length, 0, 'removed value dropped')

// ---------------------------------------------------------------------------
// putBack — the typed values a loss took, written back into the current page.
// ---------------------------------------------------------------------------
function putBackCase(name, current, gone, recoverable) {
  const want = core.putBack(current, gone, recoverable)
  cases.push({ name, op: 'putBack', current, gone, recoverable, want })
  return want
}

const noteTaken = [{ path: 'api.items[id:1].note', digest: digestOf('typed note'), preview: 'typed note', at: NOW - MINUTE }]
want = putBackCase('a keyed list value is restored beside the writer\'s other change', { api: { items: [{ id: 1, note: '', other: 'changed' }] } }, noteTaken, { api: { items: [{ id: 1, note: 'typed note', other: 'before' }] } })
assert.deepEqual(want.merged, { api: { items: [{ id: 1, note: 'typed note', other: 'changed' }] } }, 'keyed list value restored')
assert.equal(want.placed, 1, 'keyed list placed')

want = putBackCase('a scalar list value is appended', { api: { tags: ['other'] } }, [{ path: 'api.tags[*]', digest: digestOf('typed tag'), preview: 'typed tag', at: NOW - MINUTE }], { api: { tags: ['typed tag'] } })
assert.deepEqual(want.merged, { api: { tags: ['other', 'typed tag'] } }, 'scalar list appended')
assert.equal(want.placed, 1, 'scalar list placed')

want = putBackCase('a value whose item is gone cannot be placed', { api: { items: [{ id: 1, note: 'x' }] } }, [{ path: 'api.items[id:2].note', digest: digestOf('gone'), preview: 'gone', at: NOW - MINUTE }], { api: { items: [{ id: 1, note: 'x' }] } })
assert.deepEqual(want.merged, { api: { items: [{ id: 1, note: 'x' }] } }, 'gone item not placed')
assert.equal(want.placed, 0, 'gone item placed 0')

// ---------------------------------------------------------------------------
// typedLeaves — the values a person could have typed, with their identity paths.
// ---------------------------------------------------------------------------
function leavesCase(name, island) {
  const want = core.typedLeaves(island)
  cases.push({ name, op: 'typedLeaves', island, want })
  return want
}

want = leavesCase('a form answer and a note', { api: { questions: [{ key: 'q1', answer: 'Blue' }], note: 'hi' }, '@form': 'stored' })
assert.deepEqual(pathsOf(want), ['api.questions[key:q1].answer', 'api.note'], 'form leaves')
assert.equal(want[1].digest, digestOf('hi'), 'form leaves digest')
assert.equal(want[1].at, 0, 'form leaves at')

want = leavesCase('a numeric id and a blank value', { items: [{ id: 1, note: 'n', empty: '' }] })
assert.deepEqual(pathsOf(want), ['items[id:1].note'], 'numeric id leaves')

want = leavesCase('an id-less scalar list', { tags: ['a', 'b'] })
assert.deepEqual(pathsOf(want), ['tags[*]', 'tags[*]'], 'scalar list leaves')
assert.deepEqual(want.map(e => e.digest), [digestOf('a'), digestOf('b')], 'scalar list digests')

const destination = fileURLToPath(new URL('../conformance/typed-guard.json', import.meta.url))
writeFileSync(destination, JSON.stringify({ version: 1, now: NOW, cases }, null, 2) + '\n')
console.log(`wrote ${cases.length} typed guard cases`)
