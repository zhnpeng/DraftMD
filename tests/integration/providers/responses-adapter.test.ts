import { createServer } from 'node:http'
import { once } from 'node:events'
import { describe, expect, it } from 'vitest'
import type { ProviderEvent, ProviderRequest } from '../../../src/shared/contracts/provider'
import { createOpenAICompatibleAdapter } from '../../../src/main/providers/openai-compatible/openai-compatible-adapter'
import { toolDefinitions } from '../../../src/main/agent/tools/definitions'
import { startMockProviderServer } from '../../helpers/mock-provider-server'
import { createProviderAdapter } from '../../../src/main/providers/provider-factory'

const request: ProviderRequest = {
  system: 'Edit Markdown.', maxOutputTokens: 8000, tools: toolDefinitions,
  messages: [{ role: 'user', provider: null, providerData: null, content: [{ type: 'text', text: 'Read draft.md' }] }],
}
const message = (text: string) => ({ type: 'message', id: 'msg_1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [], logprobs: [] }] })
const call = (id = 'a', args = '{"path":"draft.md","heading":null,"startLine":null,"endLine":null}') => ({
  type: 'function_call', id: `fc_${id}`, call_id: `call_${id}`, name: 'read_markdown', arguments: args, status: 'completed',
})
const reasoning = { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'opaque-reasoning-context' }
function response(output: unknown[], status = 'completed', extra = {}) {
  return { id: 'resp_1', object: 'response', created_at: 1, status, output, error: null, incomplete_details: null,
    usage: { input_tokens: 12, output_tokens: 5, total_tokens: 17, input_tokens_details: { cached_tokens: 3 }, output_tokens_details: { reasoning_tokens: 2 } }, ...extra }
}
function completed(output: unknown[]) { return [{ type: 'response.completed', response: response(output) }] }

async function setup(events: unknown[] | ((body: any) => unknown[]), status = 200, holdOpen = false) {
  const requests: Array<{ url: string; body: any }> = []
  const server = createServer(async (req, res) => {
    const buffers: Buffer[] = []
    for await (const chunk of req) buffers.push(Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(buffers).toString())
    requests.push({ url: req.url!, body })
    if (status !== 200) {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { code: status === 404 ? 'not_found' : 'invalid_api_key', message: 'secret-upstream-detail' } }))
      return
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const values = [...(typeof events === 'function' ? events(body) : events)]
    if (values.length && (values[0] as { type: string }).type !== 'response.created') {
      values.unshift({ type: 'response.created', response: response([], 'in_progress') })
    }
    for (const [sequence_number, value] of values.entries()) res.write(`data: ${JSON.stringify({ sequence_number, ...value as object })}\n\n`)
    if (!holdOpen) res.end()
  }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`
  const adapter = await createOpenAICompatibleAdapter({ apiKey: null, model: 'mock-model', baseUrl, timeoutMs: 2000,
    headers: {}, toolsEnabled: true, apiMode: 'responses' })
  return { adapter, requests, close: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) } }
}
async function collect(adapter: Awaited<ReturnType<typeof createOpenAICompatibleAdapter>>, input = request, signal = new AbortController().signal) {
  const events: ProviderEvent[] = []
  for await (const event of adapter.stream(input, signal)) events.push(event)
  return events
}

describe('Responses API through the official SDK', () => {
  it('routes a saved Responses config through the factory and SDK streamed argument accumulator', async () => {
    const server = await startMockProviderServer('agent-task')
    try {
      const adapter = await createProviderAdapter({ apiKey: null, headers: {}, config: {
        id: '01991d5a-1c00-7000-8000-000000000000', name: 'Responses', kind: 'openai-compatible', apiMode: 'responses',
        preset: 'none', baseUrl: server.baseUrl, model: 'mock-model', credentialRef: null, headerCredentialRefs: {},
        timeoutMs: 2000, streamEnabled: true, toolsEnabled: true, insecureHttpApproved: false, capability: 'agent',
        lastTestedAt: null, lastTestErrorCode: null, isDefault: true,
      } })
      expect(await collect(adapter)).toContainEqual({ type: 'tool-call', call: { id: 'call-read', name: 'read_markdown', input: { path: 'task.md' } } })
      expect(server.requests[0].url).toBe('/v1/responses')
    } finally { await server.close() }
  })

  it('uses text-only saved task history without replaying unpaired tool calls', async () => {
    const test = await setup(completed([message('Ready')]))
    try {
      await collect(test.adapter, { ...request, messages: [
        { role: 'assistant', provider: null, content: [{ type: 'text', text: 'Updated the document.' }], providerData: { apiMode: 'responses', output: [reasoning, call()] } },
        ...request.messages,
      ] })
      expect(test.requests[0].body.input).toEqual([{ role: 'assistant', content: 'Updated the document.' }, { role: 'user', content: 'Read draft.md' }])
    } finally { await test.close() }
  })
  it('streams text, uses /responses, disables storage and maps usage', async () => {
    const test = await setup([
      { type: 'response.created', response: response([], 'in_progress') },
      { type: 'response.output_item.added', output_index: 0, item: { ...message(''), content: [], status: 'in_progress' } },
      { type: 'response.content_part.added', output_index: 0, content_index: 0, item_id: 'msg_1', part: { type: 'output_text', text: '', annotations: [], logprobs: [] } },
      { type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: 'msg_1', delta: 'Hello', logprobs: [] },
      { type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: 'msg_1', delta: ' world', logprobs: [] },
      ...completed([message('Hello world')]),
    ])
    try {
      const events = await collect(test.adapter)
      expect(events.filter(e => e.type === 'text-delta')).toEqual([{ type: 'text-delta', text: 'Hello' }, { type: 'text-delta', text: ' world' }])
      expect(events).toContainEqual({ type: 'usage', inputTokens: 12, outputTokens: 5, cachedInputTokens: 3 })
      expect(events.at(-1)).toMatchObject({ type: 'completed', stopReason: 'end-turn' })
      expect(test.requests[0]).toMatchObject({ url: '/v1/responses', body: { model: 'mock-model', stream: true, store: false,
        instructions: request.system, max_output_tokens: 8000, input: [{ role: 'user', content: 'Read draft.md' }] } })
      expect(test.requests[0].body).not.toHaveProperty('messages')
      for (const tool of test.requests[0].body.tools) {
        expect(tool).toMatchObject({ type: 'function', strict: true, parameters: { additionalProperties: false } })
        expect(tool).not.toHaveProperty('function')
        expect(tool.parameters.required.sort()).toEqual(Object.keys(tool.parameters.properties).sort())
      }
    } finally { await test.close() }
  })

  it('preserves complete reasoning and parallel calls for the next turn without SDK-only parsed fields', async () => {
    const output = [reasoning, call('a'), call('b')]
    const test = await setup(body => body.input?.some((i: any) => i.type === 'function_call_output') ? completed([message('Read both files.')]) : completed(output))
    try {
      const events = await collect(test.adapter)
      expect(events.filter(e => e.type === 'tool-call')).toEqual(['a', 'b'].map(id => ({ type: 'tool-call', call: { id: `call_${id}`, name: 'read_markdown', input: { path: 'draft.md' } } })))
      const final = events.at(-1)!
      if (final.type !== 'completed') throw new Error('Missing completion')
      expect(final.stopReason).toBe('tool-use')
      await collect(test.adapter, { ...request, messages: [...request.messages, final.assistantMessage, {
        role: 'user', provider: null, providerData: null, content: ['a', 'b'].map(id => ({ type: 'tool-result', callId: `call_${id}`, content: { ok: true, text: '# Draft' }, isError: false })),
      }] })
      expect(test.requests[1].body.input).toEqual([
        { role: 'user', content: 'Read draft.md' }, ...output,
        ...['a', 'b'].map(id => ({ type: 'function_call_output', call_id: `call_${id}`, output: JSON.stringify({ ok: true, text: '# Draft' }) })),
      ])
      expect(JSON.stringify(test.requests[1].body)).not.toContain('parsed_arguments')
      expect(JSON.stringify(test.requests[1].body)).not.toContain('previous_response_id')
    } finally { await test.close() }
  })

  it.each([
    ['empty', [], 'EMPTY_RESPONSE'],
    ['truncated', [{ type: 'response.created', response: response([call()], 'in_progress') }], 'CONNECTION'],
    ['malformed call', completed([call('a', '{bad-json')]), 'BAD_REQUEST'],
    ['failed', [{ type: 'response.failed', response: response([call()], 'failed', { error: { code: 'server_error', message: 'secret-upstream-detail' } }) }], 'PROVIDER_ERROR'],
    ['refusal', completed([{ ...message(''), content: [{ type: 'refusal', refusal: 'Cannot help' }] }]), 'REFUSAL'],
    ['incomplete tool', [{ type: 'response.incomplete', response: response([call('a', '{"path":')], 'incomplete', { incomplete_details: { reason: 'max_output_tokens' } }) }], 'BAD_REQUEST'],
  ] as const)('rejects %s without emitting executable tools', async (_name, wire, code) => {
    const test = await setup([...wire])
    const events: ProviderEvent[] = []
    try {
      await expect((async () => { for await (const event of test.adapter.stream(request, new AbortController().signal)) events.push(event) })()).rejects.toMatchObject({ code })
      expect(events.some(e => e.type === 'tool-call' || e.type === 'completed')).toBe(false)
    } finally { await test.close() }
  })

  it('retains truncated text with a max-tokens stop reason', async () => {
    const test = await setup([{ type: 'response.incomplete', response: response([message('Partial')], 'incomplete', { incomplete_details: { reason: 'max_output_tokens' } }) }])
    try { expect((await collect(test.adapter)).at(-1)).toMatchObject({ type: 'completed', stopReason: 'max-tokens', assistantMessage: { content: [{ type: 'text', text: 'Partial' }] } }) }
    finally { await test.close() }
  })

  it.each([[401, 'AUTHENTICATION'], [404, 'API_UNSUPPORTED']] as const)('reports HTTP %s without falling back to Chat Completions', async (status, code) => {
    const test = await setup([], status)
    try {
      await expect(collect(test.adapter)).rejects.toMatchObject({ code })
      expect(test.requests.map(r => r.url)).toEqual(['/v1/responses'])
    } finally { await test.close() }
  })

  it('does not send a pre-cancelled request', async () => {
    const test = await setup(completed([message('Hello')]))
    const controller = new AbortController(); controller.abort()
    try {
      await expect(collect(test.adapter, request, controller.signal)).rejects.toMatchObject({ code: 'CANCELLED' })
      expect(test.requests).toEqual([])
    } finally { await test.close() }
  })

  it('cancels an active SDK stream after delivering partial text', async () => {
    const test = await setup([
      { type: 'response.created', response: response([], 'in_progress') },
      { type: 'response.output_item.added', output_index: 0, item: { ...message(''), content: [], status: 'in_progress' } },
      { type: 'response.content_part.added', output_index: 0, content_index: 0, item_id: 'msg_1', part: { type: 'output_text', text: '', annotations: [], logprobs: [] } },
      { type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: 'msg_1', delta: 'Partial', logprobs: [] },
    ], 200, true)
    const controller = new AbortController()
    const events: ProviderEvent[] = []
    try {
      await expect((async () => {
        for await (const event of test.adapter.stream(request, controller.signal)) {
          events.push(event)
          if (event.type === 'text-delta') controller.abort()
        }
      })()).rejects.toMatchObject({ code: 'CANCELLED' })
      expect(events).toEqual([{ type: 'text-delta', text: 'Partial' }])
    } finally { await test.close() }
  })
})
