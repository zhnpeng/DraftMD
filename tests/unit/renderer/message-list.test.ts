import { expect, it, vi } from 'vitest'
import { createDeltaBatcher, shouldAutoScroll } from '../../../src/renderer/agent/message-list'

it('batches many deltas into one render per animation frame', () => {
  let callback: FrameRequestCallback | null = null
  const render = vi.fn()
  const batcher = createDeltaBatcher({
    render,
    requestFrame: (next) => { callback = next; return 7 },
    cancelFrame: vi.fn(),
  })
  batcher.push('a')
  batcher.push('b')
  batcher.push('c')
  expect(render).not.toHaveBeenCalled()
  expect(callback).not.toBeNull()
  ;(callback as unknown as FrameRequestCallback)(1)
  expect(render).toHaveBeenCalledTimes(1)
  expect(render).toHaveBeenCalledWith('abc')
})

it('flushes pending text synchronously and cancels disposal work', () => {
  let callback: FrameRequestCallback | null = null
  const cancelFrame = vi.fn()
  const render = vi.fn()
  const batcher = createDeltaBatcher({ render, requestFrame: (next) => { callback = next; return 9 }, cancelFrame })
  batcher.push('pending')
  batcher.flush()
  expect(render).toHaveBeenCalledWith('pending')
  expect(cancelFrame).toHaveBeenCalledWith(9)
  batcher.push('ignored')
  batcher.dispose()
  ;(callback as unknown as FrameRequestCallback)?.(1)
  expect(render).toHaveBeenCalledTimes(1)
})

it('auto-scrolls only when the reader was already near the bottom', () => {
  expect(shouldAutoScroll({ scrollHeight: 1000, scrollTop: 652, clientHeight: 300 })).toBe(true)
  expect(shouldAutoScroll({ scrollHeight: 1000, scrollTop: 500, clientHeight: 300 })).toBe(false)
})

import { setLocale } from '../../../src/shared/i18n'
import { modelSwitchText } from '../../../src/renderer/agent/message-list'

it('renders model switch markers by redacted display name, not raw IDs', () => {
  setLocale('en')
  const providerId = '01991d5a-1c00-7000-8000-000000000001'
  expect(modelSwitchText(providerId, [{ id: providerId, name: 'Local Model' }])).toBe('Switched to Local Model')
  expect(modelSwitchText(providerId, [])).toBe('Model configuration removed')
})
