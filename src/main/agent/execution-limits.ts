import type { ParsedToolCall } from './tools/schemas'

export interface ExecutionLimits {
  maxToolCalls: number
  maxWallTimeMs: number
  maxIdenticalCalls: number
  maxInvalidEditsPerPath: number
}

export const DEFAULT_EXECUTION_LIMITS: ExecutionLimits = {
  maxToolCalls: 40,
  maxWallTimeMs: 10 * 60_000,
  maxIdenticalCalls: 3,
  maxInvalidEditsPerPath: 3,
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  return JSON.stringify(value)
}

export function toolCallFingerprint(call: ParsedToolCall): string {
  return `${call.name}:${canonical(call.input)}`
}
