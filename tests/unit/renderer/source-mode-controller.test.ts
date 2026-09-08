import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSourceModeController, runVisualExport } from '../../../src/renderer/app/source-mode-controller'

class FakeClassList {
  private values = new Set<string>()
  add(value: string): void { this.values.add(value) }
  remove(value: string): void { this.values.delete(value) }
  toggle(value: string, force?: boolean): boolean {
    const next = force ?? !this.values.has(value)
    if (next) this.values.add(value); else this.values.delete(value)
    return next
  }
  contains(value: string): boolean { return this.values.has(value) }
}

class FakeElement extends EventTarget {
  classList = new FakeClassList()
  scrollHeight = 1000
  clientHeight = 200
  scrollTop = 0
  attributes = new Map<string, string>()
  querySelector(): null { return null }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value) }
}

class FakeTextarea extends FakeElement {
  value = ''
  selectionStart = 0
  selectionEnd = 0
  focus = vi.fn()
  setSelectionRange(start: number, end: number): void { this.selectionStart = start; this.selectionEnd = end }
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1 })
})
afterEach(() => vi.unstubAllGlobals())

describe('SourceModeController export suspension', () => {
  it('restores source text, scroll, selection, and focus exactly after visual export', () => {
    const editorElement = new FakeElement()
    const sourceElement = new FakeTextarea()
    const toggleButton = new FakeElement()
    let markdown = '# Initial'
    const controller = createSourceModeController({
      editorElement: editorElement as unknown as HTMLElement,
      sourceElement: sourceElement as unknown as HTMLTextAreaElement,
      toggleButton: toggleButton as unknown as HTMLButtonElement,
      editor: { getMarkdown: () => markdown, setMarkdown: (content, _origin) => { markdown = content } },
      activeElement: () => sourceElement as unknown as Element,
    })

    controller.toggle()
    sourceElement.value = '# Source draft'
    sourceElement.scrollTop = 317
    sourceElement.selectionStart = 3
    sourceElement.selectionEnd = 9

    const state = controller.suspendForExport()
    expect(controller.isSourceMode()).toBe(false)
    expect(markdown).toBe('# Source draft')

    sourceElement.value = 'changed during export'
    sourceElement.scrollTop = 0
    sourceElement.selectionStart = 0
    sourceElement.selectionEnd = 0
    controller.restoreAfterExport(state)

    expect(controller.isSourceMode()).toBe(true)
    expect(sourceElement.value).toBe('# Source draft')
    expect(sourceElement.scrollTop).toBe(317)
    expect([sourceElement.selectionStart, sourceElement.selectionEnd]).toEqual([3, 9])
    expect(sourceElement.focus).toHaveBeenCalledOnce()
  })
})

it('does not dirty the document when the delayed export update arrives, then dirties on the next user update', async () => {
  vi.useFakeTimers()
  try {
    const editorElement = new FakeElement()
    const sourceElement = new FakeTextarea()
    const toggleButton = new FakeElement()
    let markdown = '# Initial'
    let revision = 0
    let dirty = false
    const reportUpdate = (origin: 'programmatic' | 'user'): void => {
      if (origin === 'user') { revision += 1; dirty = true }
    }
    const controller = createSourceModeController({
      editorElement: editorElement as unknown as HTMLElement,
      sourceElement: sourceElement as unknown as HTMLTextAreaElement,
      toggleButton: toggleButton as unknown as HTMLButtonElement,
      editor: {
        getMarkdown: () => markdown,
        setMarkdown: (content, origin) => {
          markdown = content
          setTimeout(() => reportUpdate(origin), 200)
        },
      },
      activeElement: () => sourceElement as unknown as Element,
    })

    controller.toggle()
    sourceElement.value = '# Export draft'
    controller.suspendForExport()
    await vi.advanceTimersByTimeAsync(200)

    expect({ revision, dirty }).toEqual({ revision: 0, dirty: false })
    reportUpdate('user')
    expect({ revision, dirty }).toEqual({ revision: 1, dirty: true })
  } finally {
    vi.useRealTimers()
  }
})

it('does not restore stale source state after a deferred export resolves on another document', async () => {
  const editorElement = new FakeElement()
  const sourceElement = new FakeTextarea()
  const toggleButton = new FakeElement()
  let markdown = '# First'
  let documentGeneration = 1
  const controller = createSourceModeController({
    editorElement: editorElement as unknown as HTMLElement,
    sourceElement: sourceElement as unknown as HTMLTextAreaElement,
    toggleButton: toggleButton as unknown as HTMLButtonElement,
    editor: { getMarkdown: () => markdown, setMarkdown: (content, _origin) => { markdown = content } },
    activeElement: () => sourceElement as unknown as Element,
    documentGeneration: () => documentGeneration,
  })

  controller.toggle()
  sourceElement.value = '# First draft'
  const exportState = controller.suspendForExport()
  let finishExport!: () => void
  const exported = new Promise<void>((resolve) => { finishExport = resolve })
  const exportOperation = (async () => {
    try { await exported } finally { controller.restoreAfterExport(exportState) }
  })()
  documentGeneration += 1
  controller.setContent('# Second document')
  finishExport()
  await exportOperation

  expect(controller.isSourceMode()).toBe(false)
  expect(markdown).toBe('# Second document')
  expect(sourceElement.value).not.toBe('# First draft')
})

