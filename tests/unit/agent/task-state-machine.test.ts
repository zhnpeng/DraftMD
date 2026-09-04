import { describe, expect, it } from 'vitest'
import {
  TaskEventSchema,
  TaskStatusSchema,
  type TaskStatus,
} from '../../../src/shared/contracts/agent'
import {
  TaskStateError,
  transitionTask,
} from '../../../src/main/agent/task-state-machine'

const allowed: Array<[TaskStatus, TaskStatus, boolean?]> = [
  ['preparing', 'running'],
  ['preparing', 'stopped'],
  ['preparing', 'failed'],
  ['running', 'waiting-approval'],
  ['waiting-approval', 'running'],
  ['waiting-approval', 'stopped'],
  ['waiting-approval', 'failed'],
  ['waiting-approval', 'partial-complete', true],
  ['running', 'completed'],
  ['running', 'partial-complete', true],
  ['running', 'stopped'],
  ['running', 'failed'],
  ['completed', 'undone'],
  ['completed', 'undo-conflict'],
  ['partial-complete', 'undone'],
  ['partial-complete', 'undo-conflict'],
]

const statuses = TaskStatusSchema.options

describe('task state transitions', () => {
  it.each(allowed)('allows %s → %s', (current, next, hasMutations = false) => {
    expect(transitionTask(current, { type: 'transition', next, hasMutations })).toBe(next)
  })

  it('requires partial-complete rather than failed or stopped after mutations', () => {
    expect(() => transitionTask('running', { type: 'transition', next: 'failed', hasMutations: true })).toThrow(TaskStateError)
    expect(() => transitionTask('running', { type: 'transition', next: 'stopped', hasMutations: true })).toThrow(TaskStateError)
    expect(transitionTask('running', { type: 'transition', next: 'partial-complete', hasMutations: true })).toBe('partial-complete')
  })

  it('rejects every transition not listed in the lifecycle graph', () => {
    const allowedKeys = new Set(allowed.map(([from, to]) => `${from}->${to}`))
    for (const from of statuses) {
      for (const to of statuses) {
        if (allowedKeys.has(`${from}->${to}`)) continue
        expect(() => transitionTask(from, { type: 'transition', next: to, hasMutations: false }), `${from}->${to}`).toThrow(TaskStateError)
      }
    }
  })

  it.each(['completed', 'partial-complete', 'stopped', 'failed', 'undone', 'undo-conflict'] as TaskStatus[])(
    'keeps terminal status %s immutable except explicit undo outcomes',
    (status) => {
      const allowedUndo = status === 'completed' || status === 'partial-complete'
      for (const next of statuses) {
        if (allowedUndo && (next === 'undone' || next === 'undo-conflict')) continue
        expect(() => transitionTask(status, { type: 'transition', next, hasMutations: false })).toThrow(TaskStateError)
      }
    },
  )

  it('exposes only status values in transition errors', () => {
    let thrown: unknown
    try { transitionTask('failed', { type: 'transition', next: 'running', hasMutations: false }) } catch (error) { thrown = error }
    expect(thrown).toMatchObject({ current: 'failed', next: 'running' })
    expect(JSON.stringify(thrown)).not.toContain('document')
    expect(JSON.stringify(thrown)).not.toContain('content')
  })
})

describe('TaskEventSchema', () => {
  const base = { taskId: '01991d5a-1c00-7000-8000-000000000000', sequence: 0 }

  it.each([
    { ...base, type: 'status', status: 'running' },
    { ...base, type: 'assistant-text-delta', text: 'Working…' },
    { ...base, type: 'tool-start', callId: 'call-1', tool: 'read_markdown', action: 'read', path: 'spec.md', summary: 'Reading spec.md' },
    { ...base, type: 'tool-result', callId: 'call-1', tool: 'read_markdown', ok: true, code: null, summary: 'Read spec.md' },
    { ...base, type: 'approval-request', approvalId: 'approval-1', path: 'old.md', reason: 'Obsolete design', expectedVersion: 'a'.repeat(64), stale: false },
    { ...base, type: 'usage', inputTokens: 10, outputTokens: 4, cachedInputTokens: 2 },
    { ...base, type: 'error', code: 'LIMIT_REACHED', retryable: false },
    { ...base, type: 'change-set', changeSet: { taskId: base.taskId, workspaceId: 'b'.repeat(64), changes: [] } },
  ])('accepts strict serializable event $type', (event) => {
    expect(TaskEventSchema.parse(event)).toEqual(event)
  })

  it('requires non-negative monotonic sequence fields and exact event shapes', () => {
    expect(() => TaskEventSchema.parse({ ...base, sequence: -1, type: 'status', status: 'running' })).toThrow()
    expect(() => TaskEventSchema.parse({ ...base, type: 'status', status: 'running', content: 'private body' })).toThrow()
  })

  it('keeps tool events to safe summaries without complete file content', () => {
    expect(() => TaskEventSchema.parse({
      ...base, type: 'tool-result', callId: '1', tool: 'read_markdown', ok: true,
      code: null, summary: 'Read file', content: '# private document',
    })).toThrow()
  })
})
