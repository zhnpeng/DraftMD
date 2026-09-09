import { msg } from '../../shared/i18n'
import type { EditorUpdateOrigin } from '../editor/update-origin'
import type { LargeSourceSurface, SourceSurface } from '../editor/source-surface'
import { setActiveSourceSurface } from '../editor/source-surface'
import { mapTextRange } from '../editor/selection-reference'

export interface EditorAdapter {
  getMarkdown(): string
  setMarkdown(content: string, origin: EditorUpdateOrigin, resetHistory?: boolean, preserveSelection?: boolean): void
}

export interface SourceExportState {
  sourceMode: boolean
  value: string
  scrollTop: number
  selectionStart: number
  selectionEnd: number
  focused: boolean
  documentGeneration: number
  sourceSession: number
  exportVersion: number
}

export const REDUCED_RENDERING_THRESHOLD_BYTES = 2 * 1024 * 1024

export interface SourceModeController {
  currentContent(): string
  selection(): { anchor: number; head: number }
  setContent(content: string): void
  setContentWithPosition(content: string): void
  setContentPreservingMode(content: string): void
  isSourceMode(): boolean
  isReducedRendering(): boolean
  toggle(): void
  suspendForExport(): SourceExportState
  restoreAfterExport(state: SourceExportState): void
  notifyVisualUserEdit(): void
  onSourceInput(callback: () => void): () => void
  dispose(): void
}

function scrollRatio(element: HTMLElement): number {
  const range = element.scrollHeight - element.clientHeight
  return range > 0 ? element.scrollTop / range : 0
}

function restoreScrollRatio(element: HTMLElement, ratio: number): void {
  requestAnimationFrame(() => {
    const range = element.scrollHeight - element.clientHeight
    element.scrollTop = Math.max(0, Math.min(range, range * ratio))
  })
}

