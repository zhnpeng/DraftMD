import { describe, expect, it } from 'vitest'
import { scheduleToolCalls } from '../../../src/main/agent/tool-scheduler'
import type { ParsedToolCall } from '../../../src/main/agent/tools/schemas'

const context = { taskId: 'task', signal: new AbortController().signal }

it('starts adjacent read-only calls concurrently and preserves result order', async () => {
  const calls: ParsedToolCall[] = [
    { id: 'a', name: 'read_markdown', input: { path: 'a.md' } },
    { id: 'b', name: 'search_markdown', input: { query: 'x' } },
  ]
  const started: string[] = []
  const resolvers = new Map<string, () => void>()
  const execution = scheduleToolCalls(calls, async (call) => {
    started.push(call.id)
    await new Promise<void>((resolve) => resolvers.set(call.id, resolve))
    return { ok: true, value: { id: call.id } }
  }, context)
  await Promise.resolve()
  expect(started).toEqual(['a', 'b'])
  resolvers.get('b')?.(); resolvers.get('a')?.()
  await expect(execution).resolves.toEqual([
    { ok: true, value: { id: 'a' } }, { ok: true, value: { id: 'b' } },
  ])
})

it('executes mutations strictly in model order', async () => {
  const calls: ParsedToolCall[] = [
    { id: 'a', name: 'create_markdown', input: { path: 'a.md', content: '# A' } },
    { id: 'b', name: 'create_markdown', input: { path: 'b.md', content: '# B' } },
  ]
  const timeline: string[] = []
  await scheduleToolCalls(calls, async (call) => {
    timeline.push(`start:${call.id}`)
    await Promise.resolve()
    timeline.push(`end:${call.id}`)
    return { ok: true, value: { id: call.id } }
  }, context)
  expect(timeline).toEqual(['start:a', 'end:a', 'start:b', 'end:b'])
})
