import type { SessionHistoryDTO, TaskEvent } from '../../shared/contracts/agent'

type PersistedActivity = NonNullable<SessionHistoryDTO['latestTask']>['activities'][number]

export function activityText(activity: PersistedActivity): string {
  const cue = activity.status === 'running' ? '…' : activity.status === 'success' ? '✓' : '!'
  return `${cue} ${activity.summary}${activity.status === 'error' && activity.code ? ` · ${activity.code}` : ''}`
}

export function renderPersistedActivity(container: HTMLElement, activity: PersistedActivity): void {
  const row = document.createElement('div')
  row.className = `agent-activity ${activity.status}`
  row.textContent = activityText(activity)
  container.appendChild(row)
}

export function renderActivity(container: HTMLElement, event: Extract<TaskEvent, { type: 'tool-start' | 'tool-result' }>): void {
  const row = document.createElement('div')
  row.className = `agent-activity ${event.type === 'tool-start' ? 'running' : event.ok ? 'success' : 'error'}`
  const cue = event.type === 'tool-start' ? '…' : event.ok ? '✓' : '!'
  row.textContent = `${cue} ${event.summary}`
  container.appendChild(row)
}