it('does not restore stale source state after a newer source-mode session starts', () => {
  const editorElement = new FakeElement()
  const sourceElement = new FakeTextarea()
  const toggleButton = new FakeElement()
  let markdown = '# First'
  const controller = createSourceModeController({
    editorElement: editorElement as unknown as HTMLElement,
    sourceElement: sourceElement as unknown as HTMLTextAreaElement,
    toggleButton: toggleButton as unknown as HTMLButtonElement,
    editor: { getMarkdown: () => markdown, setMarkdown: (content, _origin) => { markdown = content } },
    documentGeneration: () => 1,
    activeElement: () => null,
  })

  controller.toggle()
  sourceElement.value = '# Exported draft'
  const exportState = controller.suspendForExport()
  controller.toggle()
  sourceElement.value = '# New source session'
  controller.restoreAfterExport(exportState)

  expect(controller.isSourceMode()).toBe(true)
  expect(sourceElement.value).toBe('# New source session')
})


it('runs PDF work with the visual editor visible and restores source state on success and failure', async () => {
  const editorElement = new FakeElement()
  const sourceElement = new FakeTextarea()
  const toggleButton = new FakeElement()
  let markdown = '# Initial'
  const controller = createSourceModeController({
    editorElement: editorElement as unknown as HTMLElement,
    sourceElement: sourceElement as unknown as HTMLTextAreaElement,
    toggleButton: toggleButton as unknown as HTMLButtonElement,
    editor: { getMarkdown: () => markdown, setMarkdown: (content) => { markdown = content } },
    activeElement: () => sourceElement as unknown as Element,
  })
  controller.toggle()
  sourceElement.value = '# PDF source'
  sourceElement.scrollTop = 231
  sourceElement.selectionStart = 2
  sourceElement.selectionEnd = 8

  await runVisualExport(controller, async () => {
    expect(controller.isSourceMode()).toBe(false)
    expect(markdown).toBe('# PDF source')
  })
  expect(controller.isSourceMode()).toBe(true)
  expect(sourceElement.value).toBe('# PDF source')
  expect(sourceElement.scrollTop).toBe(231)
  expect([sourceElement.selectionStart, sourceElement.selectionEnd]).toEqual([2, 8])

  await expect(runVisualExport(controller, async () => { throw new Error('print failed') })).rejects.toThrow('print failed')
  expect(controller.isSourceMode()).toBe(true)
  expect(sourceElement.value).toBe('# PDF source')
})

it('invalidates deferred export restoration when a visual user edit occurs', async () => {
  const editorElement = new FakeElement()
  const sourceElement = new FakeTextarea()
  const toggleButton = new FakeElement()
  let markdown = '# Initial'
  const controller = createSourceModeController({
    editorElement: editorElement as unknown as HTMLElement,
    sourceElement: sourceElement as unknown as HTMLTextAreaElement,
    toggleButton: toggleButton as unknown as HTMLButtonElement,
    editor: { getMarkdown: () => markdown, setMarkdown: (content, _origin) => { markdown = content } },
    activeElement: () => sourceElement as unknown as Element,
  })
  controller.toggle()
  sourceElement.value = '# Stale source'

  let resolveExport!: () => void
  const exportDeferred = new Promise<void>((resolve) => { resolveExport = resolve })
  const exporting = runVisualExport(controller, () => exportDeferred)
  expect(controller.isSourceMode()).toBe(false)

  markdown = '# Visual user edit'
  controller.notifyVisualUserEdit()
  resolveExport()
  await exporting

  expect(controller.isSourceMode()).toBe(false)
  expect(controller.currentContent()).toBe('# Visual user edit')
  expect(sourceElement.value).not.toBe('# Stale source')
})

