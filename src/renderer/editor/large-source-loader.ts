import type { LargeSourceSurface, SourceSelection } from './source-surface'
import { msg } from '../../shared/i18n'

// Keep the full text available to save while the optional editor chunk loads.
export function createLargeSourceSurface(host: HTMLElement, content: string, onInput: () => void): LargeSourceSurface {
  let pending = content
  let selection: SourceSelection = { anchor: 0, head: 0 }
  let focusRequested = false
  let view: LargeSourceSurface | null = null
  let disposed = false
  host.hidden = false
  host.setAttribute('aria-busy', 'true')
  const load = async (): Promise<void> => {
    try {
      const { createLargeSourceView } = await import('./large-source-view')
      if (disposed) return
      host.replaceChildren()
      view = createLargeSourceView(host, pending, onInput)
      pending = ''
      view.select(selection.anchor, selection.head)
      if (focusRequested) view.focus()
      host.setAttribute('aria-busy', 'false')
    } catch {
      if (disposed) return
      host.setAttribute('aria-busy', 'false')
      const retry = document.createElement('button')
      retry.textContent = msg('editor.largeSourceRetry')
      retry.addEventListener('click', () => { retry.disabled = true; void load() }, { once: true })
      host.replaceChildren(retry)
    }
  }
  void load()
  return {
    content: () => view ? view.content() : pending,
    selection: () => view ? view.selection() : selection,
    select(anchor, head) { selection = { anchor, head }; view?.select(anchor, head) },
    replaceSelection(text) {
      if (view) { view.replaceSelection(text); return }
      const from = Math.min(selection.anchor, selection.head), to = Math.max(selection.anchor, selection.head)
      pending = pending.slice(0, from) + text + pending.slice(to)
      selection = { anchor: from + text.length, head: from + text.length }
      onInput()
    },
    focus() { focusRequested = true; view?.focus() },
    setContent(content, preservePosition) {
      if (view) view.setContent(content, preservePosition)
      else { pending = content; if (!preservePosition) selection = { anchor: 0, head: 0 } }
    },
    destroy() { disposed = true; view?.destroy(); view = null; pending = ''; host.replaceChildren(); host.hidden = true },
  }
}
