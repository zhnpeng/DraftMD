import { chineseMessages, englishMessages, messages, type MessageKey } from './messages'

export type Locale = 'zh-CN' | 'en'
export type MessageVars = Record<string, string | number>
export { messages, type MessageKey }

export function detectLocale(language: string | null | undefined): Locale {
  return language?.trim().toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}

export function assertCatalogParity(): void {
  const englishKeys = Object.keys(englishMessages).sort()
  const chineseKeys = Object.keys(chineseMessages).sort()
  const missing = englishKeys.filter((key) => !chineseKeys.includes(key))
  const extra = chineseKeys.filter((key) => !englishKeys.includes(key))
  if (missing.length || extra.length) {
    throw new Error(`Catalog mismatch; missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'}`)
  }
}

export function t(locale: Locale, key: MessageKey, vars: MessageVars = {}): string {
  const template = messages[locale][key]
  return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (_match, name: string) => {
    if (!(name in vars)) throw new Error(`Missing interpolation value: ${name}`)
    return String(vars[name])
  })
}

let activeLocale: Locale = detectLocale(
  typeof navigator === 'undefined' ? undefined : navigator.language,
)

export function setLocale(locale: Locale): void {
  activeLocale = locale
}

export function getLocale(): Locale {
  return activeLocale
}

export function msg(key: MessageKey, vars?: MessageVars): string {
  return t(activeLocale, key, vars)
}
