import { afterEach, expect, it, vi } from 'vitest'
import { createServer, type RequestListener } from 'node:http'
import { once } from 'node:events'
import { createProviderModelCatalog } from '../../../src/main/providers/model-catalog'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { vi.unstubAllEnvs(); for (const close of cleanup.splice(0)) await close() })
async function endpoint(handler: RequestListener) {
  const server = createServer(handler).listen(0, '127.0.0.1')
  await once(server, 'listening')
  cleanup.push(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) })
  return `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`
}
const draft = (baseUrl: string) => ({ kind: 'openai-compatible' as const, baseUrl, timeoutMs: 1000, insecureHttpApproved: false })
const emptyStore = () => ({ listConfigs: () => [], materialize: vi.fn() })

it('lists draft endpoint models with draft secrets, deduplicates IDs, and returns only model metadata', async () => {
  const baseUrl = await endpoint((req, res) => {
    expect(req.url).toBe('/v1/models')
    expect(req.method).toBe('GET')
    expect(req.headers.authorization).toBe('Bearer draft-test-key')
    expect(req.headers['x-private-token']).toBe('draft-header-secret')
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ data: [{ id: 'remote-model', owned_by: 'vendor', apiKey: 'not-returned' }, { id: 'remote-model' }, { id: 'other-model' }] }))
  })
  const store = emptyStore()
  const result = await createProviderModelCatalog(store).listModels(draft(baseUrl), { apiKey: 'draft-test-key', headers: { 'X-Private-Token': 'draft-header-secret' } })
  expect(result).toEqual({ models: [{ id: 'remote-model', name: 'remote-model' }, { id: 'other-model', name: 'other-model' }], errorCode: null, truncated: false })
  expect(store.materialize).not.toHaveBeenCalled()
  expect(JSON.stringify(result)).not.toContain('secret')
})

it('supports paginated Anthropic models and display names', async () => {
  const requests: string[] = []
  const baseUrl = await endpoint((req, res) => {
    requests.push(req.url!)
    expect(req.headers['x-api-key']).toBe('anthropic-test-key')
    const second = req.url!.includes('after_id=first')
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ data: [{ id: second ? 'second' : 'first', display_name: second ? 'Second' : 'First' }], has_more: !second, last_id: second ? 'second' : 'first' }))
  })
  const result = await createProviderModelCatalog(emptyStore()).listModels({ ...draft(baseUrl.replace(/\/v1$/, '')), kind: 'anthropic' }, { apiKey: 'anthropic-test-key' })
  expect(result.models).toEqual([{ id: 'first', name: 'First' }, { id: 'second', name: 'Second' }])
  expect(requests).toHaveLength(2)
})

it('does not send stored credentials to a changed endpoint', async () => {
  const seen = vi.fn()
  const baseUrl = await endpoint(seen)
  const store = {
    listConfigs: () => [{ id: 'saved', kind: 'openai-compatible', baseUrl: 'https://original.example/v1', hasCredential: true, headerNames: ['x-secret'] }],
    materialize: vi.fn(),
  }
  const result = await createProviderModelCatalog(store as never).listModels({ ...draft(baseUrl), id: 'saved' }, {})
  expect(result.errorCode).toBe('SAVED_CREDENTIALS_MISMATCH')
  expect(store.materialize).not.toHaveBeenCalled()
  expect(seen).not.toHaveBeenCalled()
})

it('reuses same-endpoint stored credentials without returning them', async () => {
  const baseUrl = await endpoint((req, res) => {
    expect(req.headers.authorization).toBe('Bearer stored-test-key')
    expect(req.headers['x-secret']).toBe('stored-header')
    res.setHeader('content-type', 'application/json'); res.end('{"data":[]}')
  })
  const store = {
    listConfigs: () => [{ id: 'saved', kind: 'openai-compatible', baseUrl, hasCredential: true, headerNames: ['x-secret'] }],
    materialize: vi.fn().mockResolvedValue({ apiKey: 'stored-test-key', headers: { 'x-secret': 'stored-header' } }),
  }
  expect(await createProviderModelCatalog(store as never).listModels({ ...draft(baseUrl), id: 'saved' }, {})).toEqual({ models: [], errorCode: null, truncated: false })
})

