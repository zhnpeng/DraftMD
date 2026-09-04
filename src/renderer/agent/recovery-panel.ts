import type { DraftMDAPI } from '../../shared/contracts/ipc'
import type { InterruptedTaskSummaryDTO } from '../../shared/contracts/agent'
import { msg } from '../../shared/i18n'

export function renderRecovery(container: HTMLElement, api: DraftMDAPI, summaries: InterruptedTaskSummaryDTO[], onDiff: (summary: InterruptedTaskSummaryDTO) => void): void {
  container.innerHTML = ''
  container.hidden = summaries.length === 0
  for (const summary of summaries) {
    const item = document.createElement('section')
    const title = document.createElement('strong'); title.textContent = msg('dock.interrupted')
    const view = document.createElement('button'); view.textContent = msg('dock.viewChanges'); view.addEventListener('click', () => onDiff(summary))
    const keep = document.createElement('button'); keep.textContent = msg('dock.keepChanges'); keep.addEventListener('click', () => { void api.keepInterruptedTask(summary.taskId); item.remove() })
    const undo = document.createElement('button'); undo.textContent = msg('dock.undoTask'); undo.addEventListener('click', () => { void api.undoInterruptedTask(summary.taskId); item.remove() })
    item.append(title, view, keep, undo); container.appendChild(item)
  }
}
