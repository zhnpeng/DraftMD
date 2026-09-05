import { OpenAIAdapter } from '../openai/openai-adapter'
import type { OpenAISDKModule } from '../openai/openai-errors'
import { ResponsesAdapter } from '../openai/responses-adapter'
import type { ProviderApiMode } from '../../../shared/contracts/provider'
import type { ProviderAdapter } from '../provider-adapter'

export async function createOpenAICompatibleAdapter(
  input: { apiKey: string | null; model: string; baseUrl: string; timeoutMs: number; headers: Record<string, string>; toolsEnabled: boolean; apiMode?: ProviderApiMode },
  importer: () => Promise<OpenAISDKModule> = () => import('openai'),
): Promise<ProviderAdapter> {
  const sdk = await importer()
  const client = new sdk.default({
    apiKey: input.apiKey || 'draftmd-local-no-key', baseURL: input.baseUrl,
    timeout: input.timeoutMs, maxRetries: 2, defaultHeaders: input.headers,
  })
  const Adapter = input.apiMode === 'responses' ? ResponsesAdapter : OpenAIAdapter
  return new Adapter(client, { kind: 'openai-compatible', model: input.model, baseUrl: input.baseUrl, timeoutMs: input.timeoutMs, toolsEnabled: input.toolsEnabled }, sdk)
}
