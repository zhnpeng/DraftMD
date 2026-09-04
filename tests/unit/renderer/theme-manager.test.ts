import { beforeEach, describe, expect, it, vi } from 'vitest'

const storage = new Map<string, string>()
const reportTheme = vi.fn()
const classes = new Set<string>()

vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
})
vi.stubGlobal('document', {
  body: {
    classList: {
      add: (...names: string[]) => names.forEach((name) => classes.add(name)),
      remove: (...names: string[]) => names.forEach((name) => classes.delete(name)),
    },
  },
})
vi.stubGlobal('window', { draftmd: { reportTheme } })

import { applyTheme, loadSavedTheme } from '../../../src/renderer/themes/theme-manager'

describe('theme validation', () => {
  beforeEach(() => {
    storage.clear()
    classes.clear()
    reportTheme.mockClear()
  })

  it.each(['constructor', 'toString'])('rejects inherited persisted theme name %s', (name) => {
    storage.set('colamd-theme', name)
    expect(loadSavedTheme()).toBe('elegant')
  })

  it.each(['constructor', 'toString'])('falls back before reporting inherited theme name %s', (name) => {
    applyTheme(name)
    expect(classes).toContain('theme-elegant')
    expect(storage.get('colamd-theme')).toBe('elegant')
    expect(reportTheme).toHaveBeenCalledOnce()
    expect(reportTheme).toHaveBeenCalledWith('elegant')
  })

  it('reports a finite valid theme unchanged', () => {
    applyTheme('nord')
    expect(classes).toContain('theme-nord')
    expect(reportTheme).toHaveBeenCalledWith('nord')
  })
})
