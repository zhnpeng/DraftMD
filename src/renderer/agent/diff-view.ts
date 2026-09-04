import type { ChangeSet, FileChange } from '../../shared/contracts/changes'
import { msg } from '../../shared/i18n'

type Hunk = FileChange['hunks'][number]
export interface DiffRow {
  kind: 'added' | 'removed' | 'context'
  prefix: '+' | '−' | ' '
  text: string
  oldLine: number | null
  newLine: number | null
}

export function diffRows(hunk: Hunk): DiffRow[] {
  let oldLine = hunk.oldStart
  let newLine = hunk.newStart
  const rows: DiffRow[] = []
  for (const line of hunk.lines) {
    if (line.startsWith('\\')) continue
    if (line.startsWith('+')) {
      rows.push({ kind: 'added', prefix: '+', text: line.slice(1), oldLine: null, newLine: newLine++ })
    } else if (line.startsWith('-')) {
      rows.push({ kind: 'removed', prefix: '−', text: line.slice(1), oldLine: oldLine++, newLine: null })
    } else {
      rows.push({ kind: 'context', prefix: ' ', text: line.startsWith(' ') ? line.slice(1) : line, oldLine: oldLine++, newLine: newLine++ })
    }
  }
  return rows
}

export function renderChangeSet(container: HTMLElement, changeSet: ChangeSet, onUndo: () => Promise<void> | void): void {
  container.replaceChildren()
  container.hidden = false
  for (const change of changeSet.changes) {
    const details = document.createElement('details')
    details.className = 'agent-diff-file'
    const summary = document.createElement('summary')
    const badge = document.createElement('span')
    badge.className = `agent-change-badge ${change.kind}`
    badge.textContent = msg(`dock.change.${change.kind}` as 'dock.change.modified')
    const title = document.createElement('span')
    title.textContent = `${change.oldPath ? `${change.oldPath} → ` : ''}${change.path} · +${change.additions} −${change.deletions}`
    summary.append(badge, title)
    const scroll = document.createElement('div')
    scroll.className = 'agent-diff-scroll'
    const code = document.createElement('pre')
    for (const hunk of change.hunks) {
      for (const line of diffRows(hunk)) {
        const row = document.createElement('span')
        row.className = `diff-line ${line.kind}`
        const label = document.createElement('span')
        label.className = 'visually-hidden'
        label.textContent = msg(`diff.line.${line.kind}` as 'diff.line.added')
        const oldNumber = document.createElement('span')
        oldNumber.className = 'diff-line-number'
        oldNumber.textContent = line.oldLine?.toString() ?? ''
        const newNumber = document.createElement('span')
        newNumber.className = 'diff-line-number'
        newNumber.textContent = line.newLine?.toString() ?? ''
        const content = document.createElement('span')
        content.className = 'diff-line-content'
        content.textContent = `${line.prefix}${line.text}`
        row.append(label, oldNumber, newNumber, content)
        code.appendChild(row)
      }
    }
    scroll.append(code)
    details.append(summary, scroll)
    container.appendChild(details)
  }
  const undo = document.createElement('button')
  undo.type = 'button'
  undo.className = 'agent-undo-task'
  undo.textContent = msg('dock.undoTask')
  undo.addEventListener('click', () => {
    undo.disabled = true
    Promise.resolve(onUndo()).catch(() => { undo.disabled = false })
  })
  container.appendChild(undo)
}
