import { describe, expect, it, vi } from 'vitest'
import { createAgentDockState } from '../../../src/renderer/agent/agent-dock-controller'

describe('agent dock state', () => {
  it('clamps persisted height between 180px and 65vh', () => {
    expect(createAgentDockState({ viewportHeight: 800, storedHeight: 50 }).height).toBe(180)
    expect(createAgentDockState({ viewportHeight: 800, storedHeight: 900 }).height).toBe(520)
    expect(createAgentDockState({ viewportHeight: 800, storedHeight: 340 }).height).toBe(340)
  })

  it('collapses only when input is empty and no approval is pending', () => {
    const state = createAgentDockState({ viewportHeight: 800, storedHeight: null })
    state.open()
    expect(state.collapse({ input: 'draft', waitingApproval: false })).toBe(false)
    expect(state.collapse({ input: '', waitingApproval: true })).toBe(false)
    expect(state.collapse({ input: '', waitingApproval: false })).toBe(true)
    expect(state.expanded).toBe(false)
  })

  it('collapsing never changes the busy task state', () => {
    const state = createAgentDockState({ viewportHeight: 800, storedHeight: null })
    state.open(); state.setBusy(true)
    state.collapse({ input: '', waitingApproval: false })
    expect(state.busy).toBe(true)
  })
})

import { createPendingStop } from '../../../src/renderer/agent/agent-dock-controller'

it('remembers a stop requested before the task id arrives and consumes it once', () => {
  const pending = createPendingStop()
  expect(pending.request(null)).toBeNull()
  expect(pending.attach('task-1')).toBe('task-1')
  expect(pending.attach('task-1')).toBeNull()
  expect(pending.request('task-2')).toBe('task-2')
})

import { resizeKeyDelta } from '../../../src/renderer/agent/agent-dock-controller'

it('maps separator arrow keys to deterministic dock resize deltas', () => {
  expect(resizeKeyDelta('ArrowUp')).toBe(16)
  expect(resizeKeyDelta('ArrowDown')).toBe(-16)
  expect(resizeKeyDelta('Home')).toBe(0)
})
