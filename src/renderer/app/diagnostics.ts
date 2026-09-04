import type { DraftMDAPI } from '../../shared/contracts/ipc'
import { msg, type MessageKey } from '../../shared/i18n'
import type { DiagnosticsBundle } from '../../shared/contracts/diagnostics'

const CATEGORY_LABELS: Record<DiagnosticsBundle['categories'][number], MessageKey> = {
  Application: 'diagnostics.category.application',
  'Safe settings': 'diagnostics.category.settings',
  'Provider metadata': 'diagnostics.category.providers',
  'Safe logs': 'diagnostics.category.logs',
  'Database integrity': 'diagnostics.category.database',
}

export function diagnosticsCategoryLabel(category: DiagnosticsBundle['categories'][number]): string {
  return msg(CATEGORY_LABELS[category])
}

export function createDiagnosticsDialog(input: { api: DraftMDAPI }) {
  const dialog = document.createElement('dialog')
  dialog.id = 'diagnostics-dialog'
  dialog.className = 'agent-confirm-dialog'
  dialog.setAttribute('aria-labelledby', 'diagnostics-title')
  document.body.append(dialog)
  const show = async (): Promise<void> => {
    const preview = await input.api.previewDiagnostics()
    dialog.replaceChildren()
    const title = document.createElement('h2'); title.id = 'diagnostics-title'; title.textContent = msg('diagnostics.title')
    const detail = document.createElement('p'); detail.textContent = msg('diagnostics.detail')
    const list = document.createElement('ul')
    for (const category of preview.categories) { const item = document.createElement('li'); item.textContent = diagnosticsCategoryLabel(category); list.append(item) }
    const note = document.createElement('p'); note.textContent = msg('diagnostics.excluded')
    const actions = document.createElement('div'); actions.className = 'agent-confirm-actions'
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = msg('common.cancel'); cancel.addEventListener('click', () => dialog.close())
    const save = document.createElement('button'); save.type = 'button'; save.textContent = msg('diagnostics.export')
    save.addEventListener('click', () => { void input.api.exportDiagnostics().then((exported) => { if (exported) dialog.close() }) })
    actions.append(cancel, save); dialog.append(title, detail, list, note, actions)
    if (!dialog.open) dialog.showModal()
    cancel.focus()
  }
  return { show, dispose() { dialog.remove() } }
}
