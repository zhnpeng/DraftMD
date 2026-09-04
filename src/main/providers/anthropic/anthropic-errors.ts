import type Anthropic from '@anthropic-ai/sdk'
import { ProviderError } from '../provider-errors'

export type AnthropicSDKModule = typeof import('@anthropic-ai/sdk')

type ErrorClasses = Pick<AnthropicSDKModule,
  'AuthenticationError' | 'NotFoundError' | 'RateLimitError' | 'BadRequestError'
  | 'APIConnectionTimeoutError' | 'APIConnectionError' | 'APIUserAbortError' | 'APIError'>

export function normalizeAnthropicError(error: unknown, sdk: ErrorClasses): ProviderError {
  if (error instanceof ProviderError) return error
  if (error instanceof sdk.APIUserAbortError) {
    return new ProviderError({ code: 'CANCELLED', provider: 'anthropic', retryable: false, status: null, messageKey: 'provider.error.cancelled', cause: error })
  }
  if (error instanceof sdk.AuthenticationError) {
    return new ProviderError({ code: 'AUTHENTICATION', provider: 'anthropic', retryable: false, status: 401, messageKey: 'provider.error.authentication', cause: error })
  }
  if (error instanceof sdk.NotFoundError) {
    return new ProviderError({ code: 'MODEL_NOT_FOUND', provider: 'anthropic', retryable: false, status: 404, messageKey: 'provider.error.modelNotFound', cause: error })
  }
  if (error instanceof sdk.RateLimitError) {
    return new ProviderError({ code: 'RATE_LIMIT', provider: 'anthropic', retryable: true, status: 429, messageKey: 'provider.error.rateLimit', cause: error })
  }
  if (error instanceof sdk.BadRequestError) {
    return new ProviderError({ code: 'BAD_REQUEST', provider: 'anthropic', retryable: false, status: 400, messageKey: 'provider.error.badRequest', cause: error })
  }
  if (error instanceof sdk.APIConnectionTimeoutError) {
    return new ProviderError({ code: 'TIMEOUT', provider: 'anthropic', retryable: true, status: null, messageKey: 'provider.error.timeout', cause: error })
  }
  if (error instanceof sdk.APIConnectionError) {
    return new ProviderError({ code: 'CONNECTION', provider: 'anthropic', retryable: true, status: null, messageKey: 'provider.error.connection', cause: error })
  }
  if (error instanceof sdk.APIError) {
    return new ProviderError({
      code: 'PROVIDER_ERROR', provider: 'anthropic', retryable: error.status === undefined || error.status >= 500,
      status: error.status ?? null, messageKey: 'provider.error.provider', cause: error,
    })
  }
  return new ProviderError({ code: 'PROVIDER_ERROR', provider: 'anthropic', retryable: false, status: null, messageKey: 'provider.error.provider', cause: error })
}
