import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import type { ProviderConfigInput, ProviderRequest } from '../../../src/shared/contracts/provider'
import { InMemoryCredentialStore } from '../../../src/main/credentials/in-memory-credential-store'
import { openDraftMDDatabase } from '../../../src/main/persistence/database'
import { createProviderConfigRepository } from '../../../src/main/persistence/provider-config-repository'
import { createProviderConfigService } from '../../../src/main/providers/provider-config-service'
import { createCapabilityTester } from '../../../src/main/providers/capability-test'
import { createProviderAdapter } from '../../../src/main/providers/provider-factory'
import { startMockProviderServer } from '../../helpers/mock-provider-server'

it.each(['responses', 'chat-completions', 'anthropic'] as const)('persists effort and applies it to both probes and conversations over %s', async protocol => {
  const server = await startMockProviderServer('chat-only', protocol === 'anthropic' ? 'anthropic' : 'openai')
  const directory = await mkdtemp(join(tmpdir(), 'draftmd-effort-'))
  const dbPath = join(directory, 'config.sqlite')
  let database = openDraftMDDatabase(dbPath).database
  const credentials = new InMemoryCredentialStore()
  let repository = createProviderConfigRepository(database)
  let service = createProviderConfigService({ repository, credentials })
  const config: ProviderConfigInput = {
    name: 'Effort', kind: protocol === 'anthropic' ? 'anthropic' : 'openai-compatible',
    apiMode: protocol === 'anthropic' ? undefined : protocol,
    preset: 'none', baseUrl: protocol === 'anthropic' ? server.baseUrl.replace(/\/v1$/, '') : server.baseUrl,
    model: protocol === 'anthropic' ? 'claude-sonnet-5' : 'gpt-6-astra', reasoningEffort: 'high',
    timeoutMs: 5000, streamEnabled: true, toolsEnabled: true, insecureHttpApproved: false,
  }
  try {
    const saved = await service.saveConfig(config, protocol === 'anthropic' ? { apiKey: 'fixture-key' } : {})
    database.close()
    database = openDraftMDDatabase(dbPath).database
    repository = createProviderConfigRepository(database)
    service = createProviderConfigService({ repository, credentials })
    expect(service.listConfigs()[0].reasoningEffort).toBe('high')
    const tested = repository.get(saved.id)!
    const tester = createCapabilityTester({
      materialize: service.materialize, createAdapter: createProviderAdapter,
      persist: (id, result, expected) => repository.updateTestResult(id, { ...result, testedModel: result.model }, expected),
      nonce: () => 'fixture-nonce', now: Date.now,
    })
    expect(await tester.testProvider(saved.id, new AbortController().signal)).toMatchObject({ capability: protocol === 'anthropic' ? 'agent' : 'chat-only', errorCode: null })
    const request: ProviderRequest = {
      system: 'Help with Markdown.', tools: [], maxOutputTokens: 64_000,
      messages: [{ role: 'user', provider: null, providerData: null, content: [{ type: 'text', text: 'Hello' }] }],
    }
    const adapter = await createProviderAdapter(await service.materialize(saved.id))
    for await (const _ of adapter.stream(request, new AbortController().signal)) { /* consume */ }
    const effortPayload = protocol === 'responses' ? { reasoning: { effort: 'high' }, max_output_tokens: 64_000 }
      : protocol === 'anthropic' ? { output_config: { effort: 'high' }, max_tokens: 64_000 }
        : { reasoning_effort: 'high', max_completion_tokens: 64_000 }
    expect(server.requests).toHaveLength(2)
    for (const sent of server.requests) expect(sent.body).toMatchObject(effortPayload)
    const updated = await service.saveConfig({ ...config, id: saved.id, reasoningEffort: 'default' })
    expect(updated).toMatchObject({ reasoningEffort: 'default', capability: 'unavailable', lastTestedAt: null })
    expect(repository.updateTestResult(saved.id, {
      capability: 'agent', testedAt: new Date().toISOString(), testedModel: tested.model, latencyMs: 10, errorCode: null,
    }, tested)).toBe(false)
    await tester.testProvider(saved.id, new AbortController().signal)
    const defaultBody = server.requests.at(-1)!.body
    expect(defaultBody).not.toHaveProperty('reasoning')
    expect(defaultBody).not.toHaveProperty('reasoning_effort')
    expect(defaultBody).not.toHaveProperty('output_config')
    if (protocol === 'anthropic') expect(defaultBody).toHaveProperty('thinking.type', 'adaptive')
    database.prepare("update provider_configs set settings_json = '{}' where id = ?").run(saved.id)
    expect(service.listConfigs()[0].reasoningEffort).toBe('default')
    await expect(service.saveConfig({ ...config, id: saved.id, model: 'unknown-model' })).rejects.toMatchObject({ code: 'UNSUPPORTED_REASONING_EFFORT' })
  } finally {
    database.close()
    await server.close()
    await rm(directory, { recursive: true, force: true })
  }
})
