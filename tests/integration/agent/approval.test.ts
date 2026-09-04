import { describe, expect, it, vi } from 'vitest'
import { createApprovalBroker } from '../../../src/main/agent/approval-broker'

const request = { taskId: 'task-1', path: 'old.md', reason: '<b>Obsolete</b>', expectedVersion: 'a'.repeat(64) }

it('resolves independent approval items by id', async () => {
  const pending: unknown[] = []
  const persisted: unknown[] = []
  const broker = createApprovalBroker({
    onRequest: (item) => pending.push(item),
    persist: (item) => persisted.push(item),
  })
  const first = broker.request(request)
  const second = broker.request({ ...request, path: 'other.md' })
  const [firstItem, secondItem] = pending as Array<{ id: string }>

  expect(broker.respond(firstItem.id, 'approve')).toBe(true)
  expect(broker.respond(secondItem.id, 'deny')).toBe(true)
  await expect(first).resolves.toEqual({ decision: 'approve' })
  await expect(second).resolves.toEqual({ decision: 'deny' })
  expect(persisted).toHaveLength(4)
})

it('cancels all pending items for a stopped task or app close', async () => {
  const pending: Array<{ id: string }> = []
  const broker = createApprovalBroker({ onRequest: (item) => pending.push(item), persist: vi.fn() })
  const first = broker.request(request)
  const other = broker.request({ ...request, taskId: 'task-2' })

  broker.cancelTask('task-1')
  await expect(first).resolves.toEqual({ decision: 'cancel' })
  broker.cancelAll()
  await expect(other).resolves.toEqual({ decision: 'cancel' })
})

it('emits plain path and reason data without interpreting HTML', () => {
  const onRequest = vi.fn()
  const broker = createApprovalBroker({ onRequest, persist: vi.fn() })
  void broker.request(request)
  expect(onRequest).toHaveBeenCalledWith(expect.objectContaining({
    path: 'old.md', reason: '<b>Obsolete</b>', expectedVersion: 'a'.repeat(64),
  }))
  expect(JSON.stringify(onRequest.mock.calls[0][0])).not.toContain('innerHTML')
})

it('times out pending approval as cancellation', async () => {
  vi.useFakeTimers()
  const broker = createApprovalBroker({ onRequest: vi.fn(), persist: vi.fn(), timeoutMs: 1_000 })
  const result = broker.request(request)
  await vi.advanceTimersByTimeAsync(1_000)
  await expect(result).resolves.toEqual({ decision: 'cancel' })
  vi.useRealTimers()
})
