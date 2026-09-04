export interface AutosaveScheduler {
  schedule(): void
  cancel(): void
  pause(): void
  rearmForEdit(): void
  rearmForManualSave(): void
  isPaused(): boolean
}

export function createAutosaveScheduler(
  run: () => void,
  delay = 1_000,
  schedule: typeof globalThis.setTimeout = globalThis.setTimeout,
  cancel: typeof globalThis.clearTimeout = globalThis.clearTimeout,
): AutosaveScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null
  let paused = false

  const cancelPending = (): void => {
    if (timer) cancel(timer)
    timer = null
  }

  const rearm = (): void => { paused = false }

  return {
    schedule() {
      if (paused) return
      cancelPending()
      timer = schedule(() => {
        timer = null
        run()
      }, delay)
    },
    cancel: cancelPending,
    pause() {
      paused = true
      cancelPending()
    },
    rearmForEdit: rearm,
    rearmForManualSave: rearm,
    isPaused: () => paused,
  }
}
