import type Anthropic from '@anthropic-ai/sdk'
import type { MessageStreamEvents } from '@anthropic-ai/sdk/lib/MessageStream'
import type { NormalizedStopReason, ProviderEvent, ProviderMessage, ProviderRequest } from '../../../shared/contracts/provider'
import type { ProviderAdapter } from '../provider-adapter'
import { ProviderError } from '../provider-errors'
import { normalizeAnthropicError, type AnthropicSDKModule } from './anthropic-errors'
import { toAnthropicMessages, toAnthropicTools } from './anthropic-messages'

export interface AnthropicStreamBoundary {
  on<Event extends 'text'>(event: Event, listener: MessageStreamEvents[Event]): this
  finalMessage(): Promise<Anthropic.Message>
  abort(): void
}

export interface AnthropicClientBoundary {
  messages: {
    stream(body: Anthropic.MessageStreamParams, options?: { signal?: AbortSignal }): AnthropicStreamBoundary
  }
}

export interface AnthropicAdapterConfig {
  model: string
  baseUrl: string
  timeoutMs: number
}

function stopReason(reason: Anthropic.StopReason | null): NormalizedStopReason {
  const map: Partial<Record<Anthropic.StopReason, NormalizedStopReason>> = {
    end_turn: 'end-turn', tool_use: 'tool-use', max_tokens: 'max-tokens',
    stop_sequence: 'stop-sequence', refusal: 'refusal',
  }
  return reason ? map[reason] ?? 'unknown' : 'unknown'
}


function supportsAdaptiveThinking(model: string): boolean {
  return /^claude-(?:opus-(?:5|4-[678])|sonnet-(?:5|4-6)|fable-5)(?:$|-)/.test(model)
}

class TextQueue {
  private values: string[] = []
  private notify: (() => void) | null = null
  push(value: string): void { this.values.push(value); this.notify?.(); this.notify = null }
  shift(): string | undefined { return this.values.shift() }
  get length(): number { return this.values.length }
  wait(): Promise<void> { return new Promise((resolve) => { this.notify = resolve }) }
  wake(): void { this.notify?.(); this.notify = null }
}

export class AnthropicAdapter implements ProviderAdapter {
  constructor(
    private readonly client: AnthropicClientBoundary,
    private readonly config: AnthropicAdapterConfig,
    private readonly sdk: AnthropicSDKModule,
  ) {}

  async *stream(request: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderEvent> {
    const abortController = new AbortController()
    const onAbort = (): void => abortController.abort()
    signal.addEventListener('abort', onAbort, { once: true })
    let sdkStream: AnthropicStreamBoundary | null = null
    try {
      if (signal.aborted) throw new ProviderError({ code: 'CANCELLED', provider: 'anthropic', retryable: false, status: null, messageKey: 'provider.error.cancelled' })
      const body = {
        model: this.config.model,
        max_tokens: request.maxOutputTokens,
        system: request.system,
        messages: toAnthropicMessages(request.messages),
        tools: toAnthropicTools(request.tools),
        ...(supportsAdaptiveThinking(this.config.model) ? { thinking: { type: 'adaptive' } } : {}),
      } as unknown as Anthropic.MessageStreamParams
      sdkStream = this.client.messages.stream(body, { signal: abortController.signal })
      const queue = new TextQueue()
      sdkStream.on('text', (delta) => queue.push(delta))
      let settled = false
      let final: Anthropic.Message | null = null
      let failure: unknown
      const finalPromise = sdkStream.finalMessage().then(
        (message) => { final = message; settled = true; queue.wake() },
        (error) => { failure = error; settled = true; queue.wake() },
      )
      while (!settled || queue.length > 0) {
        const delta = queue.shift()
        if (delta !== undefined) yield { type: 'text-delta', text: delta }
        else if (!settled) await queue.wait()
      }
      await finalPromise
      if (signal.aborted) throw new ProviderError({ code: 'CANCELLED', provider: 'anthropic', retryable: false, status: null, messageKey: 'provider.error.cancelled' })
      if (failure) throw failure
      if (!final) throw new Error('Anthropic stream ended without a final message')
      const finalMessage: Anthropic.Message = final

      const content: ProviderMessage['content'] = []
      for (const block of finalMessage.content) {
        if (block.type === 'text') content.push({ type: 'text', text: block.text })
        else if (block.type === 'tool_use') content.push({
          type: 'tool-call', call: { id: block.id, name: block.name, input: block.input },
        })
      }
      for (const block of content) if (block.type === 'tool-call') yield { type: 'tool-call', call: block.call }
      yield {
        type: 'usage', inputTokens: finalMessage.usage.input_tokens,
        outputTokens: finalMessage.usage.output_tokens,
        cachedInputTokens: finalMessage.usage.cache_read_input_tokens ?? undefined,
      }
      yield {
        type: 'completed', stopReason: stopReason(finalMessage.stop_reason),
        assistantMessage: {
          role: 'assistant', provider: 'anthropic', content,
          providerData: finalMessage.content as unknown as import('../../../shared/contracts/provider').JsonValue,
        },
      }
    } catch (error) {
      if (signal.aborted) sdkStream?.abort()
      throw normalizeAnthropicError(error, this.sdk)
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
  }
}

export async function createAnthropicAdapter(
  input: AnthropicAdapterConfig & { apiKey: string },
  importer: () => Promise<AnthropicSDKModule> = () => import('@anthropic-ai/sdk'),
): Promise<AnthropicAdapter> {
  const sdk = await importer()
  const client = new sdk.default({
    apiKey: input.apiKey, baseURL: input.baseUrl,
    timeout: input.timeoutMs, maxRetries: 2,
  })
  return new AnthropicAdapter(client, input, sdk)
}
