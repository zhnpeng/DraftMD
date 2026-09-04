import type { ProviderAdapter } from '../../src/main/providers/provider-adapter'
import type { ProviderEvent, ProviderRequest } from '../../src/shared/contracts/provider'

export type ProviderTurn = (request: ProviderRequest, signal: AbortSignal, turn: number) => ProviderEvent[] | Promise<ProviderEvent[]>

export class FakeProviderAdapter implements ProviderAdapter {
  readonly requests: ProviderRequest[] = []
  constructor(private readonly turns: ProviderTurn[]) {}
  async *stream(request: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderEvent> {
    const turn = this.requests.length
    this.requests.push(structuredClone(request))
    if (signal.aborted) throw Object.assign(new Error('cancelled'), { code: 'CANCELLED' })
    const factory = this.turns[turn]
    if (!factory) throw new Error(`Unexpected provider turn ${turn}`)
    for (const event of await factory(request, signal, turn)) {
      if (signal.aborted) throw Object.assign(new Error('cancelled'), { code: 'CANCELLED' })
      yield event
    }
  }
}

export function completed(content: ProviderEvent & { type: 'completed' }): ProviderEvent[] {
  return [content]
}
