import { describe, expect, it, vi } from 'vitest'
import { createTaskRecovery } from '../../../src/main/agent/task-recovery'

it('keeps interrupted changes without invoking provider or undo', async () => {
  const undo = { undo: vi.fn() }
  const recovery = createTaskRecovery({
    tasks: { listInterrupted: () => [], transition: vi.fn(() => true) },
    workspaceForTask: vi.fn(), changeSets: {} as never, provider: { stream: vi.fn() },
    cancelPendingApproval: vi.fn(), undo,
  })
  recovery.seed([{ taskId: 'task-1', status: 'partial-complete', changeSet: { taskId: 'task-1', workspaceId: 'a'.repeat(64), changes: [] } }], new Map([
    ['task-1', { id: 'a'.repeat(64), name: 'Workspace', canonicalPath: '/work' }],
  ]))

  expect(recovery.keepInterruptedTask('task-1')).toBe(true)
  expect(recovery.list()).toEqual([])
  expect(undo.undo).not.toHaveBeenCalled()
  expect(recovery.dependencies.provider.stream).not.toHaveBeenCalled()
})

it.each([
  [{ status: 'undone', files: ['spec.md'] }, 'undone'],
  [{ status: 'conflict', files: [{ path: 'spec.md', base: '', taskFinal: '', current: '' }] }, 'undo-conflict'],
] as const)('maps interrupted undo result %# to %s', async (undoResult, taskStatus) => {
  const transition = vi.fn(() => true)
  const undo = { undo: vi.fn().mockResolvedValue(undoResult) }
  const workspace = { id: 'a'.repeat(64), name: 'Workspace', canonicalPath: '/work' }
  const recovery = createTaskRecovery({
    tasks: { listInterrupted: () => [], transition }, workspaceForTask: vi.fn(),
    changeSets: {} as never, provider: { stream: vi.fn() }, cancelPendingApproval: vi.fn(), undo,
  })
  recovery.seed([{ taskId: 'task-1', status: 'partial-complete', changeSet: { taskId: 'task-1', workspaceId: workspace.id, changes: [] } }], new Map([['task-1', workspace]]))

  await expect(recovery.undoInterruptedTask('task-1')).resolves.toEqual(undoResult)
  expect(transition).toHaveBeenCalledWith('task-1', 'partial-complete', taskStatus, expect.any(String))
  expect(recovery.list()).toEqual([])
})
