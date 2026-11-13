import assert from 'node:assert/strict'
import test from 'node:test'
import { countRows } from '../src/write.js'

const value = { items: [{ a: [1, 2] }, {}], sheets: [{ rows: [1, 2, 3] }] }
const rules = { items: ['li', { a: 'x[]' }], sheets: '[items=sheets]@codec(sheet)' }

// The copy hosts carried before (hyperclay server-lib/download-merge.js).
function hostCountRows(v) {
  if (Array.isArray(v)) return v.reduce((sum, item) => sum + 1 + hostCountRows(item), 0)
  if (v !== null && typeof v === 'object') return Object.values(v).reduce((sum, item) => sum + hostCountRows(item), 0)
  return 0
}

test('without rules, or under version 1, rows count exactly as the hosts counted them', () => {
  for (const v of [value, [], [[1], [2, [3]]], { a: { b: [1] } }, null, 'x', 7]) {
    assert.equal(countRows(v), hostCountRows(v))
    assert.equal(countRows(v, rules, '1'), hostCountRows(v))
  }
  assert.equal(countRows(value), 8)
})

test('under version 2 a codec key is not counted, and every other key is', () => {
  assert.equal(countRows(value, rules, '2'), 4)
  assert.equal(countRows(value, { ...rules, sheets: { rows: 'td[]' } }, '2'), 8)
  assert.equal(countRows({ sheets: Array.from({ length: 20000 }, () => [1]) }, rules, '2'), 0)
})
