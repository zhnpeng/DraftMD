import { ProviderModelSchema, type ProviderConfigDTO, type ProviderModelListInput, type ProviderModelListResult, type ProviderSecretsInput } from '../../shared/contracts/provider'
import { assertEndpointBeforeRequest } from './endpoint-policy'
import { normalizeOpenAIError } from './openai/openai-errors'
import { normalizeAnthropicError } from './anthropic/anthropic-errors'

interface CatalogProviders {
  listConfigs(): ProviderConfigDTO[]
  materialize(id: string): Promise<{ apiKey: string | null; headers: Record<string, string> }>
}
const empty = (errorCode: ProviderModelListResult['errorCode']): ProviderModelListResult => ({ models: [], errorCode, truncated: false })
const endpointKey = (url: string): string => new URL(url).href.replace(/\/$/, '')

function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = (): void => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

export function createProviderModelCatalog(providers: CatalogProviders) {
  return {
    async listModels(input: ProviderModelListInput, secrets: ProviderSecretsInput, signal?: AbortSignal): Promise<ProviderModelListResult> {
      const timeout = AbortSignal.timeout(Math.min(input.timeoutMs, 15_000))
      const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
      try {
        const saved = input.id ? providers.listConfigs().find(config => config.id === input.id) : null
        if (input.id && !saved) return empty('BAD_REQUEST')
        const removedHeaders = new Set((secrets.removeHeaders ?? []).map(name => name.toLowerCase()))
        const newHeaders = Object.fromEntries(Object.entries(secrets.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]))
        const retainKey = saved?.hasCredential && !secrets.removeApiKey && !secrets.apiKey
        const retainHeaders = saved?.headerNames.filter(name => !removedHeaders.has(name.toLowerCase()) && !newHeaders[name.toLowerCase()]) ?? []
        let stored: { apiKey: string | null; headers: Record<string, string> } = { apiKey: null, headers: {} }
        if (saved && (retainKey || retainHeaders.length)) {
          if (saved.kind !== input.kind || endpointKey(saved.baseUrl) !== endpointKey(input.baseUrl)) return empty('SAVED_CREDENTIALS_MISMATCH')
          stored = await withAbort(providers.materialize(saved.id), requestSignal)
        }
        const apiKey = secrets.removeApiKey ? null : secrets.apiKey || stored.apiKey
        const headers = { ...Object.fromEntries(retainHeaders.map(name => [name.toLowerCase(), stored.headers[name.toLowerCase()]])), ...newHeaders }
        if (input.kind !== 'openai-compatible' && !apiKey) return empty('AUTHENTICATION')
        await withAbort(assertEndpointBeforeRequest(input.baseUrl, input.insecureHttpApproved), requestSignal)
        const options = { signal: requestSignal }
        // SDKs merge environment headers even with an explicit API key. Only send this configuration's headers.
        const requestHeaders = new Headers({ accept: 'application/json' })
        if (input.kind === 'anthropic') {
          requestHeaders.set('anthropic-version', '2023-06-01')
          if (apiKey) requestHeaders.set('x-api-key', apiKey)
        } else if (apiKey) requestHeaders.set('authorization', `Bearer ${apiKey}`)
        for (const [name, value] of Object.entries(headers)) {
          if (typeof value === 'string') requestHeaders.set(name, value)
        }
        const requestFetch: typeof fetch = (url, init) => fetch(url, { ...init, headers: requestHeaders, redirect: 'error' })
        const clientOptions = {
          apiKey: apiKey || 'draftmd-local-no-key', baseURL: input.baseUrl,
          defaultHeaders: headers, maxRetries: 0, timeout: Math.min(input.timeoutMs, 15_000),
          fetchOptions: { redirect: 'error' as const },
          fetch: requestFetch, logLevel: 'off' as const,
        }
        const models = new Map<string, ProviderModelListResult['models'][number]>()
        const add = (rows: unknown): boolean => {
          if (!Array.isArray(rows)) throw new Error('Invalid model list')
          for (const row of rows) {
            if (models.size >= 1000) return true
            const model = ProviderModelSchema.parse({ id: row?.id, name: row?.display_name || row?.id })
            models.set(model.id, model)
          }
          return false
        }
        let truncated = false
        if (input.kind === 'anthropic') {
          const sdk = await import('@anthropic-ai/sdk')
          try {
            const client = new sdk.default({ ...clientOptions, authToken: null, webhookKey: null })
            let page = await client.models.list({ limit: 100 }, options)
            for (let count = 0; ; count++) {
              truncated = add(page.data)
              if (truncated || !page.hasNextPage()) break
              if (count >= 9 || models.size >= 1000) { truncated = true; break }
              page = await page.getNextPage()
            }
          } catch (error) { throw normalizeAnthropicError(error, sdk) }
        } else {
          const sdk = await import('openai')
          try {
            const client = new sdk.default({ ...clientOptions, adminAPIKey: null, organization: null, project: null, webhookSecret: null })
            const page = await client.models.list(options)
            truncated = add(page.data)
          } catch (error) { throw normalizeOpenAIError(error, input.kind, sdk) }
        }
        return { models: [...models.values()], errorCode: null, truncated }
      } catch (error) {
        if (timeout.aborted) return empty('TIMEOUT')
        if (signal?.aborted) return empty('CANCELLED')
        const code = (error as { code?: string }).code
        if (['INVALID_ENDPOINT', 'INSECURE_HTTP_APPROVAL_REQUIRED', 'ENDPOINT_ADDRESS_CHANGED'].includes(code ?? '')) return empty('BAD_REQUEST')
        if (code === 'MODEL_NOT_FOUND' || (error as { status?: number }).status === 405) return empty('MODEL_LIST_UNSUPPORTED')
        const allowed = ['AUTHENTICATION', 'RATE_LIMIT', 'INSUFFICIENT_QUOTA', 'TIMEOUT', 'CONNECTION', 'BAD_REQUEST', 'CANCELLED']
        return empty(allowed.includes(code ?? '') ? code as ProviderModelListResult['errorCode'] : 'PROVIDER_ERROR')
      }
    },
  }
}
