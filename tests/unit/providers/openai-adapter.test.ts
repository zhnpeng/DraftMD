import * as OpenAI from 'openai'
import { describe, expect, it, vi } from 'vitest'
import type { ProviderRequest } from '../../../src/shared/contracts/provider'
import {
  OpenAIAdapter,
  createOpenAIAdapter,
  type OpenAIClientBoundary,
} from '../../../src/main/providers/openai/openai-adapter'
import { createOpenAICompatibleAdapter } from '../../../src/main/providers/openai-compatible/openai-compatible-adapter'
import { toolDefinitions } from '../../../src/main/agent/tools/definitions'
import { parseToolCall } from '../../../src/main/agent/tools/schemas'
import { toOpenAITools } from '../../../src/main/providers/openai/openai-messages'

const request: ProviderRequest = {
  system: 'Markdown only.',
  messages: [{ role: 'user', provider: null, content: [{ type: 'text', text: 'Read files' }], providerData: null }],
  tools: [{ name: 'read_markdown', description: 'Read Markdown.', inputSchema: {
    type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false,
  } }],
  maxOutputTokens: 8_000,
}

function chunk(input: Record<string, unknown> = {}) {
  return {
    id: 'chatcmpl-1', object: 'chat.completion.chunk', created: 1, model: 'gpt-test',
    choices: [{ index: 0, delta: {}, finish_reason: null }], ...input,
  }
}

async function* chunks(values: unknown[]): AsyncIterable<never> {
  for (const value of values) yield value as never
}

async function collect(adapter: OpenAIAdapter, signal = new AbortController().signal) {
  const events = []
  for await (const event of adapter.stream(request, signal)) events.push(event)
  return events
}

