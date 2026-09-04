import { expect, it } from 'vitest'
import { createDeleteApprovalQueue } from '../../../src/renderer/agent/delete-approval'
import type { TaskEvent } from '../../../src/shared/contracts/agent'

const event = (id: string, stale = false): Extract<TaskEvent, { type: 'approval-request' }> => ({
  type: 'approval-request', taskId: '01991d5a-1c00-7000-8000-000000000001', sequence: Number(id),
  approvalId: `approval-${id}`, path: `${id}.md`, reason: 'Obsolete', expectedVersion: 'a'.repeat(64), stale,
})

it('queues unique deletion approvals and advances only the decided item', () => {
  const queue = createDeleteApprovalQueue()
  queue.add(event('1'))
  queue.add(event('2', true))
  queue.add(event('1'))
  expect(queue.current()?.approvalId).toBe('approval-1')
  expect(queue.size).toBe(2)
  expect(queue.resolve('approval-2')).toBe(false)
  expect(queue.resolve('approval-1')).toBe(true)
  expect(queue.current()).toMatchObject({ approvalId: 'approval-2', stale: true })
  expect(queue.resolve('approval-2')).toBe(true)
  expect(queue.current()).toBeNull()
})

it('clears all pending approvals without approving them', () => {
  const queue = createDeleteApprovalQueue()
  queue.add(event('1')); queue.add(event('2'))
  expect(queue.clear().map((item) => item.approvalId)).toEqual(['approval-1', 'approval-2'])
  expect(queue.size).toBe(0)
})