it.each([[401, 'AUTHENTICATION'], [404, 'MODEL_LIST_UNSUPPORTED'], [429, 'RATE_LIMIT']] as const)('normalizes HTTP %s without echoing response secrets', async (status, errorCode) => {
  const baseUrl = await endpoint((_req, res) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end('{"error":{"message":"private-server-secret"}}')
  })
  const result = await createProviderModelCatalog(emptyStore()).listModels(draft(baseUrl), {})
  expect(result.errorCode).toBe(errorCode)
  expect(JSON.stringify(result)).not.toContain('private-server-secret')
})

it('refuses redirects instead of forwarding credentials', async () => {
  const seen = vi.fn()
  const target = await endpoint(seen)
  const baseUrl = await endpoint((_req, res) => { res.writeHead(307, { location: `${target}/models` }); res.end() })
  expect((await createProviderModelCatalog(emptyStore()).listModels(draft(baseUrl), { apiKey: 'redirect-test-key' })).errorCode).not.toBeNull()
  expect(seen).not.toHaveBeenCalled()
})

it('times out an unresponsive model endpoint', async () => {
  const baseUrl = await endpoint(() => {})
  expect((await createProviderModelCatalog(emptyStore()).listModels(draft(baseUrl), {})).errorCode).toBe('TIMEOUT')
})

it('rejects malformed model lists and unapproved public HTTP endpoints', async () => {
  const baseUrl = await endpoint((_req, res) => { res.setHeader('content-type', 'application/json'); res.end('{"data":[{"id":123}]}') })
  expect((await createProviderModelCatalog(emptyStore()).listModels(draft(baseUrl), {})).errorCode).toBe('PROVIDER_ERROR')
  expect((await createProviderModelCatalog(emptyStore()).listModels(draft('http://example.com/v1'), {})).errorCode).toBe('BAD_REQUEST')
})

it('caps large catalogs at 1000 entries', async () => {
  const baseUrl = await endpoint((_req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ data: Array.from({ length: 1001 }, (_, index) => ({ id: `model-${index}` })) }))
  })
  const result = await createProviderModelCatalog(emptyStore()).listModels(draft(baseUrl), {})
  expect(result.models).toHaveLength(1000)
  expect(result.truncated).toBe(true)
})

it.each(['anthropic', 'openai-compatible'] as const)('isolates %s discovery from environment credentials and headers', async kind => {
  vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'ambient-auth-token')
  vi.stubEnv('ANTHROPIC_CUSTOM_HEADERS', 'X-Ambient-Secret: ambient-header-secret')
  vi.stubEnv('OPENAI_CUSTOM_HEADERS', 'X-Ambient-Secret: ambient-header-secret')
  vi.stubEnv('OPENAI_ORG_ID', 'ambient-organization')
  vi.stubEnv('OPENAI_PROJECT_ID', 'ambient-project')
  let received = {}
  const baseUrl = await endpoint((req, res) => {
    received = req.headers
    res.setHeader('content-type', 'application/json'); res.end('{"data":[],"has_more":false}')
  })
  const result = await createProviderModelCatalog(emptyStore()).listModels({ ...draft(baseUrl), kind }, { apiKey: 'explicit-test-key' })
  expect(result.errorCode).toBeNull()
  expect(JSON.stringify(received)).not.toContain('ambient-')
  expect(received).toMatchObject(kind === 'anthropic' ? { 'x-api-key': 'explicit-test-key' } : { authorization: 'Bearer explicit-test-key' })
})

it('times out even while credential lookup is pending', async () => {
  const baseUrl = 'http://127.0.0.1:11434/v1'
  const store = {
    listConfigs: () => [{ id: 'saved', kind: 'openai-compatible', baseUrl, hasCredential: true, headerNames: [] }],
    materialize: () => new Promise<never>(() => {}),
  }
  expect((await createProviderModelCatalog(store as never).listModels({ ...draft(baseUrl), id: 'saved' }, {})).errorCode).toBe('TIMEOUT')
})
