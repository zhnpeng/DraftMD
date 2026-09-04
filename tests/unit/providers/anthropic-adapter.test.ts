import Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it, vi } from 'vitest'
import type { ProviderRequest } from '../../../src/shared/contracts/provider'
import {
  AnthropicAdapter,
  createAnthropicAdapter,
  type AnthropicClientBoundary,
  type AnthropicStreamBoundary,
} from '../../../src/main/providers/anthropic/anthropic-adapter'

const request: ProviderRequest = {
  system: 'Operate only on Markdown.',
  messages: [{ role: 'user', provider: null, content: [{ type: 'text', text: 'Read the spec' }], providerData: null }],
  tools: [{
    name: 'read_markdown', description: 'Read one Markdown file.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false },
  }],
  maxOutputTokens: 64_000,
}

function message(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5',
    content: [{ type: 'text', text: 'Done', citations: null }],
    stop_reason: 'end_turn', stop_sequence: null,
    usage: {
      input_tokens: 12, output_tokens: 4, cache_creation_input_tokens: 0,
      cache_read_input_tokens: 3, cache_creation: null, server_tool_use: null, service_tier: 'standard',
    },
    ...overrides,
  }
}

function fakeStream(final: ReturnType<typeof message>, textDeltas: string[] = []): AnthropicStreamBoundary {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>()
  return {
    on(event, listener) {
      const entries = listeners.get(event) ?? []
      entries.push(listener as (...args: unknown[]) => void)
      listeners.set(event, entries)
      return this
    },
    abort: vi.fn(),
    async finalMessage() {
      for (const delta of textDeltas) for (const listener of listeners.get('text') ?? []) listener(delta, '')
      return final as never
    },
  }
}

async function collect(adapter: AnthropicAdapter, signal = new AbortController().signal) {
  const events = []
  for await (const event of adapter.stream(request, signal)) events.push(event)
  return events
}

