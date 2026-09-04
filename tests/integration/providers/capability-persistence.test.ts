import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { openDraftMDDatabase } from '../../../src/main/persistence/database'
import { createProviderConfigRepository } from '../../../src/main/persistence/provider-config-repository'
import { uuidv7 } from '../../../src/main/persistence/ids'

it('persists capability test metadata without prompt or output text', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'draftmd-capability-persist-')), 'draftmd.sqlite')
  const opened = openDraftMDDatabase(path)
  const repository = createProviderConfigRepository(opened.database)
  const id = uuidv7()
  const timestamp = '2026-09-01T13:00:00.000Z'
  try {
    repository.save({
      id, name: 'Local', kind: 'openai-compatible', preset: 'ollama',
      baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen3', credentialRef: null,
      headerCredentialRefs: {}, timeoutMs: 60_000, streamEnabled: true, toolsEnabled: true,
      insecureHttpApproved: false, capability: 'unavailable', lastTestedAt: null,
      lastTestErrorCode: null, isDefault: true, createdAt: timestamp, updatedAt: timestamp,
    })

    repository.updateTestResult(id, {
      capability: 'agent', testedAt: timestamp, testedModel: 'qwen3', latencyMs: 42, errorCode: null,
    })

    expect(repository.get(id)).toMatchObject({
      capability: 'agent', lastTestedAt: timestamp, lastTestErrorCode: null,
      lastTestedModel: 'qwen3', lastTestLatencyMs: 42,
    })
    const stored = JSON.stringify(opened.database.prepare('select * from provider_configs where id = ?').get(id))
    expect(stored).not.toContain('fixed-nonce')
    expect(stored).not.toContain('draftmd_capability_echo')
  } finally { opened.database.close() }
})
