import type { CapabilityTestResult, ProviderConfig, ProviderErrorCode, ProviderRequest } from '../../shared/contracts/provider'
import type { MaterializedProvider } from './provider-factory'
import type { ProviderAdapter } from './provider-adapter'
import { ProviderError } from './provider-errors'

const ECHO_TOOL = {
  name: 'draftmd_capability_echo',
  description: 'Return the supplied nonce unchanged to verify structured tool calling.',
  inputSchema: {
    type: 'object' as const,
    properties: { nonce: { type: 'string' } },
    required: ['nonce'],
    additionalProperties: false as const,
  },
}

export interface CapabilityTestDependencies {
  materialize(id: string): Promise<MaterializedProvider>
  createAdapter(provider: MaterializedProvider): Promise<ProviderAdapter>
  persist(id: string, result: {
    capability: ProviderConfig['capability']
    testedAt: string
    model: string
    latencyMs: number
    errorCode: ProviderErrorCode | null
  }): void
  nonce(): string
  now(): number
}

function safeCode(error: unknown): ProviderErrorCode {
  if (error instanceof ProviderError) return error.code
  const code = (error as { code?: unknown }).code
  if (typeof code === 'string' && [
    'AUTHENTICATION', 'RATE_LIMIT', 'INSUFFICIENT_QUOTA', 'MODEL_NOT_FOUND', 'CONTEXT_LIMIT',
    'TIMEOUT', 'CONNECTION', 'BAD_REQUEST', 'REFUSAL', 'CANCELLED', 'PROVIDER_ERROR',
  ].includes(code)) return code as ProviderErrorCode
  return 'PROVIDER_ERROR'
}

export function createCapabilityTester(dependencies: CapabilityTestDependencies) {
  return {
    dependencies,
    async testProvider(id: string, signal: AbortSignal): Promise<CapabilityTestResult> {
      const materialized = await dependencies.materialize(id)
      const { config } = materialized
      if (signal.aborted) return {
        capability: config.capability, cancelled: true, latencyMs: null,
        model: config.model, errorCode: null, warning: null,
      }
      const nonce = dependencies.nonce()
      const request: ProviderRequest = {
        system: 'Call the supplied capability echo tool exactly once with the requested nonce. Do not perform any other action.',
        messages: [{ role: 'user', provider: null, content: [{ type: 'text', text: `Call draftmd_capability_echo with nonce ${nonce}.` }], providerData: null }],
        tools: [ECHO_TOOL], maxOutputTokens: 1_024,
      }
      const started = dependencies.now()
      let sawText = false
      let validTool = false
      let invalidTool = false
      try {
        const adapter = await dependencies.createAdapter(materialized)
        for await (const event of adapter.stream(request, signal)) {
          if (event.type === 'text-delta' && event.text.length) sawText = true
          if (event.type === 'tool-call') {
            const input = event.call.input as { nonce?: unknown }
            if (event.call.name === ECHO_TOOL.name && input?.nonce === nonce) validTool = true
            else invalidTool = true
          }
        }
        if (signal.aborted) return {
          capability: config.capability, cancelled: true, latencyMs: null,
          model: config.model, errorCode: null, warning: null,
        }
        const latencyMs = Math.max(0, dependencies.now() - started)
        const capability = validTool ? 'agent' : 'chat-only'
        const warning = invalidTool ? 'INVALID_TOOL_CALL' : null
        dependencies.persist(id, {
          capability, testedAt: new Date().toISOString(), model: config.model, latencyMs, errorCode: null,
        })
        return { capability, cancelled: false, latencyMs, model: config.model, errorCode: null, warning }
      } catch (error) {
        const code = safeCode(error)
        if (signal.aborted || code === 'CANCELLED') return {
          capability: config.capability, cancelled: true, latencyMs: null,
          model: config.model, errorCode: null, warning: null,
        }
        const latencyMs = Math.max(0, dependencies.now() - started)
        if (error instanceof ProviderError && code === 'BAD_REQUEST' && error.status === null) {
          dependencies.persist(id, {
            capability: 'chat-only', testedAt: new Date().toISOString(), model: config.model, latencyMs, errorCode: null,
          })
          return { capability: 'chat-only', cancelled: false, latencyMs, model: config.model, errorCode: null, warning: 'INVALID_TOOL_CALL' }
        }
        dependencies.persist(id, {
          capability: 'unavailable', testedAt: new Date().toISOString(), model: config.model, latencyMs, errorCode: code,
        })
        return { capability: 'unavailable', cancelled: false, latencyMs, model: config.model, errorCode: code, warning: null }
      }
    },
  }
}