export function createSourceModeController(input: {
  editorElement: HTMLElement
  sourceElement: HTMLTextAreaElement
  toggleButton: HTMLButtonElement
  editor: EditorAdapter
  createLargeSurface?(content: string, onInput: () => void): LargeSourceSurface
  activeElement?(): Element | null
  documentGeneration?(): number
  onReducedRenderingChanged?(reduced: boolean): void
}): SourceModeController {
  let sourceMode = false
  let reducedRendering = false
  let sourceSession = 0
  let exportVersion = 0
  let large: LargeSourceSurface | null = null
  const textarea: SourceSurface = {
    content: () => input.sourceElement.value,
    selection: () => input.sourceElement.selectionDirection === 'backward'
      ? { anchor: input.sourceElement.selectionEnd, head: input.sourceElement.selectionStart }
      : { anchor: input.sourceElement.selectionStart, head: input.sourceElement.selectionEnd },
    select(anchor, head) { input.sourceElement.setSelectionRange(Math.min(anchor, head), Math.max(anchor, head), anchor > head ? 'backward' : 'forward') },
    replaceSelection(text) { input.sourceElement.setRangeText(text, input.sourceElement.selectionStart, input.sourceElement.selectionEnd, 'end'); handleInput() },
    focus: () => input.sourceElement.focus(),
  }
  const destroyLarge = (): void => { large?.destroy(); large = null }

  const sourceListeners = new Set<() => void>()

  const updateToggle = (): void => {
    input.toggleButton.classList.toggle('active', sourceMode)
    const label = msg(sourceMode ? 'editor.visual' : 'editor.source')
    input.toggleButton.setAttribute('aria-label', label)
    const tip = input.toggleButton.querySelector('.toolbar-tip')
    if (tip) tip.textContent = label
  }
  const enter = (content: string, ratio = 0): void => {
    destroyLarge()
    setActiveSourceSurface(textarea)
    sourceMode = true
    sourceSession += 1
    input.editorElement.classList.add('hidden')
    input.sourceElement.classList.add('visible')
    input.sourceElement.value = content
    restoreScrollRatio(input.sourceElement, ratio)
    updateToggle()
  }
  const exit = (): void => {
    setActiveSourceSurface(null)
    sourceMode = false
    input.editorElement.classList.remove('hidden')
    input.sourceElement.classList.remove('visible')
    updateToggle()
  }
  const toggle = (): void => {
    if (reducedRendering) return
    if (sourceMode) {
      const content = input.sourceElement.value
      const ratio = scrollRatio(input.sourceElement)
      exit()
      input.editor.setMarkdown(content, 'programmatic', false)
      restoreScrollRatio(input.editorElement, ratio)
    } else {
      enter(input.editor.getMarkdown(), scrollRatio(input.editorElement))
    }
  }
  const setReducedRendering = (next: boolean): void => {
    if (reducedRendering === next) return
    reducedRendering = next
    input.toggleButton.disabled = next
    input.toggleButton.setAttribute('aria-disabled', String(next))
    input.onReducedRenderingChanged?.(next)
  }
  const isLargeDocument = (content: string): boolean => new TextEncoder().encode(content).byteLength >= REDUCED_RENDERING_THRESHOLD_BYTES
  const enterReducedRendering = (content: string): void => {
    setReducedRendering(true)
    if (!input.createLargeSurface) { enter(content, scrollRatio(input.sourceElement)); return }
    destroyLarge()
    sourceMode = true
    sourceSession += 1
    input.editorElement.classList.add('hidden')
    input.sourceElement.classList.remove('visible')
    input.sourceElement.value = ''
    large = input.createLargeSurface(content, handleInput)
    setActiveSourceSurface(large)
    updateToggle()
  }
  const leaveReducedRendering = (): void => { destroyLarge(); setReducedRendering(false) }
  const handleClick = (): void => toggle()
  const handleInput = (): void => sourceListeners.forEach((listener) => listener())
  input.toggleButton.addEventListener('click', handleClick)
  input.sourceElement.addEventListener('input', handleInput)
  updateToggle()

  return {
    currentContent: () => large ? large.content() : sourceMode ? input.sourceElement.value : input.editor.getMarkdown(),
    selection: () => (large ?? textarea).selection(),
    setContent(content) {
      if (isLargeDocument(content)) { enterReducedRendering(content); return }
      leaveReducedRendering()
      input.sourceElement.value = content
      exit()
      input.editor.setMarkdown(content, 'programmatic', true)
    },
    setContentWithPosition(content) {
      if (isLargeDocument(content)) {
        if (large) { large.setContent(content, true); return }
        if (input.createLargeSurface) { enterReducedRendering(content); return }
        if (!sourceMode) { enterReducedRendering(content); return }
        const before = input.sourceElement.value
        const range = mapTextRange(before, content, input.sourceElement.selectionStart, input.sourceElement.selectionEnd)
        const scrollTop = input.sourceElement.scrollTop
        const focused = (input.activeElement ? input.activeElement() : document.activeElement) === input.sourceElement
        setReducedRendering(true)
        input.sourceElement.value = content
        input.sourceElement.setSelectionRange(range.start, range.end)
        input.sourceElement.scrollTop = scrollTop
        if (focused) input.sourceElement.focus()
        return
      }
      if (reducedRendering) {
        leaveReducedRendering()
        input.sourceElement.value = content
        exit()
        input.editor.setMarkdown(content, 'programmatic', true, true)
        return
      }
      if (sourceMode) {
        const before = input.sourceElement.value
        const range = mapTextRange(before, content, input.sourceElement.selectionStart, input.sourceElement.selectionEnd)
        const scrollTop = input.sourceElement.scrollTop
        const focused = (input.activeElement ? input.activeElement() : document.activeElement) === input.sourceElement
        input.sourceElement.value = content
        input.sourceElement.setSelectionRange(range.start, range.end)
        input.sourceElement.scrollTop = scrollTop
        if (focused) input.sourceElement.focus()
      } else {
        input.editor.setMarkdown(content, 'programmatic', true, true)
      }
    },
    setContentPreservingMode(content) {
      this.setContentWithPosition(content)
      updateToggle()
    },
    isSourceMode: () => sourceMode,
    isReducedRendering: () => reducedRendering,
    toggle,
    suspendForExport() {
      const state: SourceExportState = {
        sourceMode, value: input.sourceElement.value, scrollTop: input.sourceElement.scrollTop,
        selectionStart: input.sourceElement.selectionStart, selectionEnd: input.sourceElement.selectionEnd,
        focused: (input.activeElement ? input.activeElement() : document.activeElement) === input.sourceElement,
        documentGeneration: input.documentGeneration?.() ?? 0,
        sourceSession,
        exportVersion,
      }
      if (sourceMode) {
        exit()
        input.editor.setMarkdown(state.value, 'programmatic')
      }
      return state
    },
    restoreAfterExport(state) {
      if (!state.sourceMode || (input.documentGeneration?.() ?? 0) !== state.documentGeneration || sourceSession !== state.sourceSession || exportVersion !== state.exportVersion) return
      enter(state.value)
      requestAnimationFrame(() => {
        input.sourceElement.value = state.value
        input.sourceElement.scrollTop = state.scrollTop
        input.sourceElement.setSelectionRange(state.selectionStart, state.selectionEnd)
        if (state.focused) input.sourceElement.focus()
      })
    },
    notifyVisualUserEdit() {
      exportVersion += 1
      const expectedExportVersion = exportVersion
      const expectedGeneration = input.documentGeneration?.() ?? 0
      const expectedSourceSession = sourceSession
      queueMicrotask(() => {
        if (
          sourceMode ||
          exportVersion !== expectedExportVersion ||
          (input.documentGeneration?.() ?? 0) !== expectedGeneration ||
          sourceSession !== expectedSourceSession
        ) return
        input.sourceElement.value = input.editor.getMarkdown()
      })
    },
    onSourceInput(callback) { sourceListeners.add(callback); return () => sourceListeners.delete(callback) },
    dispose() {
      destroyLarge()
      setActiveSourceSurface(null)
      input.toggleButton.removeEventListener('click', handleClick)
      input.sourceElement.removeEventListener('input', handleInput)
      sourceListeners.clear()
    },
  }
}

export async function runVisualExport<T>(
  source: SourceModeController,
  operation: () => Promise<T>,
  waitUntilReady: (state: SourceExportState) => Promise<boolean> = async () => true,
): Promise<T | undefined> {
  if (source.isReducedRendering()) return undefined
  const state = source.suspendForExport()
  try {
    if (state.sourceMode) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    }
    if (!await waitUntilReady(state)) return undefined
    return await operation()
  } finally {
    source.restoreAfterExport(state)
  }
}
