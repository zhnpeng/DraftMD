import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAutosaveScheduler } from '../../../src/renderer/autosave-scheduler'

afterEach(() => {
  vi.useRealTimers()
})

describe('renderer autosave retry scheduling', () => {
  it('does not repeat automatically after recovery pauses a failed save', async () => {
    vi.useFakeTimers()
    const save = vi.fn()
    const warning = vi.fn()
    const scheduler = createAutosaveScheduler(() => {
      save()
      warning()
      scheduler.pause()
    })

    scheduler.schedule()
    await vi.advanceTimersByTimeAsync(1_000)
    await vi.advanceTimersByTimeAsync(10_000)

    expect(save).toHaveBeenCalledOnce()
    expect(warning).toHaveBeenCalledOnce()
  })

  it('allows a subsequent user edit or manual Save to retry', async () => {
    vi.useFakeTimers()
    const save = vi.fn()
    const scheduler = createAutosaveScheduler(save)

    scheduler.pause()
    scheduler.rearmForEdit()
    scheduler.schedule()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(save).toHaveBeenCalledOnce()

    scheduler.pause()
    scheduler.rearmForManualSave()
    expect(scheduler.isPaused()).toBe(false)
    save()
    expect(save).toHaveBeenCalledTimes(2)
  })
})

it('cancels a pending autosave when manual Save takes ownership', async () => {
  vi.useFakeTimers()
  const save = vi.fn()
  const scheduler = createAutosaveScheduler(save)

  scheduler.schedule()
  scheduler.rearmForManualSave()
  await vi.advanceTimersByTimeAsync(1_000)

  expect(save).not.toHaveBeenCalled()
  expect(scheduler.isPaused()).toBe(false)
})
