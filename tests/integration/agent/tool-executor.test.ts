import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { createWorkspaceRoot } from '../../../src/main/workspace/path-guard'
import { createWorkspaceService } from '../../../src/main/workspace/workspace-service'
import { createToolExecutor } from '../../../src/main/agent/tools/executor'
import type { ApprovalBroker } from '../../../src/main/agent/approval-broker'

async function setup(files: Record<string, string> = {}, decision: 'approve' | 'deny' | 'cancel' = 'approve') {
  const root = await mkdtemp(join(tmpdir(), 'draftmd-tools-'))
  for (const [path, content] of Object.entries(files)) await writeFile(join(root, path), content)
  const workspace = createWorkspaceService(await createWorkspaceRoot(root))
  const approval: ApprovalBroker = {
    request: vi.fn().mockResolvedValue({ decision }),
    cancelTask: vi.fn(),
    cancelAll: vi.fn(),
  }
  return { root, workspace, approval, executor: createToolExecutor({ workspace, approval }) }
}

const context = { taskId: '01991d5a-1c00-7000-8000-000000000000', signal: new AbortController().signal }

describe('ToolExecutor', () => {
  it('delegates list, search, and read with structured bounded results', async () => {
    const { executor } = await setup({
      'spec.md': '# Product\nIntro\n## Errors\nBefore\nFailure mode\nAfter\nEnd\n',
      'other.md': '# Other\n',
    })
    await expect(executor.execute({ id: '1', name: 'list_markdown_files', input: {} }, context)).resolves.toMatchObject({
      ok: true, value: { files: [{ path: 'other.md' }, { path: 'spec.md' }] },
    })
    await expect(executor.execute({ id: '2', name: 'search_markdown', input: { query: 'Failure', limit: 3 } }, context)).resolves.toMatchObject({
      ok: true, value: { matches: [{ path: 'spec.md', line: 5, headingPath: ['Product', 'Errors'] }] },
    })
    await expect(executor.execute({ id: '3', name: 'read_markdown', input: { path: 'spec.md', heading: 'Errors' } }, context)).resolves.toMatchObject({
      ok: true, value: { path: 'spec.md', content: '## Errors\nBefore\nFailure mode\nAfter\nEnd\n', version: expect.any(String) },
    })
    await expect(executor.execute({ id: '4', name: 'read_markdown', input: { path: 'spec.md', startLine: 4, endLine: 6 } }, context)).resolves.toMatchObject({
      ok: true, value: { content: 'Before\nFailure mode\nAfter' },
    })
  })

  it('returns CONTENT_TOO_LARGE for an unbounded whole-file read without silent truncation', async () => {
    const content = 'x'.repeat(5 * 1024 * 1024 + 1)
    const { executor } = await setup({ 'large.md': content })
    await expect(executor.execute({ id: '1', name: 'read_markdown', input: { path: 'large.md' } }, context)).resolves.toEqual({
      ok: false, code: 'CONTENT_TOO_LARGE', summary: `File is ${Buffer.byteLength(content)} bytes; request a heading or line range.`,
    })
  })

  it('delegates create, edit, and rename with version conflicts preserved as safe codes', async () => {
    const { root, workspace, executor } = await setup({ 'spec.md': '# Old\n' })
    await expect(executor.execute({ id: '1', name: 'create_markdown', input: { path: 'new.md', content: '# New\n' } }, context)).resolves.toMatchObject({ ok: true })
    const before = await workspace.read('spec.md')
    await expect(executor.execute({ id: '2', name: 'edit_markdown', input: {
      path: 'spec.md', oldText: '# Old', newText: '# Updated', expectedVersion: before.version,
    } }, context)).resolves.toMatchObject({ ok: true })
    await expect(executor.execute({ id: '3', name: 'rename_markdown', input: {
      from: 'spec.md', to: 'renamed.md', expectedVersion: '0'.repeat(64),
    } }, context)).resolves.toEqual({ ok: false, code: 'VERSION_CONFLICT', summary: 'rename_markdown failed: VERSION_CONFLICT' })
    expect(await readFile(join(root, 'renamed.md'), 'utf8').catch(() => null)).toBeNull()
  })

  it.each([
    ['deny', 'USER_DENIED'],
    ['cancel', 'USER_CANCELLED'],
  ] as const)('does not delete after %s decision', async (decision, code) => {
    const { root, workspace, approval, executor } = await setup({ 'old.md': '# Old\n' }, decision)
    const before = await workspace.read('old.md')
    await expect(executor.execute({ id: '1', name: 'delete_markdown', input: {
      path: 'old.md', expectedVersion: before.version, reason: 'Obsolete',
    } }, context)).resolves.toEqual({ ok: false, code, summary: decision === 'deny' ? 'User denied deletion.' : 'Deletion approval was cancelled.' })
    expect(await readFile(join(root, 'old.md'), 'utf8')).toBe('# Old\n')
    expect(approval.request).toHaveBeenCalledWith({ taskId: context.taskId, path: 'old.md', reason: 'Obsolete', expectedVersion: before.version, stale: false })
  })

  it('marks an approval stale when the file changed before the prompt and never deletes it', async () => {
    const { root, workspace, approval, executor } = await setup({ 'old.md': '# Old\n' })
    const before = await workspace.read('old.md')
    await writeFile(join(root, 'old.md'), '# Changed before prompt\n')
    await expect(executor.execute({ id: '1', name: 'delete_markdown', input: {
      path: 'old.md', expectedVersion: before.version, reason: 'Obsolete',
    } }, context)).resolves.toMatchObject({ ok: false, code: 'VERSION_CONFLICT' })
    expect(approval.request).toHaveBeenCalledWith(expect.objectContaining({ stale: true }))
    expect(await readFile(join(root, 'old.md'), 'utf8')).toBe('# Changed before prompt\n')
  })

  it('rechecks the version after approval before deleting', async () => {
    const { root, workspace, approval, executor } = await setup({ 'old.md': '# Old\n' })
    const before = await workspace.read('old.md')
    vi.mocked(approval.request).mockImplementation(async () => {
      await writeFile(join(root, 'old.md'), '# Changed after prompt\n')
      return { decision: 'approve' }
    })

    await expect(executor.execute({ id: '1', name: 'delete_markdown', input: {
      path: 'old.md', expectedVersion: before.version, reason: 'Obsolete',
    } }, context)).resolves.toMatchObject({ ok: false, code: 'VERSION_CONFLICT' })
    expect(await readFile(join(root, 'old.md'), 'utf8')).toBe('# Changed after prompt\n')
  })

  it('deletes only after approval with an unchanged expected version', async () => {
    const { root, workspace, executor } = await setup({ 'old.md': '# Old\n' })
    const before = await workspace.read('old.md')
    await expect(executor.execute({ id: '1', name: 'delete_markdown', input: {
      path: 'old.md', expectedVersion: before.version, reason: 'Obsolete',
    } }, context)).resolves.toMatchObject({ ok: true })
    await expect(readFile(join(root, 'old.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
