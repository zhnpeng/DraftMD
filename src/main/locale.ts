import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { detectLocale, type Locale } from '../shared/i18n'

interface PersistedSettings {
  locale?: unknown
}

function isLocale(value: unknown): value is Locale {
  return value === 'zh-CN' || value === 'en'
}

export function readSavedLocale(settingsPath: string): Locale | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(settingsPath, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const { locale } = parsed as PersistedSettings
    return isLocale(locale) ? locale : null
  } catch {
    return null
  }
}

export function resolveAppLocale(settingsPath: string, systemLanguage: string): Locale {
  return readSavedLocale(settingsPath) ?? detectLocale(systemLanguage)
}


export function writeSavedLocale(settingsPath: string, locale: Locale): void {
  let settings: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(readFileSync(settingsPath, 'utf8'))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) settings = parsed as Record<string, unknown>
  } catch { /* Start from a clean settings object. */ }
  mkdirSync(dirname(settingsPath), { recursive: true })
  const temporary = `${settingsPath}.draftmd-tmp`
  writeFileSync(temporary, JSON.stringify({ ...settings, locale }, null, 2), { mode: 0o600 })
  renameSync(temporary, settingsPath)
}
