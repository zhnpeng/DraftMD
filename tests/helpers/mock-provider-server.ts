import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { sendResponsesSSE } from './responses-sse'

export type MockProviderStyle = 'openai' | 'anthropic'
export type MockProviderMode = 'agent' | 'chat-only' | 'html-response' | 'malformed-tool' | 'auth-error' | 'rate-limit' | 'timeout' | 'agent-task' | 'agent-stop-before' | 'agent-stop-after' | 'agent-delete-one' | 'agent-delete-two' | 'agent-delete-stale' | 'agent-diff-task' | 'acceptance-meeting-sync' | 'acceptance-create-design' | 'acceptance-selection-completion'

export interface MockProviderServer {
  baseUrl: string
  requests: Array<{ method: string; url: string; headers: Record<string, string>; body: unknown }>
  releaseDelete(): void
  close(): Promise<void>
}

async function body(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function redactHeaders(headers: IncomingMessage['headers']): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([name, value]) => [
    name,
    /authorization|api-key|token|secret/i.test(name) ? '[redacted]' : Array.isArray(value) ? value.join(',') : value ?? '',
  ]))
}

function sendSSE(response: ServerResponse, events: unknown[]): void {
  if (response.req.url?.endsWith('/responses')) { sendResponsesSSE(response, events); return }
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
  for (const event of events) response.write(`data: ${JSON.stringify(event)}\n\n`)
  response.end('data: [DONE]\n\n')
}

function nonceFromRequest(requestBody: unknown): string {
  const serialized = JSON.stringify(requestBody)
  return /nonce ([0-9a-z-]+)/i.exec(serialized)?.[1] ?? 'missing-nonce'
}

