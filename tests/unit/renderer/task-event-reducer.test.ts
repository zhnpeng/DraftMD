import { expect, it } from 'vitest'
import { createTaskViewState, reduceTaskEvent } from '../../../src/renderer/agent/task-status'

it('applies ordered task events and ignores duplicates or stale sequences', () => {
  let state = createTaskViewState('01991d5a-1c00-7000-8000-000000000000')
  state = reduceTaskEvent(state, { taskId: state.taskId, sequence: 0, type: 'status', status: 'running' })
  state = reduceTaskEvent(state, { taskId: state.taskId, sequence: 1, type: 'assistant-text-delta', text: '<script>bad()</script>' })
  state = reduceTaskEvent(state, { taskId: state.taskId, sequence: 1, type: 'assistant-text-delta', text: 'duplicate' })
  state = reduceTaskEvent(state, { taskId: state.taskId, sequence: 2, type: 'tool-start', callId: '1', tool: 'read_markdown', action: 'read', path: 'spec.md', summary: 'read spec.md' })
  expect(state.status).toBe('running')
  expect(state.assistantText).toBe('<script>bad()</script>')
  expect(state.activities).toHaveLength(1)
  expect(state.lastSequence).toBe(2)
})
