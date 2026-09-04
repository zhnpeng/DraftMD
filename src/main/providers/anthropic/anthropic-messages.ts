import type Anthropic from '@anthropic-ai/sdk'
import type { ProviderMessage, ProviderRequest } from '../../../shared/contracts/provider'

export function toAnthropicMessages(messages: ProviderMessage[]): Anthropic.MessageParam[] {
  return messages.map((message) => {
    if (message.role === 'assistant' && message.provider === 'anthropic' && Array.isArray(message.providerData)) {
      return { role: 'assistant', content: message.providerData as Anthropic.ContentBlockParam[] }
    }
    const content: Anthropic.ContentBlockParam[] = message.content.map((block) => {
      if (block.type === 'text') return { type: 'text', text: block.text }
      if (block.type === 'tool-call') {
        return { type: 'tool_use', id: block.call.id, name: block.call.name, input: block.call.input }
      }
      return {
        type: 'tool_result', tool_use_id: block.callId,
        content: JSON.stringify(block.content), is_error: block.isError,
      }
    })
    return { role: message.role, content }
  })
}

export function toAnthropicTools(tools: ProviderRequest['tools']): Anthropic.Tool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
    strict: true,
  }))
}
