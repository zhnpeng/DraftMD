import type OpenAI from 'openai'
import type { NormalizedStopReason, ProviderEvent, ProviderMessage, ProviderRequest, ProviderKind, ProviderApiMode } from '../../../shared/contracts/provider'
import type { ProviderAdapter } from '../provider-adapter'
import { ProviderError } from '../provider-errors'
import { normalizeOpenAIError, type OpenAISDKModule } from './openai-errors'
import { normalizeOptionalToolArguments, toOpenAIMessages, toOpenAITools } from './openai-messages'
import { ResponsesAdapter } from './responses-adapter'
import { explicitReasoningEffort, type ReasoningEffort } from '../../../shared/reasoning-effort'

export interface OpenAIClientBoundary {
  chat: { completions: {
    create(body: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming, options?: { signal?: AbortSignal }): Promise<AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>>
  } }
}
export interface OpenAIAdapterConfig {
  reasoningEffort?: ReasoningEffort
  kind: Extract<ProviderKind, 'openai' | 'openai-compatible'>
  model: string
  baseUrl: string
  timeoutMs: number
  toolsEnabled: boolean
}

function finishReason(reason: string | null): NormalizedStopReason | null {
  if (reason === null) return null
  return ({ stop: 'end-turn', tool_calls: 'tool-use', length: 'max-tokens', content_filter: 'content-filter' } as Record<string, NormalizedStopReason>)[reason] ?? 'unknown'
}

interface PendingToolCall { id: string; name: string; arguments: string }

export class OpenAIAdapter implements ProviderAdapter {
  constructor(private readonly client: OpenAIClientBoundary, private readonly config: OpenAIAdapterConfig, private readonly sdk: OpenAISDKModule) {}

  async *stream(request: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderEvent> {
    try {
      if (signal.aborted) throw new this.sdk.APIUserAbortError()
      const stream = await this.client.chat.completions.create({
        model: this.config.model, stream: true, stream_options: { include_usage: true },
        max_completion_tokens: request.maxOutputTokens,
        ...(explicitReasoningEffort(this.config.reasoningEffort) ? { reasoning_effort: explicitReasoningEffort(this.config.reasoningEffort) } : {}),
        messages: toOpenAIMessages(request, this.config.kind === 'openai-compatible'),
        tools: this.config.toolsEnabled ? toOpenAITools(request.tools) : undefined,
      }, { signal })
      let text = ''
      let reasoningContent = ''
      let stopReason: NormalizedStopReason = 'unknown'
      let usage: { inputTokens: number; outputTokens: number; cachedInputTokens?: number } | null = null
      const calls = new Map<number, PendingToolCall>()
      for await (const chunk of stream) {
        if (signal.aborted) throw new this.sdk.APIUserAbortError()
        if (chunk.usage) usage = {
          inputTokens: chunk.usage.prompt_tokens,
          outputTokens: chunk.usage.completion_tokens,
          cachedInputTokens: chunk.usage.prompt_tokens_details?.cached_tokens ?? undefined,
        }
        for (const choice of chunk.choices) {
          const reasoning = (choice.delta as { reasoning_content?: unknown }).reasoning_content
          if (this.config.kind === 'openai-compatible' && typeof reasoning === 'string') reasoningContent += reasoning
          const delta = choice.delta.content
          if (delta) { text += delta; yield { type: 'text-delta', text: delta } }
          for (const tool of choice.delta.tool_calls ?? []) {
            if (tool.type === 'custom' || tool.custom) continue
            const current = calls.get(tool.index) ?? { id: '', name: '', arguments: '' }
            if (tool.id) current.id = tool.id
            if (tool.function?.name) current.name = tool.function.name
            if (tool.function?.arguments) current.arguments += tool.function.arguments
            calls.set(tool.index, current)
          }
          stopReason = finishReason(choice.finish_reason) ?? stopReason
        }
      }
      if (!text.trim() && calls.size === 0 && stopReason === 'unknown') {
        throw new ProviderError({ code: 'EMPTY_RESPONSE', provider: this.config.kind, retryable: false, status: null, messageKey: 'provider.error.EMPTY_RESPONSE' })
      }
      const content: ProviderMessage['content'] = []
      if (text) content.push({ type: 'text', text })
      const providerCalls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> = []
      for (const [, call] of [...calls].sort(([left], [right]) => left - right)) {
        let input: unknown
        try { input = JSON.parse(call.arguments) } catch (error) {
          throw new ProviderError({ code: 'BAD_REQUEST', provider: this.config.kind, retryable: false, status: null, messageKey: 'provider.error.badRequest', cause: error })
        }
        // Strict OpenAI schemas encode omitted optional arguments as null.
        input = normalizeOptionalToolArguments(input, call.name, request.tools)
        const normalized = { id: call.id, name: call.name, input }
        content.push({ type: 'tool-call', call: normalized })
        providerCalls.push({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } })
        yield { type: 'tool-call', call: normalized }
      }
      if (usage) yield { type: 'usage', ...usage }
      yield {
        type: 'completed', stopReason,
        assistantMessage: {
          role: 'assistant', provider: this.config.kind, content,
          providerData: { content: text || null, toolCalls: providerCalls, ...(reasoningContent ? { reasoningContent } : {}) },
        },
      }
    } catch (error) {
      throw normalizeOpenAIError(error, this.config.kind, this.sdk)
    }
  }
}

export async function createOpenAIAdapter(
  input: { apiKey: string; model: string; timeoutMs: number; apiMode?: ProviderApiMode; reasoningEffort?: ReasoningEffort },
  importer: () => Promise<OpenAISDKModule> = () => import('openai'),
): Promise<ProviderAdapter> {
  const sdk = await importer()
  const client = new sdk.default({ apiKey: input.apiKey, timeout: input.timeoutMs, maxRetries: 2 })
  const Adapter = input.apiMode === 'chat-completions' ? OpenAIAdapter : ResponsesAdapter
  return new Adapter(client, { kind: 'openai', model: input.model, baseUrl: 'https://api.openai.com/v1', timeoutMs: input.timeoutMs, toolsEnabled: true, reasoningEffort: input.reasoningEffort }, sdk)
}
