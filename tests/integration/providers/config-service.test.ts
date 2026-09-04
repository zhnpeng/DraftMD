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
