import { describe, expect, it } from 'vitest'
import {
  applyProviderPreset,
  providerSecretState,
} from '../../../src/renderer/settings/provider-form'

describe('provider form behavior', () => {
  it.each([
    ['ollama', 'http://127.0.0.1:11434/v1'],
    ['lm-studio', 'http://127.0.0.1:1234/v1'],
  ] as const)('fills the %s endpoint while keeping it editable', (preset, baseUrl) => {
    expect(applyProviderPreset({ preset, baseUrl: 'https://old.example/v1' })).toEqual({
      preset, baseUrl,
    })
  })

  it('does not replace a custom endpoint for the none preset', () => {
    expect(applyProviderPreset({ preset: 'none', baseUrl: 'https://custom.example/v1' })).toEqual({
      preset: 'none', baseUrl: 'https://custom.example/v1',
    })
  })

  it('keeps saved secrets write-only until explicit replace or remove', () => {
    expect(providerSecretState(true, 'retain')).toEqual({ status: 'saved', inputVisible: false, remove: false })
    expect(providerSecretState(true, 'replace')).toEqual({ status: 'replace', inputVisible: true, remove: false })
    expect(providerSecretState(true, 'remove')).toEqual({ status: 'removed', inputVisible: false, remove: true })
    expect(providerSecretState(false, 'retain')).toEqual({ status: 'empty', inputVisible: true, remove: false })
  })
})
