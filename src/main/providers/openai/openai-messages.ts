import type OpenAI from 'openai'
import type { ProviderMessage, ProviderRequest } from '../../../shared/contracts/provider'

interface OpenAIProviderData {
  content: string | null
  toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[]
}

function isOpenAIProviderData(value: unknown): value is OpenAIProviderData {
  return Boolean(value && typeof value === 'object' && 'toolCalls' in value && Array.isArray((value as OpenAIProviderData).toolCalls))
}

export function toOpenAIMessages(request: ProviderRequest): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: request.system },
  ]
  for (const message of request.messages) {
    if (message.role === 'assistant' && message.provider && isOpenAIProviderData(message.providerData)) {
      messages.push({ role: 'assistant', content: message.providerData.content, tool_calls: message.providerData.toolCalls })
      continue
    }
    if (message.role === 'assistant') {
      messages.push({ role: 'assistant', content: message.content.filter((block) => block.type === 'text').map((block) => block.text).join('') })
      continue
    }
    for (const block of message.content) {
      if (block.type === 'text') messages.push({ role: 'user', content: block.text })
      else if (block.type === 'tool-result') messages.push({
        role: 'tool', tool_call_id: block.callId, content: JSON.stringify(block.content),
      })
    }
  }
  return messages
}

export function toOpenAITools(tools: ProviderRequest['tools']): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name, description: tool.description,
      parameters: tool.inputSchema,
      strict: true,
    },
  }))
}