it('defers visual-edit source sync until after ProseMirror installs the new state', async () => {
  const { Schema } = await import('@milkdown/kit/prose/model')
  const { EditorState, Plugin } = await import('@milkdown/kit/prose/state')
  const editorElement = new FakeElement()
  const sourceElement = new FakeTextarea()
  const toggleButton = new FakeElement()
  let markdown = '# Initial'
  let controller!: ReturnType<typeof createSourceModeController>
  const schema = new Schema({ nodes: { doc: { content: 'text*' }, text: {} } })
  const notifyPlugin = new Plugin({
    state: {
      init: () => null,
      apply(transaction, value) {
        if (transaction.docChanged) controller.notifyVisualUserEdit()
        return value
      },
    },
  })
  let state = EditorState.create({ schema, plugins: [notifyPlugin] })
  controller = createSourceModeController({
    editorElement: editorElement as unknown as HTMLElement,
    sourceElement: sourceElement as unknown as HTMLTextAreaElement,
    toggleButton: toggleButton as unknown as HTMLButtonElement,
    editor: { getMarkdown: () => markdown, setMarkdown: (content, _origin) => { markdown = content } },
    activeElement: () => sourceElement as unknown as Element,
  })
  controller.toggle()
  sourceElement.value = '# Stale source'
  const exportState = controller.suspendForExport()

  state = state.apply(state.tr.insertText('post-edit'))
  markdown = state.doc.textContent
  expect(sourceElement.value).toBe('# Stale source')
  await Promise.resolve()
  expect(sourceElement.value).toBe('post-edit')

  controller.restoreAfterExport(exportState)
  expect(controller.isSourceMode()).toBe(false)
  expect(controller.currentContent()).toBe('post-edit')
})

it('ignores a queued visual sync after document generation or source session changes', async () => {
  const editorElement = new FakeElement()
  const sourceElement = new FakeTextarea()
  const toggleButton = new FakeElement()
  let markdown = '# First'
  let generation = 1
  const controller = createSourceModeController({
    editorElement: editorElement as unknown as HTMLElement,
    sourceElement: sourceElement as unknown as HTMLTextAreaElement,
    toggleButton: toggleButton as unknown as HTMLButtonElement,
    editor: { getMarkdown: () => markdown, setMarkdown: (content, _origin) => { markdown = content } },
    activeElement: () => sourceElement as unknown as Element,
    documentGeneration: () => generation,
  })
  controller.toggle()
  sourceElement.value = '# Export source'
  controller.suspendForExport()

  controller.notifyVisualUserEdit()
  markdown = '# Stale queued visual text'
  generation += 1
  controller.setContent('# New document')
  await Promise.resolve()
  expect(sourceElement.value).toBe('# New document')

  controller.toggle()
  sourceElement.value = '# New source session'
  controller.notifyVisualUserEdit()
  markdown = '# Stale second queued text'
  controller.toggle()
  controller.toggle()
  sourceElement.value = '# Newer source session'
  await Promise.resolve()
  expect(sourceElement.value).toBe('# Newer source session')
})

it('does not invoke export until renderer readiness resolves and cancels a stale generation', async () => {
  const editorElement = new FakeElement()
  const sourceElement = new FakeTextarea()
  const toggleButton = new FakeElement()
  let generation = 1
  let resolveReady!: (ready: boolean) => void
  const readiness = vi.fn(() => new Promise<boolean>((resolve) => { resolveReady = resolve }))
  const operation = vi.fn().mockResolvedValue('exported')
  const controller = createSourceModeController({
    editorElement: editorElement as unknown as HTMLElement,
    sourceElement: sourceElement as unknown as HTMLTextAreaElement,
    toggleButton: toggleButton as unknown as HTMLButtonElement,
    editor: { getMarkdown: () => '# Visual', setMarkdown: () => {} },
    activeElement: () => null,
    documentGeneration: () => generation,
  })

  const exporting = runVisualExport(controller, operation, readiness)
  await Promise.resolve()
  expect(operation).not.toHaveBeenCalled()
  resolveReady(true)
  await expect(exporting).resolves.toBe('exported')
  expect(operation).toHaveBeenCalledOnce()

  const staleOperation = vi.fn()
  const stale = runVisualExport(controller, staleOperation, readiness)
  await Promise.resolve()
  generation += 1
  resolveReady(false)
  await expect(stale).resolves.toBeUndefined()
  expect(staleOperation).not.toHaveBeenCalled()
})


it('resets history only for document replacement, not source-mode transitions', () => {
  const editorElement = new FakeElement()
  const sourceElement = new FakeTextarea()
  const toggleButton = new FakeElement()
  const setMarkdown = vi.fn()
  const controller = createSourceModeController({
    editorElement: editorElement as unknown as HTMLElement,
    sourceElement: sourceElement as unknown as HTMLTextAreaElement,
    toggleButton: toggleButton as unknown as HTMLButtonElement,
    editor: { getMarkdown: () => '# A', setMarkdown },
  })

  controller.toggle()
  sourceElement.value = '# A source edit'
  controller.toggle()
  expect(setMarkdown).toHaveBeenLastCalledWith('# A source edit', 'programmatic', false)

  controller.setContent('# B')
  expect(setMarkdown).toHaveBeenLastCalledWith('# B', 'programmatic', true)
})

