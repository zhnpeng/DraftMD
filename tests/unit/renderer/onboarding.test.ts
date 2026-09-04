import { expect, it } from 'vitest'
import { createOnboardingState } from '../../../src/renderer/app/onboarding'

it('advances exactly four onboarding steps and marks completion', () => {
  const state = createOnboardingState()
  expect(state.step).toBe('language')
  expect(state.next()).toBe('folder')
  expect(state.next({ hasWorkspace: true })).toBe('model')
  expect(state.next()).toBe('permissions')
  expect(state.next()).toBe('complete')
  expect(state.completed).toBe(true)
})

it('does not advance past folder until a workspace is available', () => {
  const state = createOnboardingState()
  state.next()
  expect(state.next({ hasWorkspace: false })).toBe('folder')
  expect(state.next({ hasWorkspace: true })).toBe('model')
})

it('can reopen at language without changing the persisted completion decision', () => {
  const state = createOnboardingState()
  state.next(); state.next({ hasWorkspace: true }); state.next(); state.next()
  state.reopen()
  expect(state.step).toBe('language')
  expect(state.completed).toBe(true)
})
