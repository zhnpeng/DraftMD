import type { ProviderKind, ProviderPreset } from '../../shared/contracts/provider'

export const PROVIDER_MODEL_PRESETS_UPDATED_AT = '2026-09-05'

export function providerModelDefaults(kind: ProviderKind, preset: ProviderPreset = 'none') {
  if (preset !== 'none') return { baseUrl: applyProviderPreset({ preset, baseUrl: '' }).baseUrl, model: '', models: [] as string[] }
  if (kind === 'anthropic') return {
    baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-5',
    models: ['claude-fable-5-1', 'claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5-20251001'],
  }
  const openai = ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']
  if (kind === 'openai') return { baseUrl: 'https://api.openai.com/v1', model: 'gpt-5.6-terra', models: openai }
  return { baseUrl: '', model: '', models: [...openai, 'deepseek-v4-flash', 'deepseek-v4-pro'] }
}

export function applyProviderPreset(input: { preset: ProviderPreset; baseUrl: string }): { preset: ProviderPreset; baseUrl: string } {
  if (input.preset === 'ollama') return { ...input, baseUrl: 'http://127.0.0.1:11434/v1' }
  if (input.preset === 'lm-studio') return { ...input, baseUrl: 'http://127.0.0.1:1234/v1' }
  return input
}

export type SecretAction = 'retain' | 'replace' | 'remove'
export function providerSecretState(hasCredential: boolean, action: SecretAction): {
  status: 'saved' | 'replace' | 'removed' | 'empty'
  inputVisible: boolean
  remove: boolean
} {
  if (!hasCredential) return { status: 'empty', inputVisible: true, remove: false }
  if (action === 'replace') return { status: 'replace', inputVisible: true, remove: false }
  if (action === 'remove') return { status: 'removed', inputVisible: false, remove: true }
  return { status: 'saved', inputVisible: false, remove: false }
}
