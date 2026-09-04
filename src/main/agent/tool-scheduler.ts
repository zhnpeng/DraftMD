import type { ToolExecutionContext, ToolExecutionResult } from './tools/executor'
import type { ParsedToolCall } from './tools/schemas'

const READ_ONLY = new Set<ParsedToolCall['name']>(['list_markdown_files', 'search_markdown', 'read_markdown'])

export async function scheduleToolCalls(
  calls: ParsedToolCall[],
  execute: (call: ParsedToolCall, context: ToolExecutionContext) => Promise<ToolExecutionResult>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult[]> {
  const results: ToolExecutionResult[] = new Array(calls.length)
  let index = 0
  while (index < calls.length) {
    if (READ_ONLY.has(calls[index].name)) {
      const start = index
      while (index < calls.length && READ_ONLY.has(calls[index].name)) index += 1
      const settled = await Promise.allSettled(calls.slice(start, index).map((call) => execute(call, context)))
      settled.forEach((result, offset) => {
        results[start + offset] = result.status === 'fulfilled'
          ? result.value
          : { ok: false, code: 'TOOL_ERROR', summary: 'Read operation failed.' }
      })
    } else {
      results[index] = await execute(calls[index], context)
      index += 1
    }
  }
  return results
}
