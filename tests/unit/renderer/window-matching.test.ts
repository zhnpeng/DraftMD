import { expect, it } from 'vitest'
import { findMatchingWindow } from '../../helpers/electron-app'

it('bounds a hanging predicate attempt and continues to a matching window', async () => {
  const hanging = { id: 'hanging' }
  const matching = { id: 'matching' }
  const started = Date.now()
  const result = await findMatchingWindow(
    () => [hanging, matching],
    (page) => page === hanging ? new Promise<boolean>(() => {}) : Promise.resolve(true),
    { attemptTimeoutMs: 20, deadlineMs: 200, pollMs: 1 },
  )

  expect(result).toBe(matching)
  expect(Date.now() - started).toBeLessThan(150)
})
