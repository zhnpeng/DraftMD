import type OpenAI from 'openai'
import type { NormalizedStopReason, ProviderErrorCode, ProviderEvent, ProviderMessage, ProviderRequest, ToolCall } from '../../../shared/contracts/provider'
import type { ProviderAdapter } from '../provider-adapter'
import { ProviderError } from '../provider-errors'
import type { OpenAIAdapterConfig } from './openai-adapter'
import { normalizeOpenAIError, type OpenAISDKModule } from './openai-errors'
import { normalizeOptionalToolArguments, toResponsesInput, toResponsesTools } from './openai-messages'

export class ResponsesAdapter implements ProviderAdapter {
  constructor(private readonly client: Pick<OpenAI, 'responses'>, private readonly config: OpenAIAdapterConfig, private readonly sdk: OpenAISDKModule) {}

  private error(code: ProviderErrorCode, cause?: unknown): ProviderError {
    return new ProviderError({ code, provider: this.config.kind, retryable: code === 'CONNECTION', status: null, messageKey: `provider.error.${code}`, cause })
  }

  async *stream(request: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderEvent> {
    let sawEvent = false
    let terminal = false
    let stream: ReturnType<OpenAI['responses']['stream']> | undefined
    try {
      if (signal.aborted) throw new this.sdk.APIUserAbortError()
      stream = this.client.responses.stream({
        model: this.config.model, instructions: request.system, input: toResponsesInput(request),
        store: false, include: ['reasoning.encrypted_content'], max_output_tokens: request.maxOutputTokens,
        tools: this.config.toolsEnabled ? toResponsesTools(request.tools) : undefined,
      }, { signal })
      let streamedText = ''
      for await (const event of stream) {
        sawEvent = true
        if (signal.aborted) throw new this.sdk.APIUserAbortError()
        if (event.type === 'response.output_text.delta') {
          streamedText += event.delta
          yield { type: 'text-delta', text: event.delta }
        }
        if (event.type === 'response.completed' || event.type === 'response.incomplete' || event.type === 'response.failed') terminal = true
      }
      if (!terminal) throw this.error(sawEvent ? 'CONNECTION' : 'EMPTY_RESPONSE')
      const response = await stream.finalResponse()
      if (signal.aborted) throw new this.sdk.APIUserAbortError()
      if (response.status === 'failed' || response.error) throw this.error('PROVIDER_ERROR', response.error)

      const calls: ToolCall[] = []
      let text = ''
      let refused = false
      const ids = new Set<string>()
      for (const item of response.output) {
        if (item.type === 'message') {
          for (const part of item.content) {
            if (part.type === 'output_text') text += part.text
            else if (part.type === 'refusal') refused = true
          }
        } else if (item.type === 'function_call') {
          if (response.status !== 'completed' || !item.call_id || !item.name || ids.has(item.call_id)) throw this.error('BAD_REQUEST')
          ids.add(item.call_id)
          calls.push({ id: item.call_id, name: item.name, input: normalizeOptionalToolArguments(item.parsed_arguments, item.name, request.tools) })
        }
      }
      if (refused || response.incomplete_details?.reason === 'content_filter') throw this.error('REFUSAL')
      if (!text.trim() && calls.length === 0) throw this.error('EMPTY_RESPONSE')
      if (text.startsWith(streamedText) && text.length > streamedText.length) yield { type: 'text-delta', text: text.slice(streamedText.length) }

      // SDK parsing adds local-only fields. Replay the original wire items, including reasoning.
      const output = response.output.map(item => {
        if (item.type === 'function_call') { const { parsed_arguments: _, ...wire } = item; return wire }
        if (item.type === 'message') return { ...item, content: item.content.map(part => {
          if ('parsed' in part) { const { parsed: _, ...wire } = part; return wire }
          return part
        }) }
        return item
      })
      const content: ProviderMessage['content'] = text ? [{ type: 'text', text }] : []
      for (const call of calls) { content.push({ type: 'tool-call', call }); yield { type: 'tool-call', call } }
      if (response.usage) yield { type: 'usage', inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens,
        cachedInputTokens: response.usage.input_tokens_details?.cached_tokens }
      const stopReason: NormalizedStopReason = response.status === 'incomplete' ? 'max-tokens' : calls.length ? 'tool-use' : 'end-turn'
      yield { type: 'completed', stopReason, assistantMessage: { role: 'assistant', provider: this.config.kind,
        content, providerData: { apiMode: 'responses', output } } }
    } catch (error) {
      if (signal.aborted) throw normalizeOpenAIError(new this.sdk.APIUserAbortError(), this.config.kind, this.sdk)
      if (error instanceof SyntaxError || (error instanceof this.sdk.OpenAIError && error.cause instanceof SyntaxError)) throw this.error('BAD_REQUEST', error)
      if (error instanceof this.sdk.NotFoundError && error.code !== 'model_not_found') throw this.error('API_UNSUPPORTED', error)
      if (!sawEvent && error instanceof this.sdk.OpenAIError && !(error instanceof this.sdk.APIError)) throw this.error('EMPTY_RESPONSE', error)
      throw normalizeOpenAIError(error, this.config.kind, this.sdk)
    } finally { stream?.abort() }
  }
}