describe('AnthropicAdapter', () => {
  it('streams text and emits normalized usage plus complete assistant content', async () => {
    const stream = fakeStream(message(), ['Do', 'ne'])
    const client: AnthropicClientBoundary = { messages: { stream: vi.fn(() => stream) } }
    const events = await collect(new AnthropicAdapter(client, {
      model: 'claude-opus-5', baseUrl: 'https://api.anthropic.com', timeoutMs: 60_000,
    }, Anthropic))

    expect(events).toEqual([
      { type: 'text-delta', text: 'Do' },
      { type: 'text-delta', text: 'ne' },
      { type: 'usage', inputTokens: 12, outputTokens: 4, cachedInputTokens: 3 },
      { type: 'completed', stopReason: 'end-turn', assistantMessage: {
        role: 'assistant', provider: 'anthropic', content: [{ type: 'text', text: 'Done' }],
        providerData: message().content,
      } },
    ])
    expect(client.messages.stream).toHaveBeenCalledWith(expect.objectContaining({
      model: 'claude-opus-5', max_tokens: 64_000, thinking: { type: 'adaptive' },
      system: 'Operate only on Markdown.',
      tools: [expect.objectContaining({ name: 'read_markdown', strict: true })],
    }), { signal: expect.any(AbortSignal) })
  })


  it.each([
    ['claude-opus-5', true],
    ['claude-opus-4-8', true],
    ['claude-opus-4-6', true],
    ['claude-sonnet-4-6', true],
    ['claude-haiku-4-5-20251001', false],
    ['custom-claude-compatible', false],
  ])('adds adaptive thinking only for a known supporting model %s', async (model, adaptive) => {
    const create = vi.fn(() => fakeStream(message()))
    const adapter = new AnthropicAdapter({ messages: { stream: create } }, {
      model, baseUrl: 'https://api.anthropic.com', timeoutMs: 60_000,
    }, Anthropic)
    await collect(adapter)
    const body = create.mock.calls[0][0] as Record<string, unknown>
    expect(body.thinking).toEqual(adaptive ? { type: 'adaptive' } : undefined)
  })

  it('emits every complete parallel tool call without parsing assistant text', async () => {
    const final = message({
      stop_reason: 'tool_use',
      content: [
        { type: 'text', text: 'I will read both.', citations: null },
        { type: 'tool_use', id: 'call-1', name: 'read_markdown', input: { path: 'a.md' } },
        { type: 'tool_use', id: 'call-2', name: 'read_markdown', input: { path: 'b.md' } },
      ],
    })
    const adapter = new AnthropicAdapter({ messages: { stream: () => fakeStream(final) } }, {
      model: 'claude-opus-5', baseUrl: 'https://api.anthropic.com', timeoutMs: 60_000,
    }, Anthropic)

    const events = await collect(adapter)

    expect(events.filter((event) => event.type === 'tool-call')).toEqual([
      { type: 'tool-call', call: { id: 'call-1', name: 'read_markdown', input: { path: 'a.md' } } },
      { type: 'tool-call', call: { id: 'call-2', name: 'read_markdown', input: { path: 'b.md' } } },
    ])
    expect(events.at(-1)).toMatchObject({ type: 'completed', stopReason: 'tool-use' })
  })

  it.each([
    ['max_tokens', 'max-tokens'],
    ['stop_sequence', 'stop-sequence'],
    ['refusal', 'refusal'],
    ['pause_turn', 'unknown'],
  ])('normalizes stop reason %s', async (source, expected) => {
    const adapter = new AnthropicAdapter({ messages: { stream: () => fakeStream(message({ stop_reason: source })) } }, {
      model: 'claude-opus-5', baseUrl: 'https://api.anthropic.com', timeoutMs: 60_000,
    }, Anthropic)
    expect((await collect(adapter)).at(-1)).toMatchObject({ type: 'completed', stopReason: expected })
  })

  it('continues with exact provider-private assistant content and structured tool results', async () => {
    const privateContent = [{ type: 'tool_use', id: 'call-1', name: 'read_markdown', input: { path: 'a.md' } }]
    const continuation: ProviderRequest = {
      ...request,
      messages: [
        { role: 'user', provider: null, content: [{ type: 'text', text: 'Read it' }], providerData: null },
        { role: 'assistant', provider: 'anthropic', content: [{ type: 'tool-call', call: { id: 'call-1', name: 'read_markdown', input: { path: 'a.md' } } }], providerData: privateContent },
        { role: 'user', provider: null, content: [{ type: 'tool-result', callId: 'call-1', content: { content: '# A' }, isError: false }], providerData: null },
      ],
    }
    const client: AnthropicClientBoundary = { messages: { stream: vi.fn(() => fakeStream(message())) } }
    const adapter = new AnthropicAdapter(client, {
      model: 'claude-opus-5', baseUrl: 'https://api.anthropic.com', timeoutMs: 60_000,
    }, Anthropic)

    for await (const _ of adapter.stream(continuation, new AbortController().signal)) { /* consume */ }

    expect(client.messages.stream).toHaveBeenCalledWith(expect.objectContaining({ messages: [
      { role: 'user', content: [{ type: 'text', text: 'Read it' }] },
      { role: 'assistant', content: privateContent },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call-1', content: '{"content":"# A"}', is_error: false }] },
    ] }), expect.any(Object))
  })

  it('aborts the SDK stream when the caller cancels', async () => {
    const controller = new AbortController()
    let resolveFinal!: (value: never) => void
    const stream = fakeStream(message())
    stream.finalMessage = () => new Promise((resolve) => { resolveFinal = resolve })
    const adapter = new AnthropicAdapter({ messages: { stream: () => stream } }, {
      model: 'claude-opus-5', baseUrl: 'https://api.anthropic.com', timeoutMs: 60_000,
    }, Anthropic)
    const collecting = collect(adapter, controller.signal)

    controller.abort()
    resolveFinal(message() as never)

    await expect(collecting).rejects.toMatchObject({ code: 'CANCELLED', provider: 'anthropic' })
    expect(stream.abort).toHaveBeenCalledOnce()
  })

  it.each([
    [Anthropic.APIError.generate(401, {}, 'private response', new Headers()), 'AUTHENTICATION', false],
    [Anthropic.APIError.generate(404, {}, 'private response', new Headers()), 'MODEL_NOT_FOUND', false],
    [Anthropic.APIError.generate(429, {}, 'private response', new Headers()), 'RATE_LIMIT', true],
    [Anthropic.APIError.generate(400, {}, 'private response', new Headers()), 'BAD_REQUEST', false],
    [new Anthropic.APIConnectionTimeoutError(), 'TIMEOUT', true],
    [new Anthropic.APIConnectionError({ message: 'private network detail' }), 'CONNECTION', true],
    [Anthropic.APIError.generate(500, {}, 'private response', new Headers()), 'PROVIDER_ERROR', true],
  ])('normalizes typed SDK error %#', async (sdkError, code, retryable) => {
    const stream = fakeStream(message())
    stream.finalMessage = vi.fn().mockRejectedValue(sdkError)
    const adapter = new AnthropicAdapter({ messages: { stream: () => stream } }, {
      model: 'claude-opus-5', baseUrl: 'https://api.anthropic.com', timeoutMs: 60_000,
    }, Anthropic)

    let thrown: unknown
    try { await collect(adapter) } catch (error) { thrown = error }
    expect(thrown).toMatchObject({ code, retryable, provider: 'anthropic' })
    expect(JSON.stringify(thrown)).not.toContain('private response')
    expect(JSON.stringify(thrown)).not.toContain('private network detail')
  })

  it('creates the official client lazily with configured connection options', async () => {
    const constructor = vi.fn(function () { return { messages: { stream: () => fakeStream(message()) } } })
    const importer = vi.fn().mockResolvedValue({ default: constructor, ...Anthropic })

    const adapter = await createAnthropicAdapter({
      apiKey: 'key', model: 'claude-opus-5', baseUrl: 'https://proxy.example.com', timeoutMs: 9_000,
    }, importer)

    expect(importer).toHaveBeenCalledOnce()
    expect(constructor).toHaveBeenCalledWith({ apiKey: 'key', baseURL: 'https://proxy.example.com', timeout: 9_000, maxRetries: 2 })
    expect(adapter).toBeInstanceOf(AnthropicAdapter)
  })
})
