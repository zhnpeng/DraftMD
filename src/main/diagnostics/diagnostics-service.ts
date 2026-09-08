import { arch, release } from 'node:os'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import {
  DiagnosticsBundleSchema,
  SafeLogEntrySchema,
  type DiagnosticsBundle,
} from '../../shared/contracts/diagnostics'
import type { ProviderConfigDTO } from '../../shared/contracts/provider'
import { exportDiagnosticsJSON } from './export-diagnostics'
import type { SafeLogInput } from '../../shared/contracts/diagnostics'

export function createDiagnosticsService(input: {
  appVersion(): string
  electronVersion(): string
  platform?: NodeJS.Platform
  logsDirectory: string
  database: Database.Database
  databaseWarning: 'DATABASE_RECOVERED' | 'DATABASE_MEMORY_FALLBACK' | null
  locale(): 'en' | 'zh-CN'
  theme(): string
  providers(): ProviderConfigDTO[]
  log?(entry: SafeLogInput): void
}) {
  const readLogs = () => {
    try {
      return readdirSync(input.logsDirectory)
        .filter((name) => /^draftmd\.log(?:\.\d+)?$/.test(name))
        .sort()
        .flatMap((name) => readFileSync(join(input.logsDirectory, name), 'utf8').split('\n'))
        .flatMap((line) => {
          if (!line) return []
          try {
            const parsed = SafeLogEntrySchema.safeParse(JSON.parse(line))
            return parsed.success ? [parsed.data] : []
          } catch { return [] }
        })
        .slice(-10_000)
    } catch { return [] }
  }
  return {
    preview(): DiagnosticsBundle {
      let integrity: 'ok' | 'failed' | 'unavailable' = 'unavailable'
      try {
        const row = input.database.pragma('integrity_check', { simple: true })
        integrity = row === 'ok' ? 'ok' : 'failed'
      } catch { integrity = 'unavailable' }
      return DiagnosticsBundleSchema.parse({
        categories: ['Application', 'Safe settings', 'Provider metadata', 'Safe logs', 'Database integrity'],
        app: {
          version: input.appVersion(), electron: input.electronVersion(), platform: input.platform ?? process.platform,
          arch: arch() === 'x64' ? 'x64' : 'arm64', osRelease: release(),
        },
        settings: { locale: input.locale(), theme: input.theme() },
        providers: input.providers().map((provider) => ({
          name: provider.name, kind: provider.kind, model: provider.model,
          capability: provider.capability, baseHost: new URL(provider.baseUrl).hostname,
        })),
        logs: readLogs(),
        database: { integrity, recoveryWarning: input.databaseWarning },
      })
    },
    async export(path: string): Promise<void> {
      const { categories: _categories, ...inputBundle } = this.preview()
      await exportDiagnosticsJSON(path, inputBundle)
      input.log?.({ level: 'info', module: 'diagnostics', operation: 'export' })
    },
  }
}
