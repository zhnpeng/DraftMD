import { describe, expect, it } from 'vitest'
import type { ProviderConfigRecord } from '../../../src/main/persistence/provider-config-repository'
import { createCapabilityTester } from '../../../src/main/providers/capability-test'
import { createProviderAdapter } from '../../../src/main/providers/provider-factory'
import { startMockProviderServer, type MockProviderMode } from '../../helpers/mock-provider-server'

const id = '01991d5a-1c00-7000-8000-000000000000'

async function run(mode: MockProviderMode) {
  const server = await startMockProviderServer(mode)
  const config: ProviderConfigRecord = {
    id, name: 'Mock', kind: 'openai-compatible', preset: 'none', baseUrl: server.baseUrl,
    model: 'mock-model', credentialRef: null, headerCredentialRefs: {}, timeoutMs: mode === 'timeout' ? 1000 : 5000,
    streamEnabled: true, toolsEnabled: true, insecureHttpApproved: false,
    capability: 'unavailable', lastTestedAt: null, lastTestErrorCode: null, isDefault: true,
  }
  const persisted: unknown[] = []
  const tester = createCapabilityTester({
    materialize: async () => ({ config, apiKey: null, headers: { Authorization: 'Bearer known-secret' } }),
    createAdapter: createProviderAdapter,
    persist: (_configId, result) => persisted.push(result),
    nonce: () => 'fixed-nonce', now: Date.now,
  })
  return { server, persisted, result: tester.testProvider(id, new AbortController().signal) }
}

describe('loopback OpenAI-compatible capability probe', () => {
  it('classifies a valid streamed echo call as agent through the official SDK', async () => {
    const test = await run('agent')
    try {
      await expect(test.result).resolves.toMatchObject({ capability: 'agent', model: 'mock-model', errorCode: null })
      expect(test.server.requests).toHaveLength(1)
      expect(test.server.requests[0]).toMatchObject({ method: 'POST', url: '/v1/chat/completions' })
      expect(test.server.requests[0].headers.authorization).toBe('[redacted]')
      expect(JSON.stringify(test.server.requests[0].body)).toContain('draftmd_capability_echo')
      expect(JSON.stringify(test.server.requests[0].body)).not.toContain('known-secret')
    } finally { await test.server.close() }
  })

  it.each([
    ['chat-only', 'chat-only', null],
    ['malformed-tool', 'chat-only', null],
    ['auth-error', 'unavailable', 'AUTHENTICATION'],
    ['rate-limit', 'unavailable', 'RATE_LIMIT'],
    ['timeout', 'unavailable', 'TIMEOUT'],
  ] as const)('classifies %s deterministically', async (mode, capability, errorCode) => {
    const test = await run(mode)
    try {
      await expect(test.result).resolves.toMatchObject({ capability, errorCode })
    } finally { await test.server.close() }
  })
})
