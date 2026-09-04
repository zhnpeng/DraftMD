import { describe, expect, it, vi } from 'vitest'
import { InMemoryCredentialStore } from '../../../src/main/credentials/in-memory-credential-store'
import { createRuntimeCredentialStore } from '../../../src/main/credentials/runtime-credential-store'

it('uses isolated in-memory credentials for deterministic test user data', () => {
  const keyring = vi.fn()
  const store = createRuntimeCredentialStore({ testUserData: '/tmp/draftmd-test', createKeyring: keyring })
  expect(store).toBeInstanceOf(InMemoryCredentialStore)
  expect(keyring).not.toHaveBeenCalled()
})

it('uses macOS Keychain outside the isolated test runtime', () => {
  const expected = new InMemoryCredentialStore()
  const keyring = vi.fn(() => expected)
  expect(createRuntimeCredentialStore({ testUserData: null, createKeyring: keyring })).toBe(expected)
  expect(keyring).toHaveBeenCalledOnce()
})
