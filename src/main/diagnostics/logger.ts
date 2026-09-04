import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SafeLogEntrySchema, type SafeLogInput } from '../../shared/contracts/diagnostics'

export function createSafeLogger(input: {
  directory: string
  maxBytes?: number
  maxFiles?: number
  now?: () => string
}) {
  const maxBytes = input.maxBytes ?? 2 * 1024 * 1024
  const maxFiles = input.maxFiles ?? 5
  const now = input.now ?? (() => new Date().toISOString())
  const active = join(input.directory, 'draftmd.log')
  mkdirSync(input.directory, { recursive: true, mode: 0o700 })
  const rotate = (): void => {
    if (maxFiles <= 1) { rmSync(active, { force: true }); return }
    rmSync(`${active}.${maxFiles - 1}`, { force: true })
    for (let index = maxFiles - 2; index >= 1; index -= 1) {
      const from = `${active}.${index}`
      if (existsSync(from)) renameSync(from, `${active}.${index + 1}`)
    }
    if (existsSync(active)) renameSync(active, `${active}.1`)
  }
  return {
    write(value: SafeLogInput): void {
      const entry = SafeLogEntrySchema.parse({ timestamp: now(), ...value })
      const line = `${JSON.stringify(entry)}\n`
      const bytes = Buffer.byteLength(line)
      if (existsSync(active) && statSync(active).size + bytes > maxBytes) rotate()
      writeFileSync(active, line, { flag: 'a', mode: 0o600 })
      chmodSync(active, 0o600)
    },
  }
}
