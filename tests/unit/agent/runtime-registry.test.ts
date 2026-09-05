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

it('restores live session events only to the owning window and releases completed requests', async () => {
  const taskId = '01991d5a-1c00-7000-8000-000000000000'
  const sessionId = '01991d5a-1c00-7000-8000-000000000001'
  const registry = createRuntimeRegistry({ send: vi.fn() })
  const stop = vi.fn()
  const delta = { taskId, sequence: 0, type: 'assistant-text-delta', text: 'Partial' } as const
  let finish!: () => void
  const finished = new Promise<void>(resolve => { finish = resolve })
  const events = { async *[Symbol.asyncIterator]() { yield delta; await finished } }
  registry.register(taskId, { id: 1 } as never, {
    events, stop, respondToApproval: () => false,
    done: Promise.resolve({ status: 'completed', changeSet: null, errorCode: null }),
  }, { sessionId, mode: 'suggestion', messages: [{ role: 'user', text: 'Hello' }] })
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(registry.hasActiveSession(sessionId)).toBe(true)
  expect(registry.hasActiveWindow(1)).toBe(true)
  expect(registry.sessionSnapshot(sessionId, 2)).toBeNull()
  expect(registry.sessionSnapshot(sessionId, 1)).toEqual({
    messages: [{ role: 'user', text: 'Hello' }], latestTask: null,
    liveTask: { taskId, mode: 'suggestion', events: [delta] },
  })
  expect(registry.stop(taskId, 2)).toBe(false)
  registry.closeWindow({ id: 1 } as never)
  expect(stop).toHaveBeenCalledOnce()
  finish()
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(registry.hasActiveSession(sessionId)).toBe(false)
})
