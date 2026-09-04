import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveAppLocale, writeSavedLocale } from '../../../src/main/locale'

function settingsPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'draftmd-locale-')), 'settings.json')
}

describe('resolveAppLocale', () => {
  it.each(['zh-CN', 'en'] as const)('prefers saved locale %s over the system locale', (locale) => {
    const path = settingsPath()
    writeFileSync(path, JSON.stringify({ locale }))

    expect(resolveAppLocale(path, locale === 'en' ? 'zh-CN' : 'en-US')).toBe(locale)
  })

  it('falls back to detected system locale when settings are missing', () => {
    expect(resolveAppLocale(settingsPath(), 'zh-Hans-US')).toBe('zh-CN')
  })

  it.each([
    '{broken',
    JSON.stringify({ locale: 'fr-FR' }),
    JSON.stringify({ locale: 42 }),
    JSON.stringify(null),
  ])('falls back safely for malformed or invalid settings: %s', (contents) => {
    const path = settingsPath()
    writeFileSync(path, contents)

    expect(resolveAppLocale(path, 'en-US')).toBe('en')
  })
})

describe('main-process locale integration', () => {
  it('does not resolve userData paths at module evaluation', () => {
    const mainSource = readFileSync('src/main/index.ts', 'utf8')
    const topLevelUserDataPath = /^const\s+\w+Path\s*=.*app\.getPath\(['"]userData['"]\)/m

    expect(mainSource).not.toMatch(topLevelUserDataPath)
    expect(mainSource).toContain("resolveAppLocale(join(app.getPath('userData'), 'settings.json'), app.getLocale())")
  })
})


it('writes locale atomically while preserving other settings fields', () => {
  const path = settingsPath()
  writeFileSync(path, JSON.stringify({ locale: 'en', theme: 'dark' }))
  writeSavedLocale(path, 'zh-CN')
  expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ locale: 'zh-CN', theme: 'dark' })
})

it('recovers a malformed settings file when saving locale', () => {
  const path = settingsPath()
  writeFileSync(path, '{broken')
  writeSavedLocale(path, 'en')
  expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ locale: 'en' })
})
