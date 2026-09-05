import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { InMemoryCredentialStore } from '../../../src/main/credentials/in-memory-credential-store'
import { openDraftMDDatabase } from '../../../src/main/persistence/database'
import { createProviderConfigRepository } from '../../../src/main/persistence/provider-config-repository'
import { createProviderConfigService } from '../../../src/main/providers/provider-config-service'

const input = {
  name: 'Local Agent',
  kind: 'openai-compatible',
  preset: 'ollama',
  baseUrl: 'http://127.0.0.1:11434/v1',
  model: 'qwen3',
  timeoutMs: 60_000,
  streamEnabled: true,
  toolsEnabled: true,
  insecureHttpApproved: false,
} as const

async function setup(overrides: Record<string, unknown> = {}) {
  const path = join(await mkdtemp(join(tmpdir(), 'draftmd-provider-config-')), 'draftmd.sqlite')
  const opened = openDraftMDDatabase(path)
  const credentials = new InMemoryCredentialStore()
  const repository = createProviderConfigRepository(opened.database)
  const service = createProviderConfigService({ repository, credentials, ...overrides })
  return { database: opened.database, credentials, repository, service }
}

describe('ProviderConfigService', () => {
  it('retains the legacy native protocol while new native configs default to Responses', async () => {
    const { database, repository, service } = await setup()
    try {
      const saved = await service.saveConfig({ ...input, kind: 'openai', preset: 'none', baseUrl: 'https://api.openai.com/v1' })
      expect(saved.apiMode).toBe('responses')
      database.prepare("update provider_configs set settings_json = '{}' where id = ?").run(saved.id)
      expect(repository.get(saved.id)?.apiMode).toBe('chat-completions')
    } finally { database.close() }
  })
  it('persists protocol selection without replacing secrets and rejects stale protocol tests', async () => {
    const { database, repository, service } = await setup()
    try {
      const saved = await service.saveConfig(input, { apiKey: 'retained-key' })
      const original = repository.get(saved.id)!
      database.prepare("update provider_configs set settings_json = json_set(settings_json, '$.unrelated', 42) where id = ?").run(saved.id)
      const changed = await service.saveConfig({ ...input, id: saved.id, apiMode: 'responses' })
      expect(changed.apiMode).toBe('responses')
      const reopened = createProviderConfigRepository(database).get(saved.id)!
      expect(reopened.apiMode).toBe('responses')
      expect(reopened.credentialRef).toBe(original.credentialRef)
      expect((await service.materialize(saved.id)).apiKey).toBe('retained-key')
      expect(JSON.parse((database.prepare('select settings_json from provider_configs where id = ?').get(saved.id) as { settings_json: string }).settings_json).unrelated).toBe(42)
      expect(repository.updateTestResult(saved.id, { capability: 'agent', testedAt: '2026-09-05T10:00:00Z', testedModel: input.model, latencyMs: 42, errorCode: null }, original)).toBe(false)
      await service.saveConfig({ ...input, id: saved.id, name: 'Renamed' })
      expect(repository.get(saved.id)?.apiMode).toBe('responses')
    } finally { database.close() }
  })
  it('requires explicit secret replacement or removal when changing credential destinations', async () => {
    const { database, repository, service } = await setup()
    try {
      const saved = await service.saveConfig(input, { apiKey: 'old-key', headers: { 'x-secret': 'old-header' } })
      const changed = { ...input, id: saved.id, baseUrl: 'http://127.0.0.1:1234/v1' }
      await expect(service.saveConfig(changed, {})).rejects.toMatchObject({ code: 'CREDENTIALS_REENTRY_REQUIRED' })
      await expect(service.saveConfig(changed, { apiKey: 'new-key' })).rejects.toMatchObject({ code: 'CREDENTIALS_REENTRY_REQUIRED' })
      expect(repository.get(saved.id)?.baseUrl).toBe(input.baseUrl)
      await service.saveConfig(changed, { apiKey: 'new-key', removeHeaders: ['x-secret'] })
      expect(await service.materialize(saved.id)).toMatchObject({ apiKey: 'new-key', headers: {} })
    } finally { database.close() }
  })
  it.each([
    { apiMode: 'responses' as const },
    { model: 'another-model' }, { baseUrl: 'http://127.0.0.1:1234/v1' },
    { kind: 'openai' as const }, { preset: 'lm-studio' as const },
    { timeoutMs: 30_000 }, { streamEnabled: false }, { toolsEnabled: false },
    { insecureHttpApproved: true },
  ])('invalidates capability and all probe metadata when connection settings change: %j', async patch => {
    const { database, repository, service } = await setup()
    try {
      const saved = await service.saveConfig(input)
      repository.updateTestResult(saved.id, { capability: 'agent', testedAt: '2026-09-05T10:00:00Z', testedModel: input.model, latencyMs: 42, errorCode: null }, repository.get(saved.id)!)
      const updated = await service.saveConfig({ ...input, id: saved.id, ...patch })
      expect(updated).toMatchObject({ capability: 'unavailable', lastTestedAt: null, lastTestErrorCode: null })
      expect(repository.get(saved.id)).toMatchObject({ lastTestedModel: null, lastTestLatencyMs: null })
    } finally { database.close() }
  })

  it.each([
    { apiKey: 'replacement' }, { removeApiKey: true },
    { headers: { token: 'replacement-header' } }, { removeHeaders: ['token'] },
  ])('invalidates capability when secret references change: %j', async secrets => {
    const { database, repository, service } = await setup()
    try {
      const saved = await service.saveConfig(input, { apiKey: 'old', headers: { token: 'old-header' } })
      repository.updateTestResult(saved.id, { capability: 'agent', testedAt: '2026-09-05T10:00:00Z', testedModel: input.model, latencyMs: 42, errorCode: null }, repository.get(saved.id)!)
      await service.saveConfig({ ...input, id: saved.id }, secrets)
      expect(repository.get(saved.id)).toMatchObject({ capability: 'unavailable', lastTestedAt: null, lastTestedModel: null, lastTestLatencyMs: null })
    } finally { database.close() }
  })

  it('preserves capability when only the display name changes or secret fields are blank', async () => {
    const { database, repository, service } = await setup()
    try {
      const saved = await service.saveConfig(input, { apiKey: 'old', headers: { token: 'old-header' } })
      repository.updateTestResult(saved.id, { capability: 'agent', testedAt: '2026-09-05T10:00:00Z', testedModel: input.model, latencyMs: 42, errorCode: null }, repository.get(saved.id)!)
      await service.saveConfig({ ...input, id: saved.id, name: 'Renamed' }, { apiKey: '', headers: { token: '' } })
      expect(repository.get(saved.id)).toMatchObject({ capability: 'agent', lastTestedModel: input.model, lastTestLatencyMs: 42 })
    } finally { database.close() }
  })

  it('rejects an in-flight result after editing or deleting its configuration', async () => {
    const { database, repository, service } = await setup()
    try {
      const saved = await service.saveConfig(input)
      const tested = repository.get(saved.id)!
      const result = { capability: 'agent' as const, testedAt: '2026-09-05T10:00:00Z', testedModel: input.model, latencyMs: 42, errorCode: null }
      await service.saveConfig({ ...input, id: saved.id, model: 'new-model' })
      expect(repository.updateTestResult(saved.id, result, tested)).toBe(false)
      expect(repository.get(saved.id)).toMatchObject({ model: 'new-model', capability: 'unavailable', lastTestedAt: null })
      await service.deleteConfig(saved.id, true)
      expect(repository.updateTestResult(saved.id, result, tested)).toBe(false)
    } finally { database.close() }
  })

  it('stores non-secret configuration in SQLite and secrets only in the credential store', async () => {
    const { database, credentials, repository, service } = await setup()
    try {
      const saved = await service.saveConfig(input, {
        apiKey: 'known-api-secret',
        headers: { 'X-Private-Token': 'known-header-secret' },
      })

      expect(saved).toMatchObject({ name: 'Local Agent', hasCredential: true, headerNames: ['x-private-token'] })
      expect(JSON.stringify(saved)).not.toContain('known-api-secret')
      expect(JSON.stringify(saved)).not.toContain('known-header-secret')
      const persisted = repository.get(saved.id)!
      expect(await credentials.get(persisted.credentialRef!)).toBe('known-api-secret')
      expect(await credentials.get(persisted.headerCredentialRefs['x-private-token'])).toBe('known-header-secret')
      const sqliteBytes = JSON.stringify(database.prepare('select * from provider_configs').all())
      expect(sqliteBytes).not.toContain('known-api-secret')
      expect(sqliteBytes).not.toContain('known-header-secret')
    } finally { database.close() }
  })

  it('normalizes header names and rejects case-insensitive duplicates', async () => {
    const { database, service } = await setup()
    try {
      await expect(service.saveConfig(input, {
        headers: { Authorization: 'one', authorization: 'two' },
      })).rejects.toMatchObject({ code: 'DUPLICATE_HEADER' })
    } finally { database.close() }
  })

  it('deletes newly created credentials when database save fails', async () => {
    const credentials = new InMemoryCredentialStore()
    const refs: string[] = []
    const repository = {
      save: vi.fn(() => { throw new Error('database failed') }), get: vi.fn(() => null),
      list: vi.fn(() => []), delete: vi.fn(), setDefault: vi.fn(),
    }
    const service = createProviderConfigService({
      repository: repository as never,
      credentials,
      createRef: () => { const ref = `01991d5a-1c00-7000-8000-${String(refs.length).padStart(12, '0')}`; refs.push(ref); return ref },
    })

    await expect(service.saveConfig(input, { apiKey: 'secret', headers: { token: 'header-secret' } })).rejects.toThrow('database failed')
    await expect(Promise.all(refs.map((ref) => credentials.get(ref)))).resolves.toEqual(refs.map(() => null))
  })

  it('retains existing secrets when blank replacements are supplied', async () => {
    const { database, credentials, repository, service } = await setup()
    try {
      const first = await service.saveConfig(input, { apiKey: 'old-secret' })
      const firstPersisted = repository.get(first.id)!
      const updated = await service.saveConfig({ ...input, id: first.id, name: 'Renamed' }, { apiKey: '' })
      const updatedPersisted = repository.get(first.id)!

      expect(updated.hasCredential).toBe(true)
      expect(updatedPersisted.credentialRef).toBe(firstPersisted.credentialRef)
      expect(await credentials.get(firstPersisted.credentialRef!)).toBe('old-secret')
    } finally { database.close() }
  })

  it('replaces secrets only after DB success and deletes old references afterward', async () => {
    const { database, credentials, repository, service } = await setup()
    try {
      const first = await service.saveConfig(input, { apiKey: 'old-secret' })
      const oldRef = repository.get(first.id)!.credentialRef!
      await service.saveConfig({ ...input, id: first.id }, { apiKey: 'new-secret' })
      const newRef = repository.get(first.id)!.credentialRef!

      expect(newRef).not.toBe(oldRef)
      expect(await credentials.get(oldRef)).toBeNull()
      expect(await credentials.get(newRef)).toBe('new-secret')
    } finally { database.close() }
  })

  it('materializes secrets only inside main-process service output and redacts list DTOs', async () => {
    const { database, service } = await setup()
    try {
      const saved = await service.saveConfig(input, { apiKey: 'api-secret', headers: { Token: 'header-secret' } })

      expect(await service.materialize(saved.id)).toMatchObject({
        config: { id: saved.id }, apiKey: 'api-secret', headers: { token: 'header-secret' },
      })
      const serialized = JSON.stringify(service.listConfigs())
      expect(serialized).not.toContain('api-secret')
      expect(serialized).not.toContain('header-secret')
      expect(serialized).not.toContain('credentialRef')
    } finally { database.close() }
  })

  it('sets one default config and optionally deletes secrets with a config', async () => {
    const { database, credentials, repository, service } = await setup()
    try {
      const first = await service.saveConfig(input, { apiKey: 'secret' })
      const second = await service.saveConfig({ ...input, name: 'Second' }, {})
      service.setDefault(second.id)
      expect(service.listConfigs().find((config) => config.id === second.id)?.isDefault).toBe(true)
      const ref = repository.get(first.id)!.credentialRef!

      await service.deleteConfig(first.id, true)
      expect(repository.get(first.id)).toBeNull()
      expect(await credentials.get(ref)).toBeNull()
    } finally { database.close() }
  })
})
