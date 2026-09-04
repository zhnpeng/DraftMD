import { afterEach, describe, expect, it, vi } from 'vitest'
import { beginMermaidRender, waitForMermaidReady } from '../../../src/renderer/editor/mermaid-readiness'

const current = () => true

afterEach(() => vi.useRealTimers())

describe('Mermaid export readiness', () => {
  it('waits through the debounce and deferred render before allowing print', async () => {
    vi.useFakeTimers()
    const finish = beginMermaidRender()
    const print = vi.fn()
    const exporting = waitForMermaidReady({ isCurrent: current }).then(print)

    await vi.advanceTimersByTimeAsync(450)
    expect(print).not.toHaveBeenCalled()
    finish()
    await exporting

    expect(print).toHaveBeenCalledOnce()
  })

  it('settles after render errors and has a bounded timeout', async () => {
    vi.useFakeTimers()
    const finishError = beginMermaidRender()
    const afterError = waitForMermaidReady({ isCurrent: current })
    finishError()
    await expect(afterError).resolves.toBe(true)

    beginMermaidRender()
    const timedOut = waitForMermaidReady({ isCurrent: current, timeoutMs: 1_000 })
    await vi.advanceTimersByTimeAsync(1_000)
    await expect(timedOut).resolves.toBe(true)
  })

  it('cancels readiness when the document generation becomes stale', async () => {
    vi.useFakeTimers()
    beginMermaidRender()
    let valid = true
    const waiting = waitForMermaidReady({ isCurrent: () => valid })
    valid = false
    await vi.advanceTimersByTimeAsync(50)

    await expect(waiting).resolves.toBe(false)
  })
})

it('settles an in-flight render immediately when its node-view owner is destroyed', async () => {
  const { cancelMermaidRenders } = await import('../../../src/renderer/editor/mermaid-readiness')
  const owner = Symbol('destroyed-view')
  beginMermaidRender(owner, 4)
  const waiting = waitForMermaidReady({ generation: 4, isCurrent: current })

  cancelMermaidRenders(owner)

  await expect(waiting).resolves.toBe(true)
})

it('does not let an old document render delay readiness for the new generation', async () => {
  const oldOwner = Symbol('old-document')
  beginMermaidRender(oldOwner, 7)

  await expect(waitForMermaidReady({ generation: 8, isCurrent: current })).resolves.toBe(true)
})

it('assigns node-view renders to the active document generation', async () => {
  const { setMermaidGeneration } = await import('../../../src/renderer/editor/mermaid-readiness')
  setMermaidGeneration(12)
  const finish = beginMermaidRender(Symbol('active-view'))
  let settled = false
  const waiting = waitForMermaidReady({ generation: 12, isCurrent: current }).then(() => { settled = true })
  await Promise.resolve()
  expect(settled).toBe(false)
  finish()
  await waiting
  expect(settled).toBe(true)
})

it('removes timed-out generation tokens so the next readiness check is immediate', async () => {
  vi.useFakeTimers()
  beginMermaidRender(Symbol('never-ready'), 21)
  const first = waitForMermaidReady({ generation: 21, isCurrent: current, timeoutMs: 1_000 })
  await vi.advanceTimersByTimeAsync(1_000)
  await expect(first).resolves.toBe(true)

  let secondSettled = false
  await waitForMermaidReady({ generation: 21, isCurrent: current }).then(() => { secondSettled = true })
  expect(secondSettled).toBe(true)
})

it('times out only the token identities captured when the wait started', async () => {
  vi.useFakeTimers()
  beginMermaidRender(Symbol('old'), 31)
  const first = waitForMermaidReady({ generation: 31, isCurrent: current, timeoutMs: 16_000 })
  await vi.advanceTimersByTimeAsync(15_900)
  const finishFresh = beginMermaidRender(Symbol('fresh'), 31)
  await vi.advanceTimersByTimeAsync(100)
  await expect(first).resolves.toBe(true)

  let laterSettled = false
  const later = waitForMermaidReady({ generation: 31, isCurrent: current }).then(() => { laterSettled = true })
  await Promise.resolve()
  expect(laterSettled).toBe(false)
  finishFresh()
  await later
  expect(laterSettled).toBe(true)
})

it('waits for fresh same-generation work during ordinary successful readiness', async () => {
  const finishOld = beginMermaidRender(Symbol('old'), 41)
  let settled = false
  const waiting = waitForMermaidReady({ generation: 41, isCurrent: current }).then(() => { settled = true })
  const finishFresh = beginMermaidRender(Symbol('fresh'), 41)

  finishOld()
  await Promise.resolve()
  expect(settled).toBe(false)

  finishFresh()
  await waiting
  expect(settled).toBe(true)
})
