import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { createChangeSetService } from '../../../src/main/changes/change-set-service'
import { createTaskRecovery } from '../../../src/main/agent/task-recovery'

async function setup(changed: boolean) {
  const root = await mkdtemp(join(tmpdir(), 'draftmd-recovery-workspace-'))
  const snapshots = await mkdtemp(join(tmpdir(), 'draftmd-recovery-snapshots-'))
  await writeFile(join(root, 'spec.md'), '# Before\n')
  const workspace = { id: 'a'.repeat(64), name: 'Workspace', canonicalPath: root }
  const changeSets = createChangeSetService(snapshots)
  await changeSets.begin('task-1', workspace)
  if (changed) await writeFile(join(root, 'spec.md'), '# Partial\n')
  const provider = { stream: vi.fn() }
  const transitions: unknown[] = []
  const recovery = createTaskRecovery({
    tasks: {
      listInterrupted: () => [{ id: 'task-1', sessionId: 'session-1', status: 'running', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' }],
      transition: (id, from, to) => { transitions.push({ id, from, to }); return true },
    },
    workspaceForTask: async () => workspace,
    changeSets,
    provider,
    cancelPendingApproval: vi.fn(),
  })
  return { recovery, provider, transitions }
}

describe('interrupted task recovery', () => {
  it('marks partial disk changes partial-complete and returns final Diff without model continuation', async () => {
    const test = await setup(true)
    await expect(test.recovery.recover()).resolves.toEqual([{
      taskId: 'task-1', status: 'partial-complete', changeSet: expect.objectContaining({
        taskId: 'task-1', changes: [expect.objectContaining({ path: 'spec.md', kind: 'modified' })],
      }),
    }])
    expect(test.transitions).toEqual([{ id: 'task-1', from: 'running', to: 'partial-complete' }])
    expect(test.provider.stream).not.toHaveBeenCalled()
  })

  it('marks an interrupted task stopped when no disk mutation occurred', async () => {
    const test = await setup(false)
    await expect(test.recovery.recover()).resolves.toEqual([{
      taskId: 'task-1', status: 'stopped', changeSet: null,
    }])
    expect(test.transitions).toEqual([{ id: 'task-1', from: 'running', to: 'stopped' }])
  })

  it('treats every pending delete approval as cancelled during recovery', async () => {
    const test = await setup(false)
    await test.recovery.recover()
    expect(test.recovery.dependencies.cancelPendingApproval).toHaveBeenCalledWith('task-1')
  })
})
