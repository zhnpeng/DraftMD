import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { createChangeSetService } from '../../../src/main/changes/change-set-service'
import { createUndoService } from '../../../src/main/changes/undo-service'

async function setup(files: Record<string, string>) {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'draftmd-undo-workspace-'))
  const snapshotsRoot = await mkdtemp(join(tmpdir(), 'draftmd-undo-snapshots-'))
  for (const [path, content] of Object.entries(files)) await writeFile(join(workspaceRoot, path), content)
  const workspace = { id: 'b'.repeat(64), name: 'Project', canonicalPath: workspaceRoot }
  const changes = createChangeSetService(snapshotsRoot)
  const undo = createUndoService(snapshotsRoot)
  return { workspaceRoot, workspace, changes, undo }
}

describe('UndoService', () => {
  it('exactly restores an untouched task modification', async () => {
    const { workspaceRoot, workspace, changes, undo } = await setup({ 'spec.md': 'before\n' })
    await changes.begin('modify', workspace)
    await writeFile(join(workspaceRoot, 'spec.md'), 'after\n')
    await changes.finalize('modify')

    await expect(undo.undo(workspace, 'modify')).resolves.toEqual({ status: 'undone', files: ['spec.md'] })
    expect(await readFile(join(workspaceRoot, 'spec.md'), 'utf8')).toBe('before\n')
  })

  it('removes an untouched file created by the task', async () => {
    const { workspaceRoot, workspace, changes, undo } = await setup({})
    await changes.begin('create', workspace)
    await writeFile(join(workspaceRoot, 'new.md'), 'created\n')
    await changes.finalize('create')

    await expect(undo.undo(workspace, 'create')).resolves.toEqual({ status: 'undone', files: ['new.md'] })
    await expect(stat(join(workspaceRoot, 'new.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('reports a conflict rather than deleting a hand-edited created file', async () => {
    const { workspaceRoot, workspace, changes, undo } = await setup({})
    await changes.begin('create-conflict', workspace)
    await writeFile(join(workspaceRoot, 'new.md'), 'created\n')
    await changes.finalize('create-conflict')
    await writeFile(join(workspaceRoot, 'new.md'), 'hand edited\n')

    const result = await undo.undo(workspace, 'create-conflict')

    expect(result).toMatchObject({ status: 'conflict', files: [{ path: 'new.md' }] })
    expect(await readFile(join(workspaceRoot, 'new.md'), 'utf8')).toBe('hand edited\n')
  })

  it('three-way merges unrelated edits made after the task', async () => {
    const { workspaceRoot, workspace, changes, undo } = await setup({
      'spec.md': 'title\nalpha\nmiddle\nomega\n',
    })
    await changes.begin('merge', workspace)
    await writeFile(join(workspaceRoot, 'spec.md'), 'title\nALPHA\nmiddle\nomega\n')
    await changes.finalize('merge')
    await writeFile(join(workspaceRoot, 'spec.md'), 'title\nALPHA\nmiddle\nOMEGA\n')

    await expect(undo.undo(workspace, 'merge')).resolves.toEqual({ status: 'undone', files: ['spec.md'] })
    expect(await readFile(join(workspaceRoot, 'spec.md'), 'utf8')).toBe('title\nalpha\nmiddle\nOMEGA\n')
  })

  it('leaves overlapping hand edits unchanged and never writes conflict markers', async () => {
    const { workspaceRoot, workspace, changes, undo } = await setup({ 'spec.md': 'before\n' })
    await changes.begin('overlap', workspace)
    await writeFile(join(workspaceRoot, 'spec.md'), 'task final\n')
    await changes.finalize('overlap')
    await writeFile(join(workspaceRoot, 'spec.md'), 'hand final\n')

    const result = await undo.undo(workspace, 'overlap')

    expect(result).toMatchObject({ status: 'conflict', files: [{
      path: 'spec.md', base: 'before\n', taskFinal: 'task final\n', current: 'hand final\n',
    }] })
    const disk = await readFile(join(workspaceRoot, 'spec.md'), 'utf8')
    expect(disk).toBe('hand final\n')
    expect(disk).not.toContain('<<<<<<<')
  })

  it('restores a task-deleted file from its baseline', async () => {
    const { workspaceRoot, workspace, changes, undo } = await setup({ 'old.md': 'original\n' })
    await changes.begin('delete', workspace)
    await import('node:fs/promises').then(({ unlink }) => unlink(join(workspaceRoot, 'old.md')))
    await changes.finalize('delete')

    await expect(undo.undo(workspace, 'delete')).resolves.toEqual({ status: 'undone', files: ['old.md'] })
    expect(await readFile(join(workspaceRoot, 'old.md'), 'utf8')).toBe('original\n')
  })

  it('restores a rename only when both paths remain safe', async () => {
    const { workspaceRoot, workspace, changes, undo } = await setup({ 'old.md': 'original\n' })
    await changes.begin('rename', workspace)
    await import('node:fs/promises').then(({ rename }) => rename(join(workspaceRoot, 'old.md'), join(workspaceRoot, 'new.md')))
    await changes.finalize('rename')

    await expect(undo.undo(workspace, 'rename')).resolves.toEqual({ status: 'undone', files: ['new.md'] })
    expect(await readFile(join(workspaceRoot, 'old.md'), 'utf8')).toBe('original\n')
    await expect(stat(join(workspaceRoot, 'new.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