export async function startMockProviderServer(mode: MockProviderMode, style: MockProviderStyle = 'openai'): Promise<MockProviderServer> {
  const requests: MockProviderServer['requests'] = []
  let releaseDelete!: () => void
  const deleteBarrier = new Promise<void>((resolve) => { releaseDelete = resolve })
  const server = createServer(async (request, response) => {
    let requestBody = await body(request).catch(() => null)
    requests.push({ method: request.method ?? '', url: request.url ?? '', headers: redactHeaders(request.headers), body: requestBody })
    if (request.url?.endsWith('/responses') && requestBody) {
      const payload = requestBody as { input: any[]; tools?: any[] }
      const calls = new Set(payload.input.filter(item => item.type === 'function_call').map(item => item.call_id))
      const results = new Set(payload.input.filter(item => item.type === 'function_call_output').map(item => item.call_id))
      const invalid = payload.tools?.some(tool => tool.function || (tool.strict && Object.keys(tool.parameters.properties).some(key => !tool.parameters.required.includes(key))))
        || payload.input.some(item => item.type === 'function_call_output' && !calls.has(item.call_id))
        || [...calls].some(id => !results.has(id))
      if (invalid) {
        response.writeHead(400, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { code: 'invalid_function_parameters' } }))
        return
      }
      requestBody = { ...payload, tools: payload.tools?.map(tool => ({ type: 'function', function: tool })),
        messages: payload.input.map(item => item.type === 'function_call_output'
          ? { role: 'tool', tool_call_id: item.call_id, content: item.output } : item) }
    }
    if (mode === 'timeout') return
    if (mode === 'html-response') {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end('<html><body>Provider dashboard</body></html>')
      return
    }
    if (mode === 'auth-error') {
      response.writeHead(401, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'invalid secret', type: 'authentication_error' } }))
      return
    }
    if (mode === 'rate-limit') {
      response.writeHead(429, { 'content-type': 'application/json', 'retry-after': '1' })
      response.end(JSON.stringify({ error: { message: 'slow down', type: 'rate_limit_error' } }))
      return
    }
    if (style === 'openai') {
      const payload = requestBody as { tools?: Array<{ function?: { strict?: boolean; parameters?: { properties?: Record<string, unknown>; required?: string[] } } }> } | null
      const invalid = payload?.tools?.some(tool => tool.function?.strict && Object.keys(tool.function.parameters?.properties ?? {}).some(key => !tool.function?.parameters?.required?.includes(key)))
      if (invalid) {
        response.writeHead(400, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { code: 'invalid_function_parameters', message: 'Strict tools require every property in required.' } }))
        return
      }
    }
    const nonce = nonceFromRequest(requestBody)
    if (['agent-task', 'agent-stop-before', 'agent-stop-after', 'agent-delete-one', 'agent-delete-two', 'agent-delete-stale', 'agent-diff-task', 'acceptance-meeting-sync', 'acceptance-create-design', 'acceptance-selection-completion'].includes(mode) && style === 'openai') {
      const payload = requestBody as { tools?: Array<{ function?: { name?: string } }>; messages?: Array<{ role?: string; content?: string }> }
      const capability = payload.tools?.some((tool) => tool.function?.name === 'draftmd_capability_echo')
      const base = { id: 'chatcmpl-task', object: 'chat.completion.chunk', created: 1, model: 'mock-model' }
      if (capability) {
        sendSSE(response, [{ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call-probe', type: 'function', function: { name: 'draftmd_capability_echo', arguments: JSON.stringify({ nonce }) } }] }, finish_reason: 'tool_calls' }] }])
        return
      }
      const toolMessages = payload.messages?.filter((message) => message.role === 'tool') ?? []
      if (mode === 'agent-stop-before' || (mode === 'agent-stop-after' && toolMessages.length >= 2)) {
        await Promise.race([once(request, 'aborted'), once(request, 'close')])
        return
      }
      if (mode === 'acceptance-meeting-sync') {
        if (toolMessages.length === 0) {
          sendSSE(response, [{ ...base, choices: [{ index: 0, delta: { tool_calls: ['meeting.md', 'requirements.md', 'design.md'].map((path, index) => ({
            index, id: `call-read-${index}`, type: 'function', function: { name: 'read_markdown', arguments: JSON.stringify({ path }) },
          })) }, finish_reason: 'tool_calls' }] }])
          return
        }
        if (toolMessages.length === 3) {
          const reads = toolMessages.map((message) => JSON.parse(message.content ?? '{}') as { value?: { path?: string; version?: string } })
          const byPath = new Map(reads.map((result) => [result.value?.path, result.value?.version]))
          sendSSE(response, [{ ...base, choices: [{ index: 0, delta: { tool_calls: [
            { index: 0, id: 'call-edit-requirements', type: 'function', function: { name: 'edit_markdown', arguments: JSON.stringify({
              path: 'requirements.md', oldText: 'Status: pending decision.', newText: 'Status: required.', expectedVersion: byPath.get('requirements.md'),
            }) } },
            { index: 1, id: 'call-edit-design', type: 'function', function: { name: 'edit_markdown', arguments: JSON.stringify({
              path: 'design.md', oldText: 'Status: pending decision.', newText: 'Status: local-first with no network dependency.', expectedVersion: byPath.get('design.md'),
            }) } },
          ] }, finish_reason: 'tool_calls' }] }])
          return
        }
        sendSSE(response, [{ ...base, choices: [{ index: 0, delta: { content: 'Synchronized the confirmed offline decision to requirements and design.' }, finish_reason: 'stop' }] }])
        return
      }
      if (mode === 'acceptance-create-design') {
        if (toolMessages.length === 0) {
          sendSSE(response, [{ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call-read-requirements', type: 'function', function: { name: 'read_markdown', arguments: JSON.stringify({ path: 'requirements.md' }) } }] }, finish_reason: 'tool_calls' }] }])
          return
        }
        if (toolMessages.length === 1) {
          sendSSE(response, [{ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call-create-design', type: 'function', function: { name: 'create_markdown', arguments: JSON.stringify({
            path: 'technical-design.md', content: '# Technical Design\n\n## Storage\n\nDrafts are stored locally and Markdown writes are atomic.\n\n## Safety\n\nExisting design files are never overwritten.\n',
          }) } }] }, finish_reason: 'tool_calls' }] }])
          return
        }
        sendSSE(response, [{ ...base, choices: [{ index: 0, delta: { content: 'Created the technical design draft, or left the existing file unchanged on collision.' }, finish_reason: 'stop' }] }])
        return
      }
      if (mode === 'acceptance-selection-completion') {
        if (toolMessages.length === 0) {
          sendSSE(response, [{ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call-search-timeout', type: 'function', function: { name: 'search_markdown', arguments: JSON.stringify({ query: 'transient timeouts', limit: 10 }) } }] }, finish_reason: 'tool_calls' }] }])
          return
        }
        if (toolMessages.length === 1) {
          sendSSE(response, [{ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call-read-reference', type: 'function', function: { name: 'read_markdown', arguments: JSON.stringify({ path: 'reference.md' }) } }] }, finish_reason: 'tool_calls' }] }])
          return
        }
        if (toolMessages.length === 2) {
          sendSSE(response, [{ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call-read-target', type: 'function', function: { name: 'read_markdown', arguments: JSON.stringify({ path: 'target.md' }) } }] }, finish_reason: 'tool_calls' }] }])
          return
        }
        if (toolMessages.length === 3) {
          const target = JSON.parse(toolMessages[2].content ?? '{}') as { value?: { version?: string } }
          sendSSE(response, [{ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call-edit-selection', type: 'function', function: { name: 'edit_markdown', arguments: JSON.stringify({
            path: 'target.md', oldText: 'Handle validation errors.', newText: 'Handle validation errors. Retry transient timeouts once and preserve the current draft on failure.', expectedVersion: target.value?.version,
          }) } }] }, finish_reason: 'tool_calls' }] }])
          return
        }
        sendSSE(response, [{ ...base, choices: [{ index: 0, delta: { content: 'Completed only the selected Error Handling section using the reliability reference.' }, finish_reason: 'stop' }] }])
        return
      }
      if (mode === 'agent-diff-task') {
        if (toolMessages.length === 0) {
          sendSSE(response, [{ ...base, choices: [{ index: 0, delta: { tool_calls: ['a.md', 'b.md'].map((path, index) => ({
            index, id: `call-read-${index}`, type: 'function', function: { name: 'read_markdown', arguments: JSON.stringify({ path }) },
          })) }, finish_reason: 'tool_calls' }] }])
          return
        }
        if (toolMessages.length === 2) {
          const reads = toolMessages.map((message) => JSON.parse(message.content ?? '{}') as { value?: { path?: string; version?: string } })
          sendSSE(response, [{ ...base, choices: [{ index: 0, delta: { tool_calls: [
            ...reads.map((result, index) => ({ index, id: `call-edit-${index}`, type: 'function', function: { name: 'edit_markdown', arguments: JSON.stringify({
              path: result.value?.path, oldText: 'before', newText: 'after', expectedVersion: result.value?.version,
            }) } })),
            { index: 2, id: 'call-create', type: 'function', function: { name: 'create_markdown', arguments: JSON.stringify({ path: 'new.md', content: '# New\n' }) } },
          ] }, finish_reason: 'tool_calls' }] }])
          return
        }
        sendSSE(response, [{ ...base, choices: [{ index: 0, delta: { content: 'Updated two files and created one.' }, finish_reason: 'stop' }] }])
        return
      }
      const deletePaths = mode === 'agent-delete-two' ? ['a.md', 'b.md']
        : mode === 'agent-delete-one' || mode === 'agent-delete-stale' ? ['a.md'] : null
      if (deletePaths && toolMessages.length === 0) {
        sendSSE(response, [{ ...base, choices: [{ index: 0, delta: { tool_calls: deletePaths.map((path, index) => ({
          index, id: `call-read-${index}`, type: 'function', function: { name: 'read_markdown', arguments: JSON.stringify({ path }) },
        })) }, finish_reason: 'tool_calls' }] }])
        return
      }
      if (deletePaths && toolMessages.length === deletePaths.length) {
        await Promise.race([deleteBarrier, once(request, 'aborted')])
        if (request.aborted) return
        const reads = toolMessages.slice(-deletePaths.length).map((message) => JSON.parse(message.content ?? '{}') as { value?: { path?: string; version?: string } })
        sendSSE(response, [{ ...base, choices: [{ index: 0, delta: { tool_calls: reads.map((result, index) => ({
          index, id: `call-delete-${index}`, type: 'function', function: { name: 'delete_markdown', arguments: JSON.stringify({
            path: result.value?.path, expectedVersion: result.value?.version, reason: `Obsolete ${result.value?.path ?? 'file'}`,
          }) },
        })) }, finish_reason: 'tool_calls' }] }])
        return
      }
      if (deletePaths) {
        sendSSE(response, [{ ...base, choices: [{ index: 0, delta: { content: 'Deletion decisions applied.' }, finish_reason: 'stop' }] }])
        return
      }
      if (toolMessages.length === 0) {
        sendSSE(response, [{ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call-read', type: 'function', function: { name: 'read_markdown', arguments: JSON.stringify({ path: 'task.md', heading: null, startLine: null, endLine: null }) } }] }, finish_reason: 'tool_calls' }] }])
        return
      }
      if (toolMessages.length === 1) {
        const result = JSON.parse(toolMessages[0].content ?? '{}') as { value?: { version?: string } }
        sendSSE(response, [{ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call-edit', type: 'function', function: { name: 'edit_markdown', arguments: JSON.stringify({ path: 'task.md', oldText: 'before', newText: 'after', expectedVersion: result.value?.version }) } }] }, finish_reason: 'tool_calls' }] }])
        return
      }
      sendSSE(response, [
        { ...base, choices: [{ index: 0, delta: { content: 'Updated task.md.' }, finish_reason: 'stop' }] },
        { ...base, choices: [], usage: { prompt_tokens: 20, completion_tokens: 4, total_tokens: 24 } },
      ])
      return
    }
    if (style === 'anthropic') {
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
      const events = [
        ['message_start', { type: 'message_start', message: { id: 'msg_probe', type: 'message', role: 'assistant', model: 'claude-opus-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 7, output_tokens: 0, cache_creation_input_tokens: null, cache_read_input_tokens: null } } }],
        ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'call-probe', name: 'draftmd_capability_echo', input: {} } }],
        ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify({ nonce }) } }],
        ['content_block_stop', { type: 'content_block_stop', index: 0 }],
        ['message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { input_tokens: 7, output_tokens: 2, cache_creation_input_tokens: null, cache_read_input_tokens: null } }],
        ['message_stop', { type: 'message_stop' }],
      ]
      for (const [event, data] of events) response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      response.end()
      return
    }
    const base = { id: 'chatcmpl-probe', object: 'chat.completion.chunk', created: 1, model: 'mock-model' }
    if (mode === 'chat-only') {
      sendSSE(response, [
        { ...base, choices: [{ index: 0, delta: { content: 'I can chat. I can suggest changes, but I cannot directly modify files. Example text only: {\"name\":\"edit_markdown\",\"path\":\"document.md\"}.' }, finish_reason: 'stop' }] },
        { ...base, choices: [], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } },
      ])
      return
    }
    const argumentsValue = mode === 'malformed-tool' ? '{bad-json' : JSON.stringify({ nonce })
    sendSSE(response, [
      { ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call-probe', type: 'function', function: { name: 'draftmd_capability_echo', arguments: argumentsValue } }] }, finish_reason: 'tool_calls' }] },
      { ...base, choices: [], usage: { prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 } },
    ])
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Mock provider failed to bind')
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    releaseDelete,
    close: () => new Promise((resolve, reject) => {
      server.closeAllConnections()
      server.close((error) => error ? reject(error) : resolve())
    }),
  }
}
