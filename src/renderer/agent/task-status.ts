import type { ChangeSet } from '../../shared/contracts/changes'
import type { TaskEvent, TaskStatus } from '../../shared/contracts/agent'

export interface TaskViewState {
  taskId: string
  lastSequence: number
  status: TaskStatus | null
  assistantText: string
  activities: TaskEvent[]
  approval: Extract<TaskEvent, { type: 'approval-request' }> | null
  changeSet: ChangeSet | null
  errorCode: string | null
}

export function createTaskViewState(taskId: string): TaskViewState {
  return { taskId, lastSequence: -1, status: null, assistantText: '', activities: [], approval: null, changeSet: null, errorCode: null }
}

export function reduceTaskEvent(state: TaskViewState, event: TaskEvent): TaskViewState {
  if (event.taskId !== state.taskId || event.sequence <= state.lastSequence) return state
  const next = { ...state, lastSequence: event.sequence }
  if (event.type === 'status') { next.status = event.status; if (event.status !== 'waiting-approval') next.approval = null }
  else if (event.type === 'assistant-text-delta') next.assistantText += event.text
  else if (event.type === 'tool-start' || event.type === 'tool-result') next.activities = [...state.activities, event]
  else if (event.type === 'approval-request') next.approval = event
  else if (event.type === 'change-set') next.changeSet = event.changeSet
  else if (event.type === 'error') next.errorCode = event.code
  return next
}
