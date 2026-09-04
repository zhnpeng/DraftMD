import { expect, it } from 'vitest'
import { buildSessionHistory } from '../../../src/main/agent/session-history'

const sessionId = '01991d5a-1c00-7000-8000-000000000001'
const taskId = '01991d5a-1c00-7000-8000-000000000002'

it('returns only safe conversation text and merged structured activity summaries', () => {
  const history = buildSessionHistory({
    messages: [
      { id: 'm1', sessionId, role: 'user', content: [{ type: 'text', text: 'Update it' }], modelSwitch: null, createdAt: '2026-09-01T12:00:00Z' },
      { id: 'switch', sessionId, role: 'system', content: [], modelSwitch: { providerConfigId: '01991d5a-1c00-7000-8000-000000000009' }, createdAt: '2026-09-01T12:00:00.500Z' },
      { id: 'm2', sessionId, role: 'tool', content: [{ type: 'tool-result', id: 'call', content: { fullFile: 'SECRET BODY' } }], modelSwitch: null, createdAt: '2026-09-01T12:00:01Z' },
      { id: 'm3', sessionId, role: 'assistant', content: [{ type: 'text', text: 'Updated.' }], modelSwitch: { authorization: 'Bearer secret' }, createdAt: '2026-09-01T12:00:02Z' },
    ],
    task: { id: taskId, sessionId, status: 'completed', createdAt: '2026-09-01T12:00:00Z', updatedAt: '2026-09-01T12:00:03Z' },
    activities: [
      { id: 'a1', taskId, kind: 'tool-start', payload: { callId: 'call', tool: 'edit_markdown', action: 'edit', path: 'notes.md', summary: 'Edit notes.md', raw: 'SECRET' }, createdAt: '2026-09-01T12:00:01Z' },
      { id: 'a2', taskId, kind: 'tool-result', payload: { callId: 'call', tool: 'edit_markdown', ok: true, code: null, result: { content: 'SECRET BODY' } }, createdAt: '2026-09-01T12:00:02Z' },
    ],
  })
  expect(history).toEqual({
    messages: [
      { role: 'user', text: 'Update it' },
      { role: 'model-switch', providerConfigId: '01991d5a-1c00-7000-8000-000000000009' },
      { role: 'assistant', text: 'Updated.' },
    ],
    latestTask: {
      id: taskId, status: 'completed',
      activities: [{ callId: 'call', tool: 'edit_markdown', action: 'edit', path: 'notes.md', summary: 'Edit notes.md', status: 'success', code: null }],
    },
  })
  expect(JSON.stringify(history)).not.toContain('SECRET')
  expect(JSON.stringify(history)).not.toContain('authorization')
})

it('drops malformed persisted activities instead of exposing raw payloads', () => {
  expect(buildSessionHistory({
    messages: [], task: { id: taskId, sessionId, status: 'failed', createdAt: '', updatedAt: '' },
    activities: [{ id: 'bad', taskId, kind: 'tool-start', payload: { summary: '<script>secret</script>' }, createdAt: '' }],
  })).toEqual({ messages: [], latestTask: { id: taskId, status: 'failed', activities: [] } })
})
