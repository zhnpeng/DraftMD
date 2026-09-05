import { describe, expect, it, vi } from 'vitest'
import { ChatRuntime } from '../../../src/main/agent/chat-runtime'
import { createTaskController } from '../../../src/main/agent/task-controller'
import { FakeProviderAdapter } from '../../helpers/fake-provider-adapter'

const sessionId = '01991d5a-1c00-7000-8000-000000000001'

it('exposes chat deltas before completion, cancels its provider, and persists partial text once', async () => {
  let providerSignal!: AbortSignal
  const messages = { create: vi.fn() }
  const runtime = new ChatRuntime({
    messages,
    provider: { async *stream(request, signal) {
      expect(request.tools).toEqual([])
      providerSignal = signal
      yield { type: 'text-delta', text: 'Partial suggestion' } as const
      await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
      throw Object.assign(new Error('cancelled'), { code: 'CANCELLED' })
    } },
  })
  const handle = runtime.start({ taskId: '01991d5a-1c00-7000-8000-000000000002', sessionId, prompt: 'Help', currentDocument: '# Draft', selection: null })
  const events: any[] = []
  for await (const event of handle.events) {
    events.push(event)
    if (event.type === 'assistant-text-delta') handle.stop()
  }
  expect(providerSignal.aborted).toBe(true)
  expect(events).toContainEqual(expect.objectContaining({ type: 'assistant-text-delta', text: 'Partial suggestion' }))
  expect(events.at(-1)).toMatchObject({ type: 'status', status: 'stopped' })
  await expect(handle.done).resolves.toMatchObject({ status: 'stopped', changeSet: null })
  const assistant = messages.create.mock.calls.map(([message]) => message).filter(message => message.role === 'assistant')
  expect(assistant).toHaveLength(1)
  expect(assistant[0].content).toEqual([{ type: 'text', text: 'Partial suggestion' }])
})

it('streams and persists chat with zero tools and no task baseline', async () => {
  const adapter = new FakeProviderAdapter([() => [
    { type: 'text-delta', text: 'Suggestion' },
    { type: 'completed', stopReason: 'end-turn', assistantMessage: {
      role: 'assistant', provider: 'openai-compatible', content: [{ type: 'text', text: 'Suggestion only.' }], providerData: null,
    } },
  ]])
  const messages = { create: vi.fn() }
  const baselines = { begin: vi.fn(), finalize: vi.fn() }
  const workspace = { create: vi.fn(), edit: vi.fn(), rename: vi.fn(), delete: vi.fn() }
  const runtime = new ChatRuntime({ provider: adapter, messages, now: () => 1_000 })

  const result = await runtime.run({
    sessionId, prompt: 'How can I improve this?', currentDocument: '# Draft\n',
    selection: 'selected text', signal: new AbortController().signal,
  })

  expect(result).toEqual({ text: 'Suggestion only.', stopReason: 'end-turn' })
  expect(adapter.requests[0]).toMatchObject({ tools: [] })
  expect(JSON.stringify(adapter.requests[0].messages)).toContain('# Draft')
  expect(JSON.stringify(adapter.requests[0].messages)).toContain('selected text')
  expect(messages.create).toHaveBeenCalledTimes(2)
  expect(baselines.begin).not.toHaveBeenCalled()
  expect(baselines.finalize).not.toHaveBeenCalled()
  expect(workspace.create).not.toHaveBeenCalled()
  expect(workspace.edit).not.toHaveBeenCalled()
  expect(workspace.rename).not.toHaveBeenCalled()
  expect(workspace.delete).not.toHaveBeenCalled()
})

it('routes chat-only capabilities to suggestions and never starts AgentRuntime', async () => {
  const chat = { run: vi.fn().mockResolvedValue({ text: 'Suggestion', stopReason: 'end-turn' }) }
  const agent = { start: vi.fn() }
  const controller = createTaskController({ chat, agent })

  await expect(controller.start({
    capability: 'chat-only', chat: { sessionId, prompt: 'Edit it', currentDocument: '# A', selection: null, signal: new AbortController().signal },
    agent: {} as never,
  })).resolves.toEqual({ mode: 'suggestion', result: { text: 'Suggestion', stopReason: 'end-turn' } })
  expect(agent.start).not.toHaveBeenCalled()
})

it('routes agent capabilities without weakening the tool boundary', async () => {
  const handle = { done: Promise.resolve({ status: 'completed' }) }
  const chat = { run: vi.fn() }
  const agent = { start: vi.fn(() => handle) }
  const controller = createTaskController({ chat, agent })
  const input = { taskId: 'task' } as never

  expect(controller.start({ capability: 'agent', chat: {} as never, agent: input })).toEqual({ mode: 'agent', handle })
  expect(agent.start).toHaveBeenCalledWith(input)
  expect(chat.run).not.toHaveBeenCalled()
})

it('rejects unavailable providers without starting either runtime', async () => {
  const controller = createTaskController({ chat: { run: vi.fn() }, agent: { start: vi.fn() } })
  expect(() => controller.start({ capability: 'unavailable', chat: {} as never, agent: {} as never })).toThrowError(expect.objectContaining({ code: 'PROVIDER_UNAVAILABLE' }))
})
