import { ProviderError } from '../provider-errors'

export type OpenAISDKModule = typeof import('openai')
type ErrorClasses = Pick<OpenAISDKModule,
  'AuthenticationError' | 'NotFoundError' | 'RateLimitError' | 'BadRequestError'
  | 'APIConnectionTimeoutError' | 'APIConnectionError' | 'APIUserAbortError' | 'APIError'>

export function normalizeOpenAIError(error: unknown, provider: 'openai' | 'openai-compatible', sdk: ErrorClasses): ProviderError {
  if (error instanceof ProviderError) return error
  const base = { provider, cause: error } as const
  if (error instanceof sdk.APIUserAbortError) return new ProviderError({ ...base, code: 'CANCELLED', retryable: false, status: null, messageKey: 'provider.error.cancelled' })
  if (error instanceof sdk.AuthenticationError) return new ProviderError({ ...base, code: 'AUTHENTICATION', retryable: false, status: 401, messageKey: 'provider.error.authentication' })
  if (error instanceof sdk.NotFoundError) return new ProviderError({ ...base, code: 'MODEL_NOT_FOUND', retryable: false, status: 404, messageKey: 'provider.error.modelNotFound' })
  if (error instanceof sdk.RateLimitError) return new ProviderError({ ...base, code: 'RATE_LIMIT', retryable: true, status: 429, messageKey: 'provider.error.rateLimit' })
  if (error instanceof sdk.BadRequestError) {
    const body = error.error as { code?: unknown } | undefined
    const quota = body?.code === 'insufficient_quota' || error.code === 'insufficient_quota'
    return new ProviderError({ ...base, code: quota ? 'INSUFFICIENT_QUOTA' : 'BAD_REQUEST', retryable: false, status: 400, messageKey: quota ? 'provider.error.insufficientQuota' : 'provider.error.badRequest' })
  }
  if (error instanceof sdk.APIConnectionTimeoutError) return new ProviderError({ ...base, code: 'TIMEOUT', retryable: true, status: null, messageKey: 'provider.error.timeout' })
  if (error instanceof sdk.APIConnectionError) return new ProviderError({ ...base, code: 'CONNECTION', retryable: true, status: null, messageKey: 'provider.error.connection' })
  if (error instanceof sdk.APIError) return new ProviderError({ ...base, code: 'PROVIDER_ERROR', retryable: error.status === undefined || error.status >= 500, status: error.status ?? null, messageKey: 'provider.error.provider' })
  return new ProviderError({ ...base, code: 'PROVIDER_ERROR', retryable: false, status: null, messageKey: 'provider.error.provider' })
}
