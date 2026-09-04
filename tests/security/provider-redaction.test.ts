import { mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { openDraftMDDatabase } from '../../src/main/persistence/database'
import { createProviderConfigRepository } from '../../src/main/persistence/provider-config-repository'
import { InMemoryCredentialStore } from '../../src/main/credentials/in-memory-credential-store'
import { createProviderConfigService } from '../../src/main/providers/provider-config-service'
import { ProviderError } from '../../src/main/providers/provider-errors'
import { IpcInvokeSchemas } from '../../src/shared/contracts/ipc'

const SECRET = 'DRAFTMD_SECRET_SENTINEL_8e4ffb'
const DOCUMENT = 'DRAFTMD_DOCUMENT_SENTINEL_1f093a'
const refs = [
  '01991d5a-1c00-7000-8000-000000000101',
  '01991d5a-1c00-7000-8000-000000000102',
]

describe('provider and IPC redaction', () => {
  it('keeps secret values out of renderer DTOs and SQLite metadata', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'draftmd-security-redaction-')), 'draftmd.sqlite')
    const opened = openDraftMDDatabase(path)
    const credentials = new InMemoryCredentialStore()
    let refIndex = 0
    const service = createProviderConfigService({
      repository: createProviderConfigRepository(opened.database), credentials,
      createRef: () => refs[refIndex++], now: () => '2026-09-02T00:00:00.000Z',
    })
    try {
      const dto = await service.saveConfig({
        name: 'Sentinel config', kind: 'openai-compatible', preset: 'none', baseUrl: 'http://127.0.0.1:1234/v1',
        model: 'mock', timeoutMs: 60_000, streamEnabled: true, toolsEnabled: true, insecureHttpApproved: false,
      }, { apiKey: SECRET, headers: { 'x-secret': `${SECRET}-header` } })
      const renderer = IpcInvokeSchemas['provider-list'].result.parse([dto])
      expect(JSON.stringify(renderer)).not.toContain(SECRET)
      expect(JSON.stringify(renderer)).not.toContain('credentialRef')
      expect(JSON.stringify(renderer)).not.toContain('headerCredentialRefs')
      opened.database.pragma('wal_checkpoint(TRUNCATE)')
      const disk = await readFile(path)
      expect(disk.includes(Buffer.from(SECRET))).toBe(false)
      expect(disk.includes(Buffer.from(DOCUMENT))).toBe(false)
      expect(await credentials.get(refs[0])).toBe(SECRET)
      expect(await credentials.get(refs[1])).toBe(`${SECRET}-header`)
    } finally { opened.database.close() }
  })

  it('serializes typed provider errors without the raw cause', () => {
    const error = new ProviderError({
      code: 'AUTHENTICATION', provider: 'anthropic', retryable: false, status: 401,
      messageKey: 'provider.error.AUTHENTICATION', cause: new Error(`${SECRET} ${DOCUMENT}`),
    })
    expect(JSON.stringify(error.toJSON())).not.toContain(SECRET)
    expect(JSON.stringify(error.toJSON())).not.toContain(DOCUMENT)
    expect(error.message).toBe('provider.error.AUTHENTICATION')
  })
})
