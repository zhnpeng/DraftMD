import { expect, it, vi } from 'vitest'
import { createTaskActionService } from '../../../src/main/agent/task-actions'

const taskId = '01991d5a-1c00-7000-8000-000000000001'
const sessionId = '01991d5a-1c00-7000-8000-000000000002'
const workspaceId = 'a'.repeat(64)
const task = { id: taskId, sessionId, status: 'completed' as const, createdAt: '', updatedAt: '' }
const session = { id: sessionId, workspaceId, title: 'Task', createdAt: '', updatedAt: '' }

function setup() {
  const tasks = { get: vi.fn(() => task), transition: vi.fn(() => true) }
  const sessions = { get: vi.fn(() => session) }
  const changes = { readFinalized: vi.fn().mockResolvedValue({ taskId, workspaceId, changes: [] }) }
  const undo = { undo: vi.fn().mockResolvedValue({ status: 'undone', files: ['a.md'] }) }
  const workspace = { descriptor: { id: workspaceId, name: 'Workspace' }, root: { canonicalPath: '/work' } }
  const service = createTaskActionService({
    workspaceManager: { current: vi.fn(() => workspace) }, tasks, sessions, changes, undo,
    now: () => '2026-09-01T12:00:00.000Z',
  } as never)
  return { service, tasks, sessions, changes, undo, workspace }
}

it('reads finalized changes only for a task owned by the active workspace', async () => {
  const test = setup()
  await expect(test.service.changes({ id: 7 } as never, taskId)).resolves.toEqual({ taskId, workspaceId, changes: [] })
  test.sessions.get.mockReturnValue({ ...session, workspaceId: 'b'.repeat(64) })
  await expect(test.service.changes({ id: 7 } as never, taskId)).rejects.toMatchObject({ code: 'TASK_NOT_FOUND' })
})

it('undoes a completed task and persists the terminal undo state', async () => {
  const test = setup()
  await expect(test.service.undo({ id: 7 } as never, taskId)).resolves.toEqual({ status: 'undone', files: ['a.md'] })
  expect(test.undo.undo).toHaveBeenCalledWith({ id: workspaceId, name: 'Workspace', canonicalPath: '/work' }, taskId)
  expect(test.tasks.transition).toHaveBeenCalledWith(taskId, 'completed', 'undone', '2026-09-01T12:00:00.000Z')
})

it('persists undo-conflict and rejects non-terminal mutable task states', async () => {
  const test = setup()
  test.undo.undo.mockResolvedValue({ status: 'conflict', files: [{ path: 'a.md', base: 'before', taskFinal: 'after', current: 'manual' }] })
  await expect(test.service.undo({ id: 7 } as never, taskId)).resolves.toMatchObject({ status: 'conflict' })
  expect(test.tasks.transition).toHaveBeenCalledWith(taskId, 'completed', 'undo-conflict', expect.any(String))
  test.tasks.get.mockReturnValue({ ...task, status: 'running' })
  await expect(test.service.undo({ id: 7 } as never, taskId)).rejects.toMatchObject({ code: 'TASK_NOT_UNDOABLE' })
})
