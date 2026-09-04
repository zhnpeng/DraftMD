import type { CredentialStore } from './credential-store'

const secrets = new WeakMap<InMemoryCredentialStore, Map<string, string>>()

export class InMemoryCredentialStore implements CredentialStore {
  constructor() {
    secrets.set(this, new Map())
  }
  async set(ref: string, secret: string): Promise<void> {
    secrets.get(this)!.set(ref, secret)
  }
  async get(ref: string): Promise<string | null> {
    return secrets.get(this)!.get(ref) ?? null
  }
  async delete(ref: string): Promise<boolean> {
    return secrets.get(this)!.delete(ref)
  }
  toJSON(): Record<string, never> {
    return {}
  }
}
