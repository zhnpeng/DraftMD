import type { UndoResultDTO } from '../../shared/contracts/changes'
import { msg } from '../../shared/i18n'

type Conflict = Extract<UndoResultDTO, { status: 'conflict' }>['files'][number]

export function renderUndoConflicts(input: {
  container: HTMLElement
  files: Conflict[]
  onOpen(path: string): void
  onDismiss(): void
}): void {
  input.container.replaceChildren()
  input.container.hidden = false
  const title = document.createElement('strong')
  title.textContent = msg('dock.undoConflictTitle')
  const description = document.createElement('p')
  description.textContent = msg('dock.undoConflictBody')
  input.container.append(title, description)
  for (const file of input.files) {
    const details = document.createElement('details')
    details.className = 'agent-undo-conflict'
    const summary = document.createElement('summary')
    summary.textContent = file.path
    const versions = document.createElement('div')
    versions.className = 'agent-conflict-versions'
    for (const [labelKey, content] of [
      ['dock.undoBase', file.base], ['dock.undoTaskFinal', file.taskFinal], ['dock.undoCurrent', file.current],
    ] as const) {
      const section = document.createElement('section')
      const label = document.createElement('h4')
      label.textContent = msg(labelKey)
      const pre = document.createElement('pre')
      pre.textContent = content
      section.append(label, pre)
      versions.append(section)
    }
    const actions = document.createElement('div')
    const keep = document.createElement('button')
    keep.type = 'button'
    keep.textContent = msg('dock.keepCurrent')
    keep.addEventListener('click', input.onDismiss)
    const open = document.createElement('button')
    open.type = 'button'
    open.textContent = msg('dock.openConflictFile')
    open.addEventListener('click', () => input.onOpen(file.path))
    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.textContent = msg('common.cancel')
    cancel.addEventListener('click', input.onDismiss)
    actions.append(keep, open, cancel)
    details.append(summary, versions, actions)
    input.container.append(details)
  }
}
