import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { createChangeSetService } from '../../../src/main/changes/change-set-service'

async function setup(files: Record<string, string>) {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'draftmd-changes-workspace-'))
  const snapshotsRoot = await mkdtemp(join(tmpdir(), 'draftmd-changes-snapshots-'))
  for (const [path, content] of Object.entries(files)) await writeFile(join(workspaceRoot, path), content)
  const workspace = { id: 'a'.repeat(64), name: 'Project', canonicalPath: workspaceRoot }
  return { workspaceRoot, snapshotsRoot, workspace, service: createChangeSetService(snapshotsRoot) }
}

describe('ChangeSetService', () => {
  it('finalizes an unchanged task with no file changes', async () => {
    const { service, workspace } = await setup({ 'a.md': '# A\n' })
    await service.begin('task-unchanged', workspace)

    await expect(service.finalize('task-unchanged')).resolves.toEqual({
      taskId: 'task-unchanged', workspaceId: workspace.id, changes: [],
    })
  })

  it('classifies created, modified, deleted, and content-preserving renamed files', async () => {
    const { service, workspace, workspaceRoot } = await setup({
      'modified.md': '# Before\n',
      'deleted.md': '# Deleted\n',
      'old.md': '# Renamed\n',
    })
    await service.begin('task-mixed', workspace)
    await writeFile(join(workspaceRoot, 'modified.md'), '# After\n')
    await writeFile(join(workspaceRoot, 'created.md'), '# Created\n')
    await import('node:fs/promises').then(({ rename, unlink }) => Promise.all([
      rename(join(workspaceRoot, 'old.md'), join(workspaceRoot, 'new.md')),
      unlink(join(workspaceRoot, 'deleted.md')),
    ]))

    const result = await service.finalize('task-mixed')

    expect(result.changes.map((change) => change.kind)).toEqual(['created', 'deleted', 'modified', 'renamed'])
    expect(result.changes.find((change) => change.kind === 'modified')).toMatchObject({
      path: 'modified.md', additions: 1, deletions: 1,
    })
    expect(result.changes.find((change) => change.kind === 'renamed')).toMatchObject({
      oldPath: 'old.md', path: 'new.md', additions: 0, deletions: 0,
    })
    expect(result.changes.every((change) => change.patch.includes(`a/${change.oldPath ?? change.path}`))).toBe(true)
  })

  it('reads a finalized change set without recapturing later manual edits', async () => {
    const { service, workspace, workspaceRoot } = await setup({ 'spec.md': '# Before\n' })
    await service.begin('task-read-final', workspace)
    await writeFile(join(workspaceRoot, 'spec.md'), '# Task final\n')
    const finalized = await service.finalize('task-read-final')
    await writeFile(join(workspaceRoot, 'spec.md'), '# Manual later edit\n')

    await expect(service.readFinalized('task-read-final')).resolves.toEqual(finalized)
  })

  it('never captures its own snapshot blobs when storage is inside the workspace', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'draftmd-nested-snapshots-'))
    const snapshotsRoot = join(workspaceRoot, 'app-internal-snapshots')
    await writeFile(join(workspaceRoot, 'spec.md'), '# Before\n')
    const workspace = { id: 'a'.repeat(64), name: 'Project', canonicalPath: workspaceRoot }
    const service = createChangeSetService(snapshotsRoot)
    await service.begin('task-nested', workspace)
    await writeFile(join(workspaceRoot, 'spec.md'), '# After\n')

    const result = await service.finalize('task-nested')
    expect(result.changes).toHaveLength(1)
    expect(result.changes[0]).toMatchObject({ kind: 'modified', path: 'spec.md' })
  })

  it('stores baseline and final bytes privately with mode 0600', async () => {
    const { service, workspace, workspaceRoot, snapshotsRoot } = await setup({ 'spec.md': '# Before\n' })
    await service.begin('task-private', workspace)
    await writeFile(join(workspaceRoot, 'spec.md'), '# After\n')
    await service.finalize('task-private')

    const taskRoot = join(snapshotsRoot, workspace.id, 'task-private')
    const metadata = JSON.parse(await readFile(join(taskRoot, 'metadata.json'), 'utf8'))
    expect(metadata.files['spec.md']).toMatchObject({ baseline: expect.any(String), final: expect.any(String) })
    expect((await stat(join(taskRoot, metadata.files['spec.md'].baseline))).mode & 0o777).toBe(0o600)
    expect((await stat(join(taskRoot, metadata.files['spec.md'].final))).mode & 0o777).toBe(0o600)
    expect((await stat(join(taskRoot, 'metadata.json'))).mode & 0o777).toBe(0o600)
  })

  it('retains final changes for a partial task outcome', async () => {
    const { service, workspace, workspaceRoot } = await setup({ 'spec.md': '# Before\n' })
    await service.begin('task-partial', workspace)
    await writeFile(join(workspaceRoot, 'spec.md'), '# Partially updated\n')

    const result = await service.finalize('task-partial')

    expect(result.changes).toHaveLength(1)
    expect(result.changes[0]).toMatchObject({ kind: 'modified', path: 'spec.md' })
  })
})

it('purges only old unreferenced snapshots during retention cleanup', async () => {
  const { SnapshotStore } = await import('../../../src/main/changes/snapshot-store')
  const { mkdir, stat, utimes } = await import('node:fs/promises')
  const snapshotsRoot = await mkdtemp(join(tmpdir(), 'draftmd-retention-'))
  const workspaceId = 'f'.repeat(64)
  const oldReferenced = join(snapshotsRoot, workspaceId, 'referenced')
  const oldUnreferenced = join(snapshotsRoot, workspaceId, 'expired')
  const recentUnreferenced = join(snapshotsRoot, workspaceId, 'recent')
  await Promise.all([oldReferenced, oldUnreferenced, recentUnreferenced].map((path) => mkdir(path, { recursive: true })))
  const old = new Date('2026-07-01T00:00:00Z')
  await utimes(oldReferenced, old, old)
  await utimes(oldUnreferenced, old, old)
  const store = new SnapshotStore(snapshotsRoot)

  await store.cleanup(new Set(['referenced']), new Date('2026-08-01T00:00:00Z'))

  await expect(stat(oldReferenced)).resolves.toBeDefined()
  await expect(stat(recentUnreferenced)).resolves.toBeDefined()
  await expect(stat(oldUnreferenced)).rejects.toMatchObject({ code: 'ENOENT' })
})
