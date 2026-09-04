import type { ProviderEvent, ProviderRequest } from '../../shared/contracts/provider'

export interface ProviderAdapter {
  stream(request: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderEvent>
}
