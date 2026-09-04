import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { buildDiagnosticsPreview, exportDiagnosticsJSON, redactDiagnosticValue } from '../../../src/main/diagnostics/export-diagnostics'

const SECRET = 'sk-DRAFTMD_SECRET_7e41'
const DOCUMENT = 'DRAFTMD_FULL_DOCUMENT_91af'

describe('diagnostics preview and export', () => {
  it('lists included categories without snapshots, messages, or content', () => {
    const preview = buildDiagnosticsPreview({
      app: { version: '0.1.0', electron: '44.1.0', platform: 'darwin', arch: 'arm64', osRelease: '25.0.0' },
      settings: { locale: 'en', theme: 'elegant' },
      providers: [{ name: 'Local', kind: 'openai-compatible', model: 'mock', capability: 'agent', baseHost: '127.0.0.1' }],
      logs: [], database: { integrity: 'ok', recoveryWarning: null },
    })
    expect(preview.categories).toEqual(['Application', 'Safe settings', 'Provider metadata', 'Safe logs', 'Database integrity'])
    expect(JSON.stringify(preview)).not.toMatch(/snapshot|message|prompt|document content/i)
  })

  it('preserves aggregate token usage while redacting credential-bearing fields', () => {
    const preview = buildDiagnosticsPreview({
      app: { version: '0.1.0', electron: '44.1.0', platform: 'darwin', arch: 'arm64', osRelease: '25.0.0' },
      settings: { locale: 'en', theme: 'elegant' }, providers: [],
      logs: [{ timestamp: '2026-09-02T00:00:00.000Z', level: 'info', module: 'provider', tokenUsage: { input: 10, output: 5, cachedInput: 2 } }],
      database: { integrity: 'ok', recoveryWarning: null },
    })
    expect(preview.logs[0]?.tokenUsage).toEqual({ input: 10, output: 5, cachedInput: 2 })
  })

  it('redacts secret-looking provider metadata in the preview, not only during export', () => {
    const preview = buildDiagnosticsPreview({
      app: { version: '0.1.0', electron: '44.1.0', platform: 'darwin', arch: 'arm64', osRelease: '25.0.0' },
      settings: { locale: 'en', theme: 'elegant' },
      providers: [{ name: `Remote ${SECRET}`, kind: 'anthropic', model: `model-${SECRET}`, capability: 'unavailable', baseHost: 'example.com' }],
      logs: [], database: { integrity: 'ok', recoveryWarning: null },
    })
    expect(JSON.stringify(preview)).not.toContain(SECRET)
    expect(preview.providers[0].name).toContain('[REDACTED]')
  })

  it('recursively redacts suspicious keys and secret-looking values', () => {
    expect(redactDiagnosticValue({
      apiKey: SECRET, Authorization: `Bearer ${SECRET}`, safe: 'visible', nested: { headerValue: SECRET },
      error: `request failed with ${SECRET}`,
    })).toEqual({
      apiKey: '[REDACTED]', Authorization: '[REDACTED]', safe: 'visible', nested: { headerValue: '[REDACTED]' },
      error: 'request failed with [REDACTED]',
    })
  })

  it('exports mode-0600 JSON after a second redaction pass', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'draftmd-diagnostics-export-'))
    const path = join(directory, 'diagnostics.json')
    const logPath = join(directory, 'draftmd.log')
    await writeFile(logPath, `${JSON.stringify({ timestamp: '2026-09-02T00:00:00.000Z', level: 'error', module: 'provider', code: 'AUTHENTICATION', operation: `failed ${SECRET}` })}\n`)
    await exportDiagnosticsJSON(path, {
      app: { version: '0.1.0', electron: '44.1.0', platform: 'darwin', arch: 'arm64', osRelease: '25.0.0' },
      settings: { locale: 'en', theme: 'elegant' },
      providers: [{ name: 'Remote', kind: 'anthropic', model: 'model', capability: 'unavailable', baseHost: 'example.com' }],
      logs: [{ timestamp: '2026-09-02T00:00:00.000Z', level: 'error', module: 'provider', code: 'AUTHENTICATION', operation: `failed ${SECRET}` }],
      database: { integrity: 'ok', recoveryWarning: null },
      unsafeProbe: { secret: SECRET, document: DOCUMENT },
    } as never)
    const bytes = await readFile(path)
    expect(bytes.toString('utf8')).not.toContain(SECRET)
    expect(bytes.toString('utf8')).not.toContain(DOCUMENT)
    expect(JSON.parse(bytes.toString('utf8')).categories).toContain('Safe logs')
    expect((await import('node:fs/promises').then(({ stat }) => stat(path))).mode & 0o777).toBe(0o600)
  })
})
