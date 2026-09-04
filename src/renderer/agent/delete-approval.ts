import type { DraftMDAPI } from '../../shared/contracts/ipc'
import type { TaskEvent } from '../../shared/contracts/agent'
import { msg } from '../../shared/i18n'

type ApprovalEvent = Extract<TaskEvent, { type: 'approval-request' }>

export function createDeleteApprovalQueue() {
  const items: ApprovalEvent[] = []
  return {
    get size(): number { return items.length },
    add(event: ApprovalEvent): void {
      if (!items.some((item) => item.approvalId === event.approvalId)) items.push(event)
    },
    current(): ApprovalEvent | null { return items[0] ?? null },
    resolve(id: string): boolean {
      if (items[0]?.approvalId !== id) return false
      items.shift()
      return true
    },
    clear(): ApprovalEvent[] { return items.splice(0) },
  }
}

export function renderDeleteApproval(input: {
  container: HTMLElement
  api: DraftMDAPI
  event: ApprovalEvent
  position?: { current: number; total: number }
  onDecision(): void
}): void {
  input.container.replaceChildren()
  input.container.hidden = false
  input.container.setAttribute('role', 'alertdialog')
  input.container.setAttribute('aria-labelledby', 'agent-delete-approval-title')
  const title = document.createElement('strong')
  title.id = 'agent-delete-approval-title'
  title.textContent = input.position && input.position.total > 1
    ? msg('dock.deleteApprovalCount', input.position)
    : msg('dock.deleteApproval')
  const path = document.createElement('code')
  path.textContent = input.event.path
  const reason = document.createElement('p')
  reason.textContent = input.event.reason
  const stale = document.createElement('p')
  stale.className = 'agent-approval-warning'
  stale.textContent = msg('dock.deleteStale')
  stale.hidden = !input.event.stale
  const actions = document.createElement('div')
  actions.className = 'agent-approval-actions'
  const deny = document.createElement('button')
  deny.type = 'button'
  deny.textContent = msg('common.cancel')
  const approve = document.createElement('button')
  approve.type = 'button'
  approve.className = 'destructive'
  approve.textContent = msg('dock.approveDelete')
  const decide = async (decision: 'approve' | 'deny'): Promise<void> => {
    deny.disabled = true
    approve.disabled = true
    const accepted = await input.api.respondToAgentApproval({
      taskId: input.event.taskId, approvalId: input.event.approvalId, decision,
    })
    if (accepted) input.onDecision()
    else { deny.disabled = false; approve.disabled = false }
  }
  deny.addEventListener('click', () => { void decide('deny') })
  approve.addEventListener('click', () => { void decide('approve') })
  actions.append(deny, approve)
  input.container.append(title, path, reason, stale, actions)
  deny.focus()
}
