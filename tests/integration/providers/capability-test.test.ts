import { describe, expect, it, vi } from 'vitest'
import type { ProviderAdapter } from '../../../src/main/providers/provider-adapter'
import { ProviderError } from '../../../src/main/providers/provider-errors'
import { createCapabilityTester } from '../../../src/main/providers/capability-test'

function adapter(events: Parameters<typeof iterable>[0]): ProviderAdapter {
  return { stream: () => iterable(events) }
}
async function* iterable(events: Array<unknown | Error>) {
  for (const event of events) {
    if (event instanceof Error) throw event
    yield event as never
  }
}

const config = {
  id: '01991d5a-1c00-7000-8000-000000000000', model: 'test-model', capability: 'unavailable',
}

describe('provider capability test', () => {
  it.each([false, true])('does not advertise a discarded probe result (provider failure: %s)', async fails => {
    const tester = createCapabilityTester({
      materialize: vi.fn().mockResolvedValue({ config, apiKey: null, headers: {} }),
      createAdapter: vi.fn().mockResolvedValue(adapter(fails ? [
        new ProviderError({ code: 'AUTHENTICATION', provider: 'openai-compatible', retryable: false, status: 401, messageKey: 'provider.error.authentication' }),
      ] : [{ type: 'tool-call', call: { id: '1', name: 'draftmd_capability_echo', input: { nonce: 'fixed-nonce' } } }])),
      persist: vi.fn(() => false), nonce: () => 'fixed-nonce', now: () => 100,
    })
    await expect(tester.testProvider(config.id, new AbortController().signal)).resolves.toMatchObject({
      capability: 'unavailable', cancelled: true, errorCode: null, warning: 'CONFIG_CHANGED',
    })
  })

  it('classifies streaming plus exact echo tool use as agent', async () => {
    const persist = vi.fn()
    const tester = createCapabilityTester({
      materialize: vi.fn().mockResolvedValue({ config, apiKey: null, headers: {} }),
      createAdapter: vi.fn().mockResolvedValue(adapter([
        { type: 'text-delta', text: 'Checking' },
        { type: 'tool-call', call: { id: '1', name: 'draftmd_capability_echo', input: { nonce: 'fixed-nonce' } } },
        { type: 'completed', stopReason: 'tool-use', assistantMessage: { role: 'assistant', provider: 'openai-compatible', content: [], providerData: null } },
      ])), persist, nonce: () => 'fixed-nonce', now: () => 100,
    })

    await expect(tester.testProvider(config.id, new AbortController().signal)).resolves.toEqual({
      capability: 'agent', cancelled: false, latencyMs: 0, model: 'test-model', errorCode: null, warning: null,
    })
    expect(persist).toHaveBeenCalledWith(config.id, expect.objectContaining({ capability: 'agent' }), config)
    const request = (tester.dependencies.createAdapter as ReturnType<typeof vi.fn>).mock.results[0]
    expect(request).toBeDefined()
  })

  it('classifies streaming text without a valid tool call as chat-only', async () => {
    const persist = vi.fn()
    const tester = createCapabilityTester({
      materialize: vi.fn().mockResolvedValue({ config, apiKey: null, headers: {} }),
      createAdapter: vi.fn().mockResolvedValue(adapter([
        { type: 'text-delta', text: 'fixed-nonce' },
        { type: 'completed', stopReason: 'end-turn', assistantMessage: { role: 'assistant', provider: 'openai-compatible', content: [], providerData: null } },
      ])), persist, nonce: () => 'fixed-nonce', now: () => 200,
    })
    await expect(tester.testProvider(config.id, new AbortController().signal)).resolves.toMatchObject({
      capability: 'chat-only', warning: null,
    })
  })

  it('classifies malformed or wrong echo tool calls as chat-only with warning', async () => {
    const tester = createCapabilityTester({
      materialize: vi.fn().mockResolvedValue({ config, apiKey: null, headers: {} }),
      createAdapter: vi.fn().mockResolvedValue(adapter([
        { type: 'tool-call', call: { id: '1', name: 'draftmd_capability_echo', input: { nonce: 'wrong' } } },
      ])), persist: vi.fn(), nonce: () => 'fixed-nonce', now: () => 300,
    })
    await expect(tester.testProvider(config.id, new AbortController().signal)).resolves.toMatchObject({
      capability: 'chat-only', warning: 'INVALID_TOOL_CALL',
    })
  })


  it('downgrades locally malformed tool JSON to chat-only instead of unavailable', async () => {
    const persist = vi.fn()
    const tester = createCapabilityTester({
      materialize: vi.fn().mockResolvedValue({ config, apiKey: null, headers: {} }),
      createAdapter: vi.fn().mockResolvedValue(adapter([
        new ProviderError({ code: 'BAD_REQUEST', provider: 'openai-compatible', retryable: false, status: null, messageKey: 'provider.error.badRequest' }),
      ])), persist, nonce: () => 'fixed-nonce', now: () => 350,
    })

    await expect(tester.testProvider(config.id, new AbortController().signal)).resolves.toMatchObject({
      capability: 'chat-only', errorCode: null, warning: 'INVALID_TOOL_CALL',
    })
    expect(persist).toHaveBeenCalledWith(config.id, expect.objectContaining({ capability: 'chat-only', errorCode: null }), config)
  })

  it('classifies provider failures as unavailable with a safe code', async () => {
    const persist = vi.fn()
    const tester = createCapabilityTester({
      materialize: vi.fn().mockResolvedValue({ config, apiKey: null, headers: {} }),
      createAdapter: vi.fn().mockResolvedValue(adapter([
        new ProviderError({ code: 'AUTHENTICATION', provider: 'openai-compatible', retryable: false, status: 401, messageKey: 'provider.error.authentication' }),
      ])), persist, nonce: () => 'fixed-nonce', now: () => 400,
    })
    await expect(tester.testProvider(config.id, new AbortController().signal)).resolves.toMatchObject({
      capability: 'unavailable', errorCode: 'AUTHENTICATION',
    })
    expect(persist).toHaveBeenCalledWith(config.id, expect.objectContaining({ errorCode: 'AUTHENTICATION' }), config)
  })

  it('does not persist or replace the previous capability when cancelled', async () => {
    const persist = vi.fn()
    const controller = new AbortController()
    controller.abort()
    const tester = createCapabilityTester({
      materialize: vi.fn().mockResolvedValue({ config: { ...config, capability: 'agent' }, apiKey: null, headers: {} }),
      createAdapter: vi.fn(), persist, nonce: () => 'fixed-nonce', now: () => 500,
    })
    await expect(tester.testProvider(config.id, controller.signal)).resolves.toEqual({
      capability: 'agent', cancelled: true, latencyMs: null, model: 'test-model', errorCode: null, warning: null,
    })
    expect(persist).not.toHaveBeenCalled()
  })

  it('offers only the non-mutating echo tool in the probe request', async () => {
    let captured: unknown
    const fake: ProviderAdapter = { stream: async function* (request) { captured = request; yield { type: 'completed', stopReason: 'end-turn', assistantMessage: { role: 'assistant', provider: 'openai-compatible', content: [], providerData: null } } } }
    const tester = createCapabilityTester({
      materialize: vi.fn().mockResolvedValue({ config, apiKey: null, headers: {} }),
      createAdapter: vi.fn().mockResolvedValue(fake), persist: vi.fn(), nonce: () => 'fixed-nonce', now: () => 600,
    })
    await tester.testProvider(config.id, new AbortController().signal)
    expect(captured).toMatchObject({ tools: [{
      name: 'draftmd_capability_echo', inputSchema: {
        type: 'object', properties: { nonce: { type: 'string' } }, required: ['nonce'], additionalProperties: false,
      },
    }] })
    expect(JSON.stringify(captured)).not.toContain('markdown_files')
    expect(JSON.stringify(captured)).not.toContain('workspace')
  })
})
