import type { ServerResponse } from 'node:http'

// Reuse the existing task scenarios while emitting the actual Responses wire protocol.
export function sendResponsesSSE(response: ServerResponse, chunks: any[]): void {
  const output: any[] = []
  const events: any[] = []
  let usage: any = null
  const id = `resp_${Date.now()}_${Math.random().toString(36).slice(2)}`
  const snapshot = (status: string) => ({ id, object: 'response', created_at: 1, status,
    model: 'mock-model', output: status === 'completed' ? output : [], error: null, incomplete_details: null, usage })
  events.push({ type: 'response.created', response: snapshot('in_progress') })
  output.push({ type: 'reasoning', id: `${id}_reasoning`, summary: [], encrypted_content: 'mock-encrypted-reasoning' })
  events.push({ type: 'response.output_item.added', output_index: 0, item: output[0] })
  events.push({ type: 'response.output_item.done', output_index: 0, item: output[0] })
  for (const chunk of chunks) {
    if (chunk.usage) usage = { input_tokens: chunk.usage.prompt_tokens, output_tokens: chunk.usage.completion_tokens,
      total_tokens: chunk.usage.total_tokens, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } }
    for (const choice of chunk.choices ?? []) {
      for (const tool of choice.delta.tool_calls ?? []) {
        const item = { type: 'function_call', id: `${id}_fc_${tool.index}`, call_id: tool.id,
          name: tool.function.name, arguments: tool.function.arguments, status: 'completed' }
        const output_index = output.length
        output.push(item)
        events.push({ type: 'response.output_item.added', output_index, item: { ...item, arguments: '', status: 'in_progress' } })
        const middle = Math.floor(item.arguments.length / 2)
        for (const delta of [item.arguments.slice(0, middle), item.arguments.slice(middle)]) {
          events.push({ type: 'response.function_call_arguments.delta', output_index, item_id: item.id, delta })
        }
        events.push({ type: 'response.function_call_arguments.done', output_index, item_id: item.id, arguments: item.arguments })
        events.push({ type: 'response.output_item.done', output_index, item })
      }
      if (choice.delta.content) {
        const part = { type: 'output_text', text: choice.delta.content, annotations: [], logprobs: [] }
        const item = { type: 'message', id: `${id}_msg_${output.length}`, role: 'assistant', status: 'completed', content: [part] }
        const output_index = output.length
        output.push(item)
        events.push({ type: 'response.output_item.added', output_index, item: { ...item, status: 'in_progress', content: [] } })
        events.push({ type: 'response.content_part.added', output_index, item_id: item.id, content_index: 0, part: { ...part, text: '' } })
        events.push({ type: 'response.output_text.delta', output_index, item_id: item.id, content_index: 0, delta: part.text, logprobs: [] })
        events.push({ type: 'response.output_item.done', output_index, item })
      }
    }
  }
  events.push({ type: 'response.completed', response: snapshot('completed') })
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  for (const [sequence_number, event] of events.entries()) response.write(`event: ${event.type}\ndata: ${JSON.stringify({ ...event, sequence_number })}\n\n`)
  response.end()
}
