import { expect, it, vi } from 'vitest'
import { createRuntimeRegistry } from '../../../src/main/agent/runtime-registry'

it('forwards queued terminal events before releasing task ownership', async () => {
  const taskId = '01991d5a-1c00-7000-8000-000000000000'
  const events = [
    { taskId, sequence: 0, type: 'change-set', changeSet: { taskId, workspaceId: 'a'.repeat(64), changes: [] } },
    { taskId, sequence: 1, type: 'status', status: 'completed' },
  ] as const
  const sent: unknown[] = []
  const win = { id: 1 } as never
  const handle = {
    events: { async *[Symbol.asyncIterator]() { await Promise.resolve(); yield* events } },
    stop: vi.fn(), respondToApproval: vi.fn(), done: Promise.resolve({ status: 'completed', changeSet: null, errorCode: null }),
  }
  const registry = createRuntimeRegistry({ send: (_win, event) => sent.push(event) })

  registry.register(taskId, win, handle as never)
  await new Promise((resolve) => setTimeout(resolve, 0))

  expect(sent).toEqual(events)
})
