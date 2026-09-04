import type { BrowserWindow } from 'electron'
import type { TaskStatus } from '../../shared/contracts/agent'
import type { ChangeSetService } from '../changes/change-set-service'
import type { UndoResult } from '../changes/undo-service'

export class TaskActionError extends Error {
  constructor(readonly code: 'TASK_NOT_FOUND' | 'TASK_NOT_UNDOABLE' | 'TASK_STATE_CONFLICT') {
    super(code)
    this.name = 'TaskActionError'
  }
}

interface ActiveWorkspace {
  descriptor: { id: string; name: string }
  root: { canonicalPath: string }
}
interface TaskRecord { id: string; sessionId: string; status: TaskStatus }
interface SessionRecord { id: string; workspaceId: string }

export function createTaskActionService(input: {
  workspaceManager: { current(windowId: number): ActiveWorkspace | null }
  tasks: {
    get(id: string): TaskRecord | null
    transition(id: string, from: TaskStatus, to: TaskStatus, updatedAt: string): boolean
  }
  sessions: { get(id: string): SessionRecord | null }
  changes: ChangeSetService
  undo: { undo(workspace: { id: string; name: string; canonicalPath: string }, taskId: string): Promise<UndoResult> }
  now(): string
}) {
  const owned = (win: BrowserWindow, taskId: string): { task: TaskRecord; workspace: ActiveWorkspace } => {
    const workspace = input.workspaceManager.current(win.id)
    const task = input.tasks.get(taskId)
    const session = task ? input.sessions.get(task.sessionId) : null
    if (!workspace || !task || !session || session.workspaceId !== workspace.descriptor.id) {
      throw new TaskActionError('TASK_NOT_FOUND')
    }
    return { task, workspace }
  }
  return {
    async changes(win: BrowserWindow, taskId: string) {
      owned(win, taskId)
      return input.changes.readFinalized(taskId)
    },
    async undo(win: BrowserWindow, taskId: string): Promise<UndoResult> {
      const { task, workspace } = owned(win, taskId)
      if (task.status !== 'completed' && task.status !== 'partial-complete') {
        throw new TaskActionError('TASK_NOT_UNDOABLE')
      }
      const result = await input.undo.undo({
        id: workspace.descriptor.id,
        name: workspace.descriptor.name,
        canonicalPath: workspace.root.canonicalPath,
      }, taskId)
      const next = result.status === 'undone' ? 'undone' : 'undo-conflict'
      if (!input.tasks.transition(taskId, task.status, next, input.now())) {
        throw new TaskActionError('TASK_STATE_CONFLICT')
      }
      return result
    },
  }
}
