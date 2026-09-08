import type { ProviderConfigRecord } from '../persistence/provider-config-repository'
import type { ProviderAdapter } from './provider-adapter'
import { assertEndpointBeforeRequest } from './endpoint-policy'

export interface MaterializedProvider {
  config: ProviderConfigRecord
  apiKey: string | null
  headers: Record<string, string>
}

export async function createProviderAdapter(materialized: MaterializedProvider): Promise<ProviderAdapter> {
  const { config, apiKey, headers } = materialized
  await assertEndpointBeforeRequest(config.baseUrl, config.insecureHttpApproved)
  if (config.kind === 'anthropic') {
    if (!apiKey) throw Object.assign(new Error('Provider credential required'), { code: 'AUTHENTICATION' })
    const { createAnthropicAdapter } = await import('./anthropic/anthropic-adapter')
    return createAnthropicAdapter({ apiKey, model: config.model, baseUrl: config.baseUrl, timeoutMs: config.timeoutMs, reasoningEffort: config.reasoningEffort })
  }
  if (config.kind === 'openai') {
    if (!apiKey) throw Object.assign(new Error('Provider credential required'), { code: 'AUTHENTICATION' })
    const { createOpenAIAdapter } = await import('./openai/openai-adapter')
    return createOpenAIAdapter({ apiKey, model: config.model, timeoutMs: config.timeoutMs, apiMode: config.apiMode, reasoningEffort: config.reasoningEffort })
  }
  const { createOpenAICompatibleAdapter } = await import('./openai-compatible/openai-compatible-adapter')
  return createOpenAICompatibleAdapter({
    apiKey, model: config.model, baseUrl: config.baseUrl, timeoutMs: config.timeoutMs,
    headers, toolsEnabled: config.toolsEnabled, apiMode: config.apiMode,
    reasoningEffort: config.reasoningEffort,
  })
}
