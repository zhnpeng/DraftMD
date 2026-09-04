import { expect, it } from 'vitest'
import { activityText } from '../../../src/renderer/agent/tool-activity-list'
import type { SessionHistoryDTO } from '../../../src/shared/contracts/agent'

type Activity = NonNullable<SessionHistoryDTO['latestTask']>['activities'][number]

it('formats persisted activity from safe summary and visible status cues', () => {
  const base: Activity = {
    callId: 'call', tool: 'read_markdown', action: 'read', path: 'notes.md',
    summary: 'read notes.md', status: 'running', code: null,
  }
  expect(activityText(base)).toBe('… read notes.md')
  expect(activityText({ ...base, status: 'success' })).toBe('✓ read notes.md')
  expect(activityText({ ...base, status: 'error', code: 'VERSION_CONFLICT' })).toBe('! read notes.md · VERSION_CONFLICT')
})
