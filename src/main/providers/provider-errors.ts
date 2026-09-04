import type { ProviderErrorCode, ProviderKind } from '../../shared/contracts/provider'

export interface ProviderErrorInput {
  code: ProviderErrorCode
  provider: ProviderKind
  retryable: boolean
  status: number | null
  messageKey: `provider.error.${string}`
  cause?: unknown
}

export class ProviderError extends Error {
  readonly code: ProviderErrorCode
  readonly provider: ProviderKind
  readonly retryable: boolean
  readonly status: number | null
  readonly messageKey: `provider.error.${string}`

  constructor(input: ProviderErrorInput) {
    super(input.messageKey, { cause: input.cause })
    this.name = 'ProviderError'
    this.code = input.code
    this.provider = input.provider
    this.retryable = input.retryable
    this.status = input.status
    this.messageKey = input.messageKey
  }

  toJSON(): Omit<ProviderErrorInput, 'cause'> {
    return {
      code: this.code,
      provider: this.provider,
      retryable: this.retryable,
      status: this.status,
      messageKey: this.messageKey,
    }
  }
}
