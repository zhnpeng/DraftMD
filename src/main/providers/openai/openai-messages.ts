import type OpenAI from 'openai'
import type { ProviderMessage, ProviderRequest } from '../../../shared/contracts/provider'

interface OpenAIProviderData {
  content: string | null
  reasoningContent?: string
  toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[]
}

function isOpenAIProviderData(value: unknown): value is OpenAIProviderData {
  return Boolean(value && typeof value === 'object' && 'toolCalls' in value && Array.isArray((value as OpenAIProviderData).toolCalls))
}

export function toOpenAIMessages(request: ProviderRequest, includeReasoningContent = false): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: request.system },
  ]
  for (const message of request.messages) {
    if (message.role === 'assistant' && message.provider && isOpenAIProviderData(message.providerData)) {
      messages.push({ role: 'assistant', content: message.providerData.content, tool_calls: message.providerData.toolCalls,
        ...(includeReasoningContent && typeof message.providerData.reasoningContent === 'string' ? { reasoning_content: message.providerData.reasoningContent } : {}),
      })
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
      parameters: {
        ...tool.inputSchema,
        properties: Object.fromEntries(Object.entries(tool.inputSchema.properties).map(([name, schema]) => [
          name, tool.inputSchema.required.includes(name) ? schema : { anyOf: [schema, { type: 'null' }] },
        ])),
        required: Object.keys(tool.inputSchema.properties),
      },
      strict: true,
    },
  }))
}

export function toResponsesInput(request: ProviderRequest): OpenAI.Responses.ResponseInput {
  const input: OpenAI.Responses.ResponseInput = []
  for (const message of request.messages) {
    const data = message.providerData as { apiMode?: unknown; output?: unknown } | null
    if (message.role === 'assistant' && message.provider && data?.apiMode === 'responses' && Array.isArray(data.output)) {
      input.push(...data.output as OpenAI.Responses.ResponseInput)
      continue
    }
    for (const block of message.content) {
      if (block.type === 'text') input.push({ role: message.role, content: block.text })
      else if (block.type === 'tool-call') input.push({
        type: 'function_call', call_id: block.call.id, name: block.call.name, arguments: JSON.stringify(block.call.input),
      })
      else input.push({ type: 'function_call_output', call_id: block.callId, output: JSON.stringify(block.content) })
    }
  }
  return input
}

export function toResponsesTools(tools: ProviderRequest['tools']): OpenAI.Responses.FunctionTool[] {
  return toOpenAITools(tools).map(tool => {
    if (tool.type !== 'function') throw new Error('Expected a function tool')
    return { type: 'function', name: tool.function.name, description: tool.function.description,
      parameters: tool.function.parameters!, strict: true }
  })
}

export function normalizeOptionalToolArguments(input: unknown, name: string, tools: ProviderRequest['tools']): unknown {
  const tool = tools.find(tool => tool.name === name)
  if (!tool || !input || typeof input !== 'object' || Array.isArray(input)) return input
  const optional = new Set(Object.keys(tool.inputSchema.properties).filter(key => !tool.inputSchema.required.includes(key)))
  return Object.fromEntries(Object.entries(input).filter(([key, value]) => value !== null || !optional.has(key)))
}