it('preserves mapped source selection, scroll, and focus during an Agent reload', () => {
  const editorElement = new FakeElement()
  const sourceElement = new FakeTextarea()
  const toggleButton = new FakeElement()
  let markdown = 'alpha target omega'
  const controller = createSourceModeController({
    editorElement: editorElement as unknown as HTMLElement,
    sourceElement: sourceElement as unknown as HTMLTextAreaElement,
    toggleButton: toggleButton as unknown as HTMLButtonElement,
    editor: { getMarkdown: () => markdown, setMarkdown: (content) => { markdown = content } },
    activeElement: () => sourceElement as unknown as Element,
  })
  controller.toggle()
  sourceElement.selectionStart = 6
  sourceElement.selectionEnd = 12
  sourceElement.scrollTop = 247

  controller.setContentWithPosition('intro alpha target omega')

  expect(controller.isSourceMode()).toBe(true)
  expect(sourceElement.value).toBe('intro alpha target omega')
  expect([sourceElement.selectionStart, sourceElement.selectionEnd]).toEqual([12, 18])
  expect(sourceElement.scrollTop).toBe(247)
  expect(sourceElement.focus).toHaveBeenCalledOnce()
})

describe('large-document reduced rendering', () => {
  it('keeps a 2 MiB document in complete source form without invoking the visual parser', () => {
    const editorElement = new FakeElement()
    const sourceElement = new FakeTextarea()
    const toggleButton = new FakeElement() as FakeElement & { disabled: boolean }
    toggleButton.disabled = false
    const setMarkdown = vi.fn()
    const states: boolean[] = []
    const controller = createSourceModeController({
      editorElement: editorElement as unknown as HTMLElement,
      sourceElement: sourceElement as unknown as HTMLTextAreaElement,
      toggleButton: toggleButton as unknown as HTMLButtonElement,
      editor: { getMarkdown: () => '# Visual', setMarkdown },
      onReducedRenderingChanged: (reduced) => states.push(reduced),
    })
    const large = `# Large\n${'x'.repeat(2 * 1024 * 1024)}`

    controller.setContent(large)

    expect(controller.isReducedRendering()).toBe(true)
    expect(controller.isSourceMode()).toBe(true)
    expect(controller.currentContent()).toBe(large)
    expect(sourceElement.value).toBe(large)
    expect(sourceElement.attributes.get('wrap')).toBe('off')
    expect(toggleButton.disabled).toBe(true)
    expect(setMarkdown).not.toHaveBeenCalled()
    expect(states).toEqual([true])
  })

  it('keeps source edits observable and returns to visual mode for a smaller document', () => {
    const editorElement = new FakeElement()
    const sourceElement = new FakeTextarea()
    const toggleButton = new FakeElement() as FakeElement & { disabled: boolean }
    toggleButton.disabled = false
    let markdown = '# Visual'
    const setMarkdown = vi.fn((content: string) => { markdown = content })
    const onInput = vi.fn()
    const controller = createSourceModeController({
      editorElement: editorElement as unknown as HTMLElement,
      sourceElement: sourceElement as unknown as HTMLTextAreaElement,
      toggleButton: toggleButton as unknown as HTMLButtonElement,
      editor: { getMarkdown: () => markdown, setMarkdown },
    })
    controller.onSourceInput(onInput)
    controller.setContent('x'.repeat(2 * 1024 * 1024))
    sourceElement.value += ' user edit'
    sourceElement.dispatchEvent(new Event('input'))
    expect(onInput).toHaveBeenCalledOnce()
    expect(controller.currentContent()).toContain('user edit')

    controller.setContent('# Small')
    expect(controller.isReducedRendering()).toBe(false)
    expect(controller.isSourceMode()).toBe(false)
    expect(toggleButton.disabled).toBe(false)
    expect(sourceElement.attributes.get('wrap')).toBe('soft')
    expect(setMarkdown).toHaveBeenLastCalledWith('# Small', 'programmatic', true)
  })

  it('skips visual export while reduced rendering protects a large document', async () => {
    const editorElement = new FakeElement()
    const sourceElement = new FakeTextarea()
    const toggleButton = new FakeElement() as FakeElement & { disabled: boolean }
    toggleButton.disabled = false
    const controller = createSourceModeController({
      editorElement: editorElement as unknown as HTMLElement,
      sourceElement: sourceElement as unknown as HTMLTextAreaElement,
      toggleButton: toggleButton as unknown as HTMLButtonElement,
      editor: { getMarkdown: () => '', setMarkdown: vi.fn() },
    })
    controller.setContent('x'.repeat(2 * 1024 * 1024))
    const operation = vi.fn()
    await expect(runVisualExport(controller, operation)).resolves.toBeUndefined()
    expect(operation).not.toHaveBeenCalled()
    expect(controller.isSourceMode()).toBe(true)
  })
})
