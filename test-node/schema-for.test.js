import test from 'node:test'
import assert from 'node:assert/strict'

import { schemaFor } from '../src/data.js'

// What The Func asks its agent for one review and fills the rest itself
// (design.md 0.2). The shape the agent gets must be exactly the rule's row minus
// those fields, or the host's schema check refuses good answers or accepts bad ones.
const REVIEW = {
  id: '@data-id',
  created: '@data-created',
  title: '.title',
  summary: '.summary',
  agent: '@data-agent',
  folder: '@data-folder',
  level: '@data-level',
  request: '.request',
  mode: '@data-mode',
  base: '@data-base',
  head: '@data-head',
  diff: '.diff',
  files: ['.file', { path: '@data-path', note: '.note', tags: '.tag[]' }],
}
const OMIT = ['diff', 'id', 'created', 'agent', 'folder', 'level', 'request', 'mode', 'base', 'head']

test('the review omit list leaves title, summary and files, all required and closed', () => {
  assert.deepEqual(schemaFor(REVIEW, OMIT), {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'summary', 'files'],
    properties: {
      title: { type: 'string' },
      summary: { type: 'string' },
      files: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['path', 'note', 'tags'],
          properties: {
            path: { type: 'string' },
            note: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
  })
})

test('omit drops top-level keys only, never a nested key of the same name', () => {
  const shape = schemaFor({ title: '.t', files: ['.f', { title: '.ft' }] }, ['title'])
  assert.deepEqual(shape.required, ['files'])
  assert.deepEqual(shape.properties.files.items.required, ['title'])
})

test('a codec rule is left open', () => {
  assert.deepEqual(schemaFor('#grid@codec(sheet)'), {})
})
