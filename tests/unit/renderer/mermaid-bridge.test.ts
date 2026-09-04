import { afterEach, describe, expect, it, vi } from 'vitest'
import { setLocale } from '../../../src/shared/i18n'

class FakeIframe {
  style: Record<string, string> = {}
  src = ''
  contentWindow = { postMessage: vi.fn() }
  setAttribute = vi.fn()
  remove = vi.fn()
}

afterEach(() => {
  vi.useRealTimers()
  vi.resetModules()
  vi.unstubAllGlobals()
})

describe('Mermaid bridge timeout', () => {
  it('rejects the render promise that triggers a sandbox reset', async () => {
    vi.useFakeTimers()
    setLocale('en')
    const iframe = new FakeIframe()
    const listeners = new Map<string, EventListener>()
    vi.stubGlobal('window', { addEventListener: (type: string, listener: EventListener) => listeners.set(type, listener) })
    vi.stubGlobal('document', {
      body: { classList: { contains: () => false }, appendChild: vi.fn() },
      createElement: () => iframe,
    })
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '#ffffff' }))
    const { renderMermaid } = await import('../../../src/renderer/editor/mermaid-bridge')

    const pending = renderMermaid('graph TD; A-->B')
    expect(iframe.setAttribute).toHaveBeenCalledWith('sandbox', 'allow-scripts')
    listeners.get('message')?.({ source: iframe.contentWindow, data: { type: 'ready' } } as unknown as Event)
    const rejection = expect(pending).rejects.toThrow('Rendering timed out')
    await vi.advanceTimersByTimeAsync(15_000)

    await rejection
  })
})
