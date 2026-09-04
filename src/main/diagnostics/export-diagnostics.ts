import { chmod, rename, writeFile } from 'node:fs/promises'
import {
  DiagnosticsBundleSchema,
  SafeLogEntrySchema,
  type DiagnosticsBundle,
  type DiagnosticsInput,
} from '../../shared/contracts/diagnostics'

const CATEGORIES = ['Application', 'Safe settings', 'Provider metadata', 'Safe logs', 'Database integrity'] as const
const REDACTED = '[REDACTED]'
const SENSITIVE_KEY = /(?:api.?key|authorization|credential|secret|token|header.?value|password|document|prompt|response|content)/i
const SECRET_VALUE = /(?:\bBearer\s+)?(?:sk-|key-|token-)[A-Za-z0-9_.-]{6,}/gi

export function redactDiagnosticValue(value: unknown, key = ''): unknown {
  if (key !== 'tokenUsage' && SENSITIVE_KEY.test(key)) return REDACTED
  if (typeof value === 'string') return value.replace(SECRET_VALUE, REDACTED)
  if (Array.isArray(value)) return value.map((item) => redactDiagnosticValue(item))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redactDiagnosticValue(item, name)]))
  }
  return value
}

export function buildDiagnosticsPreview(input: DiagnosticsInput): DiagnosticsBundle {
  const redacted = redactDiagnosticValue(input) as Record<string, unknown>
  const logs = Array.isArray(redacted.logs)
    ? redacted.logs.flatMap((entry) => {
      const parsed = SafeLogEntrySchema.safeParse(entry)
      return parsed.success ? [parsed.data] : []
    })
    : []
  return DiagnosticsBundleSchema.parse({
    categories: CATEGORIES,
    app: redacted.app,
    settings: redacted.settings,
    providers: redacted.providers,
    logs,
    database: redacted.database,
  })
}

export async function exportDiagnosticsJSON(path: string, input: DiagnosticsInput): Promise<void> {
  const bundle = buildDiagnosticsPreview(input)
  const temporary = `${path}.draftmd-tmp`
  await writeFile(temporary, JSON.stringify(bundle, null, 2), { mode: 0o600 })
  await chmod(temporary, 0o600)
  await rename(temporary, path)
}
