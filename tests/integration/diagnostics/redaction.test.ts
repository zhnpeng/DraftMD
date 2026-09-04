import { mkdtemp, readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { SafeLogEntrySchema } from '../../../src/shared/contracts/diagnostics'
import { createSafeLogger } from '../../../src/main/diagnostics/logger'

const timestamp = '2026-09-02T00:00:00.000Z'

describe('safe diagnostic logger', () => {
  it('accepts only the documented safe fields', () => {
    expect(SafeLogEntrySchema.parse({
      timestamp, level: 'info', module: 'agent-runtime', taskStatus: 'completed',
      providerKind: 'anthropic', code: 'RATE_LIMIT', path: 'docs/spec.md', operation: 'edit',
      latencyMs: 42, tokenUsage: { input: 10, output: 5, cachedInput: 2 },
    })).toBeDefined()
    for (const unsafe of [
      { prompt: 'SECRET' }, { response: 'SECRET' }, { document: 'SECRET' },
      { headers: { authorization: 'SECRET' } }, { apiKey: 'SECRET' },
    ]) expect(() => SafeLogEntrySchema.parse({ timestamp, level: 'info', module: 'test', ...unsafe })).toThrow()
  })

  it.each(['/Users/example/secret.md', '../secret.md', 'docs/../../secret.md', 'C:/secret.md', 'docs\\secret.md'])
  ('rejects unsafe path value %s', (path) => {
    expect(() => SafeLogEntrySchema.parse({ timestamp, level: 'warn', module: 'workspace', path })).toThrow()
  })

  it('rejects secret-looking values even in otherwise safe fields', () => {
    const directory = join(tmpdir(), 'draftmd-safe-log-secret-probe')
    const logger = createSafeLogger({ directory, now: () => timestamp })
    expect(() => logger.write({ level: 'info', module: 'provider', operation: 'sk-DRAFTMD_SECRET_7e41' })).toThrow()
    expect(() => logger.write({ level: 'info', module: 'workspace', path: 'docs/token-DRAFTMD_SECRET_7e41.md' })).toThrow()
  })

  it('rejects unsafe codes and module names', () => {
    expect(() => SafeLogEntrySchema.parse({ timestamp, level: 'error', module: 'agent', code: 'secret leaked' })).toThrow()
    expect(() => SafeLogEntrySchema.parse({ timestamp, level: 'error', module: '../../../etc' })).toThrow()
  })

  it('writes mode-0600 JSONL and rotates within configured limits', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'draftmd-safe-log-'))
    const logger = createSafeLogger({ directory, maxBytes: 180, maxFiles: 3, now: () => timestamp })
    for (let index = 0; index < 12; index += 1) {
      logger.write({ level: 'info', module: 'test', operation: `event-${index}` })
    }
    const files = (await readdir(directory)).filter((name) => /^draftmd\.log(?:\.\d+)?$/.test(name)).sort()
    expect(files.length).toBeGreaterThan(1)
    expect(files.length).toBeLessThanOrEqual(3)
    for (const file of files) {
      expect((await stat(join(directory, file))).mode & 0o777).toBe(0o600)
      const lines = (await readFile(join(directory, file), 'utf8')).trim().split('\n')
      for (const line of lines) expect(SafeLogEntrySchema.parse(JSON.parse(line))).toBeDefined()
    }
  })
})
