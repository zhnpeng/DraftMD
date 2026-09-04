import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/renderer/editor/editor', () => ({ getEditorView: () => null }))

import { MathModal } from '../../../src/renderer/editor/math-modal'

class FakeClassList {
  constructor(private readonly values = new Set<string>()) {}
  contains(value: string): boolean { return this.values.has(value) }
}

class FakeElement extends EventTarget {
  className = ''
  style: Record<string, string> = {}
  textContent = ''
  placeholder = ''
  rows = 0
  type = ''
  id = ''
  htmlFor = ''
  checked = false
  value = ''
  selectionStart = 0
  selectionEnd = 0
  classList = new FakeClassList()
  children: FakeElement[] = []
  focus = vi.fn()
  select = vi.fn()
  append(...children: FakeElement[]): void { this.children.push(...children) }
  appendChild(child: FakeElement): FakeElement { this.children.push(child); return child }
  setRangeText(replacement: string, start: number, end: number): void {
    this.value = this.value.slice(0, start) + replacement + this.value.slice(end)
    this.selectionStart = this.selectionEnd = start + replacement.length
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('MathModal source insertion', () => {
  it('emits the native source input path after inserting a formula', () => {
    const created: FakeElement[] = []
    const body = new FakeElement()
    const source = new FakeElement()
    source.value = 'before after'
    source.selectionStart = 7
    source.selectionEnd = 7
    source.classList = new FakeClassList(new Set(['visible']))
    let inputEvents = 0
    source.addEventListener('input', () => { inputEvents += 1 })
    vi.stubGlobal('document', {
      body,
      createElement: () => { const element = new FakeElement(); created.push(element); return element },
      getElementById: (id: string) => id === 'source-editor' ? source : null,
    })

    const modal = new MathModal()
    modal.show('E=mc^2')
    const save = created.find((element) => element.className === 'math-modal-btn save')
    save?.dispatchEvent(new Event('click'))

    expect(source.value).toBe('before $E=mc^2$after')
    expect(inputEvents).toBe(1)
  })
})