describe('OpenAIAdapter', () => {
  it('encodes every actual workspace tool as a strict schema without changing local optional arguments', () => {
    const original = structuredClone(toolDefinitions)
    const tools = toOpenAITools(toolDefinitions)
    for (const tool of tools) {
      expect(tool.type).toBe('function')
      if (tool.type !== 'function') continue
      expect(tool.function.strict).toBe(true)
      const schema = tool.function.parameters!
      expect(schema.additionalProperties).toBe(false)
      expect(new Set(schema.required as string[])).toEqual(new Set(Object.keys(schema.properties as object)))
    }
    expect(tools.find(tool => tool.type === 'function' && tool.function.name === 'search_markdown')).toMatchObject({
      function: { parameters: { properties: { limit: { anyOf: [{ type: 'integer', minimum: 1, maximum: 50 }, { type: 'null' }] } } } },
    })
    expect(toolDefinitions).toEqual(original)
  })

  it.each([
    ['search_markdown', { query: 'draft', limit: null }, { query: 'draft' }],
    ['read_markdown', { path: 'draft.md', heading: null, startLine: null, endLine: null }, { path: 'draft.md' }],
    ['read_markdown', { path: 'draft.md', heading: null, startLine: 2, endLine: 5 }, { path: 'draft.md', startLine: 2, endLine: 5 }],
  ])('restores omitted optional %s arguments while retaining the original provider transcript', async (name, wireInput, localInput) => {
    const argumentsText = JSON.stringify(wireInput)
    const adapter = new OpenAIAdapter({ chat: { completions: { create: vi.fn().mockResolvedValue(chunks([
      chunk({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call-nullable', type: 'function', function: { name, arguments: argumentsText } }] }, finish_reason: 'tool_calls' }] }),
    ])) } } }, {
      kind: 'openai-compatible', model: 'mock-model', baseUrl: 'http://127.0.0.1/v1', timeoutMs: 5000, toolsEnabled: true,
    }, OpenAI)
    const events = []
    for await (const event of adapter.stream({ ...request, tools: toolDefinitions }, new AbortController().signal)) events.push(event)
    const call = events.find(event => event.type === 'tool-call')
    expect(call).toMatchObject({ call: { name, input: localInput } })
    if (call?.type !== 'tool-call') throw new Error('Missing tool call')
    expect(parseToolCall(call.call).input).toEqual(localInput)
    expect(events.at(-1)).toMatchObject({ assistantMessage: { providerData: { toolCalls: [{ function: { arguments: argumentsText } }] } } })
  })

  it('normalizes text, usage, stop reason, and the completed assistant message', async () => {
    const client: OpenAIClientBoundary = { chat: { completions: { create: vi.fn().mockResolvedValue(chunks([
      chunk({ choices: [{ index: 0, delta: { content: 'Hello' }, finish_reason: null }] }),
      chunk({ choices: [{ index: 0, delta: { content: ' world' }, finish_reason: 'stop' }] }),
      chunk({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13, prompt_tokens_details: { cached_tokens: 4 } } }),
    ])) } } }
    const events = await collect(new OpenAIAdapter(client, {
      kind: 'openai', model: 'gpt-test', baseUrl: 'https://api.openai.com/v1', timeoutMs: 60_000, toolsEnabled: true,
    }, OpenAI))

    expect(events).toEqual([
      { type: 'text-delta', text: 'Hello' },
      { type: 'text-delta', text: ' world' },
      { type: 'usage', inputTokens: 10, outputTokens: 3, cachedInputTokens: 4 },
      { type: 'completed', stopReason: 'end-turn', assistantMessage: {
        role: 'assistant', provider: 'openai', content: [{ type: 'text', text: 'Hello world' }],
        providerData: { content: 'Hello world', toolCalls: [] },
      } },
    ])
    expect(client.chat.completions.create).toHaveBeenCalledWith(expect.objectContaining({
      stream: true, stream_options: { include_usage: true }, model: 'gpt-test', max_completion_tokens: 8_000,
      tools: [expect.objectContaining({ type: 'function', function: expect.objectContaining({ strict: true }) })],
    }), { signal: expect.any(AbortSignal) })
  })

  it.each([{ query: null, limit: null }, { query: 'draft', limit: null, unknown: null }])('preserves invalid required or unknown null arguments for local rejection: %j', async wireInput => {
    const adapter = new OpenAIAdapter({ chat: { completions: { create: vi.fn().mockResolvedValue(chunks([
      chunk({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call-invalid', type: 'function', function: { name: 'search_markdown', arguments: JSON.stringify(wireInput) } }] }, finish_reason: 'tool_calls' }] }),
    ])) } } }, {
      kind: 'openai-compatible', model: 'mock-model', baseUrl: 'http://127.0.0.1/v1', timeoutMs: 5000, toolsEnabled: true,
    }, OpenAI)
    for await (const event of adapter.stream({ ...request, tools: toolDefinitions }, new AbortController().signal)) {
      if (event.type === 'tool-call') {
        expect(() => parseToolCall(event.call)).toThrowError(expect.objectContaining({ code: 'INVALID_TOOL_CALL' }))
        expect(Object.hasOwn(event.call.input as object, 'unknown')).toBe(Object.hasOwn(wireInput, 'unknown'))
        expect((event.call.input as { query: unknown }).query).toBe(wireInput.query)
        return
      }
    }
    throw new Error('Missing tool call')
  })

  it('buffers interleaved parallel tool argument deltas and parses each exactly once', async () => {
    const parse = vi.spyOn(JSON, 'parse')
    const adapter = new OpenAIAdapter({ chat: { completions: { create: vi.fn().mockResolvedValue(chunks([
      chunk({ choices: [{ index: 0, delta: { tool_calls: [
        { index: 0, id: 'call-a', type: 'function', function: { name: 'read_markdown', arguments: '{"path":"a' } },
        { index: 1, id: 'call-b', type: 'function', function: { name: 'read_markdown', arguments: '{"path":"b' } },
      ] }, finish_reason: null }] }),
      chunk({ choices: [{ index: 0, delta: { tool_calls: [
        { index: 1, function: { arguments: '.md"}' } },
        { index: 0, function: { arguments: '.md"}' } },
      ] }, finish_reason: 'tool_calls' }] }),
    ])) } } }, {
      kind: 'openai', model: 'gpt-test', baseUrl: 'https://api.openai.com/v1', timeoutMs: 60_000, toolsEnabled: true,
    }, OpenAI)

    const events = await collect(adapter)

    expect(events.filter((event) => event.type === 'tool-call')).toEqual([
      { type: 'tool-call', call: { id: 'call-a', name: 'read_markdown', input: { path: 'a.md' } } },
      { type: 'tool-call', call: { id: 'call-b', name: 'read_markdown', input: { path: 'b.md' } } },
    ])
    expect(parse).toHaveBeenCalledTimes(2)
    parse.mockRestore()
  })

  it('rejects malformed completed tool JSON without emitting a call', async () => {
    const adapter = new OpenAIAdapter({ chat: { completions: { create: vi.fn().mockResolvedValue(chunks([
      chunk({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'bad', type: 'function', function: { name: 'read_markdown', arguments: '{bad' } }] }, finish_reason: 'tool_calls' }] }),
    ])) } } }, {
      kind: 'openai-compatible', model: 'local', baseUrl: 'http://127.0.0.1:11434/v1', timeoutMs: 60_000, toolsEnabled: true,
    }, OpenAI)

    await expect(collect(adapter)).rejects.toMatchObject({ code: 'BAD_REQUEST', provider: 'openai-compatible' })
  })

  it.each([
    ['stop', 'end-turn'], ['tool_calls', 'tool-use'], ['length', 'max-tokens'],
    ['content_filter', 'content-filter'], ['function_call', 'unknown'],
  ])('normalizes finish reason %s', async (source, expected) => {
    const adapter = new OpenAIAdapter({ chat: { completions: { create: vi.fn().mockResolvedValue(chunks([
      chunk({ choices: [{ index: 0, delta: { content: 'Reply' }, finish_reason: source }] }),
    ])) } } }, {
      kind: 'openai', model: 'gpt-test', baseUrl: 'https://api.openai.com/v1', timeoutMs: 60_000, toolsEnabled: true,
    }, OpenAI)
    expect((await collect(adapter)).at(-1)).toMatchObject({ type: 'completed', stopReason: expected })
  })

  it('continues with provider-private assistant calls and tool results', async () => {
    const continuation: ProviderRequest = { ...request, messages: [
      { role: 'assistant', provider: 'openai', content: [], providerData: {
        content: null, toolCalls: [{ id: 'call-1', type: 'function', function: { name: 'read_markdown', arguments: '{"path":"a.md"}' } }],
      } },
      { role: 'user', provider: null, content: [{ type: 'tool-result', callId: 'call-1', content: { content: '# A' }, isError: false }], providerData: null },
    ] }
    const create = vi.fn().mockResolvedValue(chunks([chunk({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })]))
    const adapter = new OpenAIAdapter({ chat: { completions: { create } } }, {
      kind: 'openai', model: 'gpt-test', baseUrl: 'https://api.openai.com/v1', timeoutMs: 60_000, toolsEnabled: true,
    }, OpenAI)

    for await (const _ of adapter.stream(continuation, new AbortController().signal)) { /* consume */ }

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ messages: [
      expect.objectContaining({ role: 'system' }),
      expect.objectContaining({ role: 'assistant', tool_calls: expect.any(Array) }),
      { role: 'tool', tool_call_id: 'call-1', content: '{"content":"# A"}' },
    ] }), expect.any(Object))
  })

  it.each([
    [OpenAI.APIError.generate(401, {}, 'private response', new Headers()), 'AUTHENTICATION', false],
    [OpenAI.APIError.generate(404, {}, 'private response', new Headers()), 'MODEL_NOT_FOUND', false],
    [OpenAI.APIError.generate(429, {}, 'private response', new Headers()), 'RATE_LIMIT', true],
    [OpenAI.APIError.generate(400, { error: { code: 'insufficient_quota', type: 'insufficient_quota' } }, 'private response', new Headers()), 'INSUFFICIENT_QUOTA', false],
    [new OpenAI.APIConnectionTimeoutError(), 'TIMEOUT', true],
    [new OpenAI.APIConnectionError({ message: 'private connection' }), 'CONNECTION', true],
    [OpenAI.APIError.generate(500, {}, 'private response', new Headers()), 'PROVIDER_ERROR', true],
  ])('normalizes typed SDK error %#', async (sdkError, code, retryable) => {
    const adapter = new OpenAIAdapter({ chat: { completions: { create: vi.fn().mockRejectedValue(sdkError) } } }, {
      kind: 'openai', model: 'gpt-test', baseUrl: 'https://api.openai.com/v1', timeoutMs: 60_000, toolsEnabled: true,
    }, OpenAI)
    let thrown: unknown
    try { await collect(adapter) } catch (error) { thrown = error }
    expect(thrown).toMatchObject({ code, retryable, provider: 'openai' })
    expect(JSON.stringify(thrown)).not.toContain('private response')
  })

  it('turns an aborted request into CANCELLED', async () => {
    const controller = new AbortController()
    const create = vi.fn().mockImplementation(async (_body, options) => {
      await new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new OpenAI.APIUserAbortError())))
    })
    const adapter = new OpenAIAdapter({ chat: { completions: { create } } }, {
      kind: 'openai', model: 'gpt-test', baseUrl: 'https://api.openai.com/v1', timeoutMs: 60_000, toolsEnabled: true,
    }, OpenAI)
    const collecting = collect(adapter, controller.signal)
    controller.abort()
    await expect(collecting).rejects.toMatchObject({ code: 'CANCELLED' })
  })

  it('creates native and compatible SDK clients lazily with materialized connection options', async () => {
    const constructor = vi.fn(function () { return { chat: { completions: { create: vi.fn() } } } })
    const importer = vi.fn().mockResolvedValue({ ...OpenAI, default: constructor })

    await createOpenAIAdapter({ apiKey: 'key', model: 'gpt-test', timeoutMs: 9_000 }, importer)
    await createOpenAICompatibleAdapter({ apiKey: null, model: 'local', baseUrl: 'http://127.0.0.1:11434/v1', timeoutMs: 8_000, headers: { token: 'secret' }, toolsEnabled: false }, importer)

    expect(constructor.mock.calls).toEqual([
      [{ apiKey: 'key', timeout: 9_000, maxRetries: 2 }],
      [{ apiKey: 'draftmd-local-no-key', baseURL: 'http://127.0.0.1:11434/v1', timeout: 8_000, maxRetries: 2, defaultHeaders: { token: 'secret' } }],
    ])
  })
})
