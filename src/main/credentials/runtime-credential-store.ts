import type { CredentialStore } from './credential-store'
import { InMemoryCredentialStore } from './in-memory-credential-store'
import { createKeyringCredentialStore } from './keyring-credential-store'

export function createRuntimeCredentialStore(input: {
  testUserData: string | null
  createKeyring?: () => CredentialStore
}): CredentialStore {
  return input.testUserData
    ? new InMemoryCredentialStore()
    : (input.createKeyring ?? createKeyringCredentialStore)()
}
