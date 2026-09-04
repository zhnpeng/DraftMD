import { expect, it } from 'vitest'
import type { ProviderConfigRecord } from '../../../src/main/persistence/provider-config-repository'
import { createCapabilityTester } from '../../../src/main/providers/capability-test'
import { createProviderAdapter } from '../../../src/main/providers/provider-factory'
import { startMockProviderServer } from '../../helpers/mock-provider-server'

it('classifies Anthropic SSE echo through the official native SDK', async () => {
  const server = await startMockProviderServer('agent', 'anthropic')
  const config: ProviderConfigRecord = {
    id: '01991d5a-1c00-7000-8000-000000000000', name: 'Anthropic mock', kind: 'anthropic', preset: 'none',
    baseUrl: server.baseUrl.replace(/\/v1$/, ''), model: 'claude-opus-5', credentialRef: null, headerCredentialRefs: {}, timeoutMs: 5000,
    streamEnabled: true, toolsEnabled: true, insecureHttpApproved: false, capability: 'unavailable',
    lastTestedAt: null, lastTestErrorCode: null, isDefault: true,
  }
  const tester = createCapabilityTester({
    materialize: async () => ({ config, apiKey: 'known-anthropic-secret', headers: {} }),
    createAdapter: createProviderAdapter, persist: () => {}, nonce: () => 'fixed-nonce', now: Date.now,
  })
  try {
    await expect(tester.testProvider(config.id, new AbortController().signal)).resolves.toMatchObject({
      capability: 'agent', errorCode: null, model: 'claude-opus-5',
    })
    expect(server.requests).toHaveLength(1)
    expect(server.requests[0].url).toBe('/v1/messages')
    expect(server.requests[0].headers['x-api-key']).toBe('[redacted]')
    expect(JSON.stringify(server.requests)).not.toContain('known-anthropic-secret')
  } finally { await server.close() }
})
