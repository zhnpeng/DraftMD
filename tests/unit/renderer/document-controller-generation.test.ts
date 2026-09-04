import { describe, expect, it, vi } from 'vitest'
import { createDocumentController } from '../../../src/renderer/app/document-controller'

class Classes {
  add(): void {}
  remove(): void {}
}

function setup() {
  const order: string[] = []
  let controller!: ReturnType<typeof createDocumentController>
  const source = {
    currentContent: () => '',
    setContent: vi.fn(() => order.push(`set:${controller.generation()}`)),
    setContentPreservingMode: vi.fn(() => order.push(`preserve:${controller.generation()}`)),
  }
  controller = createDocumentController({
    api: {
      reportDirty: vi.fn(), saveFile: vi.fn(), saveFileAs: vi.fn(),
      reportExternalConflict: vi.fn(), acknowledgeExternalVersion: vi.fn(),
    } as never,
    source: source as never,
    titleElement: { textContent: '' } as HTMLElement,
    saveStatusElement: { textContent: '', classList: new Classes() } as unknown as HTMLElement,
    onGenerationChanged: (generation) => order.push(`publish:${generation}`),
    onContentChanged: () => order.push('changed'),
    onPathChanged: vi.fn(),
  })
  return { controller, order }
}

describe('DocumentController generation publication', () => {
  it('publishes a new generation before synchronous node-view updates on every replacement path', () => {
    const { controller, order } = setup()

    controller.applyDiskContent({ path: '/work/a.md', content: '# A', version: 'a' })
    expect(order.slice(0, 2)).toEqual(['publish:1', 'set:1'])

    order.length = 0
    controller.applyExternalSnapshot({ path: '/work/a.md', content: '# B', version: 'b' })
    expect(order.slice(0, 2)).toEqual(['publish:2', 'preserve:2'])

    controller.markDirty()
    controller.applyExternalSnapshot({ path: '/work/a.md', content: '# C', version: 'c' })
    order.length = 0
    controller.resolveExternalConflict({ action: 'load', content: '# C' })
    expect(order.slice(0, 2)).toEqual(['publish:3', 'set:3'])
  })
})
