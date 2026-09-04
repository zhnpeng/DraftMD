import { describe, expect, it } from 'vitest'
import {
  ProviderConfigSchema,
  ProviderEventSchema,
  ProviderRequestSchema,
  ToolCallSchema,
} from '../../../src/shared/contracts/provider'
import { ProviderError } from '../../../src/main/providers/provider-errors'

const config = {
  id: '01991d5a-1c00-7000-8000-000000000000',
  name: 'Local model',
  kind: 'openai-compatible',
  preset: 'ollama',
  baseUrl: 'http://127.0.0.1:11434/v1',
  model: 'qwen3',
  credentialRef: null,
  headerCredentialRefs: {},
  timeoutMs: 60_000,
  streamEnabled: true,
  toolsEnabled: true,
  insecureHttpApproved: false,
  capability: 'unavailable',
  lastTestedAt: null,
  lastTestErrorCode: null,
} as const

describe('ProviderConfigSchema', () => {
  it('accepts the exact provider-neutral persisted configuration', () => {
    expect(ProviderConfigSchema.parse(config)).toEqual(config)
  })

  it('rejects unknown fields and unsupported provider kinds', () => {
    expect(() => ProviderConfigSchema.parse({ ...config, apiKey: 'secret' })).toThrow()
    expect(() => ProviderConfigSchema.parse({ ...config, kind: 'gemini' })).toThrow()
  })

  it('does not permit raw sensitive headers or API keys in serialized configs', () => {
    const serialized = JSON.stringify(ProviderConfigSchema.parse({
      ...config,
      credentialRef: '01991d5a-1c00-7000-8000-000000000001',
      headerCredentialRefs: { Authorization: '01991d5a-1c00-7000-8000-000000000002' },
    }))

    expect(serialized).not.toContain('api-key-value')
    expect(serialized).not.toContain('Bearer secret')
    expect(serialized).not.toContain('headerValues')
  })
})

describe('provider request and event contracts', () => {
  it('accepts JSON tool inputs but rejects executable and non-JSON values', () => {
    expect(ToolCallSchema.parse({ id: 'call-1', name: 'read_markdown', input: { path: 'spec.md' } })).toEqual({
      id: 'call-1', name: 'read_markdown', input: { path: 'spec.md' },
    })
    expect(() => ToolCallSchema.parse({ id: 'call-1', name: 'x', input: { run() {} } })).toThrow()
    expect(() => ToolCallSchema.parse({ id: 'call-1', name: 'x', input: BigInt(1) })).toThrow()
  })

  it('rejects negative or non-integer token usage', () => {
    expect(() => ProviderEventSchema.parse({ type: 'usage', inputTokens: -1, outputTokens: 2 })).toThrow()
    expect(() => ProviderEventSchema.parse({ type: 'usage', inputTokens: 1.2, outputTokens: 2 })).toThrow()
  })

  it('rejects duplicate tool call ids within a completed assistant message', () => {
    const duplicate = {
      type: 'completed', stopReason: 'tool-use',
      assistantMessage: {
        role: 'assistant', provider: 'anthropic',
        content: [
          { type: 'tool-call', call: { id: 'same', name: 'first', input: {} } },
          { type: 'tool-call', call: { id: 'same', name: 'second', input: {} } },
        ],
        providerData: null,
      },
    }
    expect(() => ProviderEventSchema.parse(duplicate)).toThrow()
  })

  it('keeps tool definitions strict and request fields provider-neutral', () => {
    const request = ProviderRequestSchema.parse({
      system: 'Operate only on Markdown.',
      messages: [{ role: 'user', provider: null, content: [{ type: 'text', text: 'Read spec' }], providerData: null }],
      tools: [{
        name: 'read_markdown', description: 'Read one Markdown file.',
        inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false },
      }],
      maxOutputTokens: 64_000,
    })
    expect(request.tools[0].inputSchema).toEqual({
      type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false,
    })
    expect(JSON.stringify(request)).not.toContain('thinking')
    expect(JSON.stringify(request)).not.toContain('temperature')
  })
})

describe('ProviderError', () => {
  it('serializes only safe normalized metadata', () => {
    const error = new ProviderError({
      code: 'RATE_LIMIT', provider: 'anthropic', retryable: true, status: 429,
      messageKey: 'provider.error.rateLimit',
      cause: new Error('response body contains private prompt and sk-secret'),
    })

    expect(error.toJSON()).toEqual({
      code: 'RATE_LIMIT', provider: 'anthropic', retryable: true, status: 429,
      messageKey: 'provider.error.rateLimit',
    })
    expect(JSON.stringify(error)).not.toContain('private prompt')
    expect(JSON.stringify(error)).not.toContain('sk-secret')
  })
})
