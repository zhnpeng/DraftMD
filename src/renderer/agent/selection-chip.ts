import type { SelectionReference } from '../../shared/contracts/agent'

function quote(text: string): string {
  const compact = text.trim().replace(/\s+/g, ' ')
  const points = Array.from(compact)
  return points.length > 60 ? `${points.slice(0, 57).join('')}…` : compact
}

export function selectionChipLabel(reference: SelectionReference): string {
  const file = reference.path.split(/[\\/]/).pop() || reference.path
  return [file, reference.headingPath.join(' / '), `“${quote(reference.selectedText)}”`]
    .filter(Boolean)
    .join(' · ')
}

export function renderSelectionChip(input: {
  container: HTMLElement
  reference: SelectionReference | null
  removeLabel: string
  onRemove(): void
}): void {
  input.container.replaceChildren()
  input.container.hidden = !input.reference
  if (!input.reference) return
  const label = document.createElement('span')
  label.className = 'agent-selection-chip-label'
  label.textContent = selectionChipLabel(input.reference)
  const remove = document.createElement('button')
  remove.type = 'button'
  remove.className = 'agent-selection-chip-remove'
  remove.setAttribute('aria-label', input.removeLabel)
  remove.title = input.removeLabel
  remove.textContent = '×'
  remove.addEventListener('click', input.onRemove, { once: true })
  input.container.append(label, remove)
}

export function selectionErrorMessageKey(error: unknown): 'dock.selectionChanged' | 'dock.selectionTooLarge' | null {
  const value = error as { code?: unknown; message?: unknown }
  const code = typeof value?.code === 'string' ? value.code : ''
  const message = typeof value?.message === 'string' ? value.message : ''
  if (code === 'SELECTION_TOO_LARGE' || /\bSELECTION_TOO_LARGE\b/.test(message)) return 'dock.selectionTooLarge'
  if (['SELECTION_STALE', 'SELECTION_NOT_FOUND', 'SELECTION_AMBIGUOUS'].includes(code)
    || /\bSELECTION_(?:STALE|NOT_FOUND|AMBIGUOUS)\b/.test(message)) return 'dock.selectionChanged'
  return null
}
