import type { ProviderPreset } from '../../shared/contracts/provider'

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
