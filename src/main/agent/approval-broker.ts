import { uuidv7 } from '../persistence/ids'

export interface ApprovalRequest {
  taskId: string
  path: string
  reason: string
  expectedVersion: string
  stale: boolean
}
export interface ApprovalDecision { decision: 'approve' | 'deny' | 'cancel' }
export interface ApprovalItem extends ApprovalRequest {
  id: string
  status: 'pending' | ApprovalDecision['decision']
}
export interface ApprovalBroker {
  request(input: ApprovalRequest): Promise<ApprovalDecision>
  respond(id: string, decision: Exclude<ApprovalDecision['decision'], 'cancel'>): boolean
  subscribe?(listener: (item: ApprovalItem) => void): () => void
  cancelTask(taskId: string): void
  cancelAll(): void
}

export function createApprovalBroker(input: {
  onRequest(item: ApprovalItem): void
  persist(item: ApprovalItem): void
  timeoutMs?: number
}): ApprovalBroker {
  const timeoutMs = input.timeoutMs ?? 5 * 60_000
  const listeners = new Set<(item: ApprovalItem) => void>()
  const pending = new Map<string, {
    item: ApprovalItem
    resolve(decision: ApprovalDecision): void
    timer: ReturnType<typeof setTimeout>
  }>()
  const finish = (id: string, decision: ApprovalDecision['decision']): boolean => {
    const entry = pending.get(id)
    if (!entry) return false
    pending.delete(id)
    clearTimeout(entry.timer)
    const item = { ...entry.item, status: decision }
    input.persist(item)
    entry.resolve({ decision })
    return true
  }
  return {
    request(request) {
      const item: ApprovalItem = { ...request, id: uuidv7(), status: 'pending' }
      return new Promise((resolve) => {
        const timer = setTimeout(() => finish(item.id, 'cancel'), timeoutMs)
        pending.set(item.id, { item, resolve, timer })
        input.persist(item)
        input.onRequest(item)
        for (const listener of listeners) listener(item)
      })
    },
    respond(id, decision) { return finish(id, decision) },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    cancelTask(taskId) {
      for (const [id, entry] of pending) if (entry.item.taskId === taskId) finish(id, 'cancel')
    },
    cancelAll() { for (const id of [...pending.keys()]) finish(id, 'cancel') },
  }
}
