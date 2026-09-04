import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { buildProviderRequest, ContextLimitError } from '../../../src/main/agent/context-builder'
import { SYSTEM_POLICY } from '../../../src/main/agent/system-prompt'
import {
  normalizeSelectionReference,
  SelectionReferenceSchema,
  validateSelectionReference,
} from '../../../src/main/agent/selection-reference'
import { toolDefinitions } from '../../../src/main/agent/tools/definitions'
import { createWorkspaceRoot } from '../../../src/main/workspace/path-guard'
import { createWorkspaceService } from '../../../src/main/workspace/workspace-service'

const workspace = {
  id: 'a'.repeat(64),
  files: [
    { path: 'z.md', size: 20, mtimeMs: 2 },
    { path: 'a.md', size: 10, mtimeMs: 1 },
  ],
  current: { path: 'a.md', version: 'b'.repeat(64), headingPath: ['Product', 'Errors'] },
}

it('builds minimal deterministic context without unrelated document contents', () => {
  const input = {
    task: { text: 'Update error handling.', selection: null },
    session: { history: [{ role: 'user' as const, provider: null, content: [{ type: 'text' as const, text: 'Prior request' }], providerData: null }] },
    workspace,
    tools: toolDefinitions,
  }
  const first = buildProviderRequest(input)
  const second = buildProviderRequest(input)

  expect(first.system).toBe(SYSTEM_POLICY)
  expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  expect(first.tools.map((tool) => tool.name)).toEqual(toolDefinitions.map((tool) => tool.name))
  const userText = JSON.stringify(first.messages)
  expect(userText.indexOf('a.md')).toBeLessThan(userText.indexOf('z.md'))
  expect(userText).toContain('Update error handling.')
  expect(userText).toContain('Product / Errors')
  expect(userText).not.toContain('# unrelated body')
})

it('includes an explicit selection with anchors and captured version', () => {
  const selection = {
    workspaceId: workspace.id, path: 'a.md', headingPath: ['Errors'], selectedText: 'Handle timeout',
    beforeAnchor: 'Before ', afterAnchor: ' after', sourceMode: false, version: 'b'.repeat(64),
  }
  const request = buildProviderRequest({
    task: { text: 'Improve this.', selection }, session: { history: [] }, workspace, tools: toolDefinitions,
  })
  expect(JSON.stringify(request.messages)).toContain('Handle timeout')
  expect(JSON.stringify(request.messages)).toContain('Before ')
  expect(JSON.stringify(request.messages)).toContain('b'.repeat(64))
})

it('fails explicitly when bounded history cannot fit', () => {
  expect(() => buildProviderRequest({
    task: { text: 'Continue', selection: null },
    session: { history: [{ role: 'user', provider: null, content: [{ type: 'text', text: 'x'.repeat(500) }], providerData: null }] },
    workspace, tools: toolDefinitions, maxHistoryBytes: 100,
  })).toThrow(ContextLimitError)
})

it('system policy states every Agent permission and reliability boundary', () => {
  for (const phrase of [
    'provided tools', 'read before editing', 'expected version', 'focused edits',
    'deletion requires explicit approval', 'Do not use shell', 'Do not use web',
    'Do not invent file contents', 'concise result summary',
  ]) expect(SYSTEM_POLICY).toContain(phrase)
})

describe('SelectionReference', () => {
  it('strictly validates bounded references', () => {
    expect(SelectionReferenceSchema.parse({
      workspaceId: 'a'.repeat(64), path: 'spec.md', headingPath: ['Errors'], selectedText: 'target',
      beforeAnchor: 'before', afterAnchor: 'after', sourceMode: true, version: 'b'.repeat(64),
    })).toBeDefined()
    expect(() => SelectionReferenceSchema.parse({
      workspaceId: 'a'.repeat(64), path: 'spec.md', headingPath: [], selectedText: 'target',
      beforeAnchor: 'x'.repeat(201), afterAnchor: '', sourceMode: true, version: 'b'.repeat(64),
    })).toThrow()
    expect(() => SelectionReferenceSchema.parse({
      workspaceId: 'a'.repeat(64), path: 'spec.md', headingPath: [], selectedText: '界'.repeat(7_000),
      beforeAnchor: '', afterAnchor: '', sourceMode: true, version: 'b'.repeat(64),
    })).toThrow()
  })

  it('requires matching workspace, version, and one anchored selection', () => {
    const reference = SelectionReferenceSchema.parse({
      workspaceId: 'a'.repeat(64), path: 'spec.md', headingPath: ['Errors'], selectedText: 'target',
      beforeAnchor: 'before ', afterAnchor: ' after', sourceMode: false, version: 'b'.repeat(64),
    })
    expect(validateSelectionReference(reference, {
      workspaceId: 'a'.repeat(64), version: 'b'.repeat(64), content: 'before target after',
    })).toEqual({ start: 7, end: 13 })
    expect(() => validateSelectionReference(reference, {
      workspaceId: 'a'.repeat(64), version: 'c'.repeat(64), content: 'before target after',
    })).toThrowError(expect.objectContaining({ code: 'SELECTION_STALE' }))
    expect(() => validateSelectionReference(reference, {
      workspaceId: 'a'.repeat(64), version: 'b'.repeat(64), content: 'before target after and before target after',
    })).toThrowError(expect.objectContaining({ code: 'SELECTION_AMBIGUOUS' }))
  })

  it('normalizes an absolute editor path to a validated workspace-relative reference', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'draftmd-selection-'))
    const absolutePath = join(rootPath, 'notes.md')
    await writeFile(absolutePath, '# Notes\nbefore target after\n')
    const root = await createWorkspaceRoot(rootPath)
    const service = createWorkspaceService(root)
    const current = await service.read('notes.md')
    const reference = SelectionReferenceSchema.parse({
      workspaceId: workspace.id, path: absolutePath, headingPath: ['Notes'], selectedText: 'target',
      beforeAnchor: '# Notes\nbefore ', afterAnchor: ' after\n', sourceMode: true, version: current.version,
    })

    await expect(normalizeSelectionReference(reference, {
      workspaceId: workspace.id, root, workspace: service,
    })).resolves.toEqual({ ...reference, path: 'notes.md' })
  })

  it('rejects a selection when the file changed after capture', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'draftmd-selection-stale-'))
    const absolutePath = join(rootPath, 'notes.md')
    await writeFile(absolutePath, 'before target after')
    const root = await createWorkspaceRoot(rootPath)
    const service = createWorkspaceService(root)
    const captured = await service.read('notes.md')
    await writeFile(absolutePath, 'before changed after')
    const reference = SelectionReferenceSchema.parse({
      workspaceId: workspace.id, path: absolutePath, headingPath: [], selectedText: 'target',
      beforeAnchor: 'before ', afterAnchor: ' after', sourceMode: false, version: captured.version,
    })

    await expect(normalizeSelectionReference(reference, {
      workspaceId: workspace.id, root, workspace: service,
    })).rejects.toMatchObject({ code: 'SELECTION_STALE' })
  })

})
