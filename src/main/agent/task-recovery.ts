import type { ChangeSet } from '../../shared/contracts/changes'
import type { TaskStatus } from '../../shared/contracts/agent'
import type { ChangeSetService } from '../changes/change-set-service'
import type { UndoResult } from '../changes/undo-service'
import type { SnapshotWorkspace } from '../changes/snapshot-store'

interface InterruptedTask {
  id: string
  status: Extract<TaskStatus, 'preparing' | 'running' | 'waiting-approval'>
}

export interface InterruptedTaskSummary {
  taskId: string
  status: Extract<TaskStatus, 'partial-complete' | 'stopped'>
  changeSet: ChangeSet | null
}

export interface TaskRecoveryDependencies {
  tasks: {
    listInterrupted(): Array<{ id: string; status: TaskStatus }>
    transition(id: string, from: TaskStatus, to: TaskStatus, updatedAt: string): boolean
  }
  workspaceForTask(task: InterruptedTask): Promise<SnapshotWorkspace>
  changeSets: ChangeSetService
  provider: { stream: unknown }
  cancelPendingApproval(taskId: string): void
  undo?: { undo(workspace: SnapshotWorkspace, taskId: string): Promise<UndoResult> }
}

export function createTaskRecovery(dependencies: TaskRecoveryDependencies) {
  const summaries = new Map<string, InterruptedTaskSummary>()
  const workspaces = new Map<string, SnapshotWorkspace>()
  return {
    dependencies,
    seed(items: InterruptedTaskSummary[], workspaceByTask: Map<string, SnapshotWorkspace>): void {
      for (const item of items) summaries.set(item.taskId, item)
      for (const [taskId, workspace] of workspaceByTask) workspaces.set(taskId, workspace)
    },
    list(): InterruptedTaskSummary[] { return [...summaries.values()] },
    keepInterruptedTask(taskId: string): boolean { return summaries.delete(taskId) },
    async undoInterruptedTask(taskId: string): Promise<UndoResult> {
      const summary = summaries.get(taskId)
      const workspace = workspaces.get(taskId)
      if (!summary || !workspace || !dependencies.undo) throw Object.assign(new Error('Interrupted task not found'), { code: 'TASK_NOT_FOUND' })
      const result = await dependencies.undo.undo(workspace, taskId)
      const next = result.status === 'undone' ? 'undone' : 'undo-conflict'
      dependencies.tasks.transition(taskId, summary.status, next, new Date().toISOString())
      summaries.delete(taskId)
      workspaces.delete(taskId)
      return result
    },
    async recover(): Promise<InterruptedTaskSummary[]> {
      const recovered: InterruptedTaskSummary[] = []
      for (const task of dependencies.tasks.listInterrupted()) {
        dependencies.cancelPendingApproval(task.id)
        if (task.status !== 'preparing' && task.status !== 'running' && task.status !== 'waiting-approval') continue
        const interruptedTask: InterruptedTask = { id: task.id, status: task.status }
        const workspace = await dependencies.workspaceForTask(interruptedTask)
        const changeSet = await dependencies.changeSets.finalize(task.id)
        const hasChanges = changeSet.changes.length > 0
        const status = hasChanges ? 'partial-complete' : 'stopped'
        dependencies.tasks.transition(task.id, task.status, status, new Date().toISOString())
        const summary = { taskId: task.id, status, changeSet: hasChanges ? changeSet : null } as InterruptedTaskSummary
        recovered.push(summary)
        summaries.set(task.id, summary)
        workspaces.set(task.id, workspace)
      }
      return recovered
    },
  }
}
