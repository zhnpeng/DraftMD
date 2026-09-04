import type { TaskStatus } from '../../shared/contracts/agent'

export interface TaskTransitionEvent {
  type: 'transition'
  next: TaskStatus
  hasMutations: boolean
}

export class TaskStateError extends Error {
  constructor(readonly current: TaskStatus, readonly next: TaskStatus) {
    super(`Invalid task transition: ${current} -> ${next}`)
    this.name = 'TaskStateError'
  }
  toJSON(): { current: TaskStatus; next: TaskStatus } {
    return { current: this.current, next: this.next }
  }
}

const allowed: Record<TaskStatus, readonly TaskStatus[]> = {
  preparing: ['running', 'stopped', 'failed'],
  running: ['waiting-approval', 'completed', 'partial-complete', 'stopped', 'failed'],
  'waiting-approval': ['running', 'partial-complete', 'stopped', 'failed'],
  completed: ['undone', 'undo-conflict'],
  'partial-complete': ['undone', 'undo-conflict'],
  stopped: [],
  failed: [],
  undone: [],
  'undo-conflict': [],
}

export function transitionTask(current: TaskStatus, event: TaskTransitionEvent): TaskStatus {
  if (!allowed[current].includes(event.next)) throw new TaskStateError(current, event.next)
  if (event.hasMutations && (event.next === 'failed' || event.next === 'stopped')) {
    throw new TaskStateError(current, event.next)
  }
  if (!event.hasMutations && event.next === 'partial-complete') throw new TaskStateError(current, event.next)
  return event.next
}
