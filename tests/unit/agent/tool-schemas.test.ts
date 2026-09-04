import { describe, expect, it } from 'vitest'
import {
  parseToolCall,
  ToolCallValidationError,
} from '../../../src/main/agent/tools/schemas'
import { toolDefinitions } from '../../../src/main/agent/tools/definitions'

const version = 'a'.repeat(64)
const valid = [
  ['list_markdown_files', {}],
  ['search_markdown', { query: 'offline', limit: 20 }],
  ['read_markdown', { path: 'docs/spec.md', heading: 'Errors', startLine: 1, endLine: 20 }],
  ['create_markdown', { path: 'new.md', content: '# New\n' }],
  ['edit_markdown', { path: 'spec.md', oldText: 'old', newText: 'new', expectedVersion: version }],
  ['rename_markdown', { from: 'old.md', to: 'new.md', expectedVersion: version }],
  ['delete_markdown', { path: 'old.md', expectedVersion: version, reason: 'Obsolete design' }],
] as const

describe('Markdown Agent tool schemas', () => {
  it.each(valid)('parses exact %s input', (name, input) => {
    expect(parseToolCall({ id: `call-${name}`, name, input })).toMatchObject({ id: `call-${name}`, name, input })
  })

  it.each(valid)('rejects unknown %s input fields', (name, input) => {
    expect(() => parseToolCall({ id: 'call', name, input: { ...input, shell: 'rm -rf /' } })).toThrow(ToolCallValidationError)
  })

  it.each([
    ['list_markdown_files', { path: '.' }],
    ['search_markdown', { query: '', limit: 20 }],
    ['search_markdown', { query: 'x', limit: 51 }],
    ['read_markdown', { path: '../secret.md' }],
    ['read_markdown', { path: 'spec.md', startLine: 0 }],
    ['read_markdown', { path: 'spec.md', startLine: 10, endLine: 2 }],
    ['create_markdown', { path: 'new.md', content: 'x'.repeat(5 * 1024 * 1024 + 1) }],
    ['edit_markdown', { path: 'spec.md', oldText: '', newText: 'new', expectedVersion: version }],
    ['edit_markdown', { path: 'spec.md', oldText: 'old', newText: 'new', expectedVersion: 'stale' }],
    ['rename_markdown', { from: 'old.md', to: 'new.txt', expectedVersion: version }],
    ['delete_markdown', { path: 'old.md', expectedVersion: version, reason: '' }],
    ['run_shell', { command: 'cat spec.md' }],
  ])('rejects invalid %s input %#', (name, input) => {
    expect(() => parseToolCall({ id: 'call', name, input })).toThrow(ToolCallValidationError)
  })

  it('publishes exactly seven deterministic strict provider definitions', () => {
    expect(toolDefinitions.map((tool) => tool.name)).toEqual([
      'list_markdown_files', 'search_markdown', 'read_markdown', 'create_markdown',
      'edit_markdown', 'rename_markdown', 'delete_markdown',
    ])
    expect(toolDefinitions.every((tool) => tool.inputSchema.additionalProperties === false)).toBe(true)
    expect(JSON.stringify(toolDefinitions)).not.toContain('shell')
    expect(JSON.stringify(toolDefinitions)).not.toContain('http')
    expect(JSON.stringify(toolDefinitions)).not.toContain('web')
  })
})
