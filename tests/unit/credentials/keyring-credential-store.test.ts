import { describe, expect, it, vi } from 'vitest'
import {
  KeyringCredentialStore,
  type KeyringEntry,
} from '../../../src/main/credentials/keyring-credential-store'

class FakeEntry implements KeyringEntry {
  secret: string | null = null
  async setPassword(secret: string): Promise<void> { this.secret = secret }
  async getPassword(): Promise<string> {
    if (this.secret === null) throw Object.assign(new Error('No password found'), { code: 'NoEntry' })
    return this.secret
  }
  async deletePassword(): Promise<boolean> {
    if (this.secret === null) return false
    this.secret = null
    return true
  }
}

describe('KeyringCredentialStore', () => {
  it('uses the fixed service name and opaque reference as the account', async () => {
    const entry = new FakeEntry()
    const createEntry = vi.fn(() => entry)
    const store = new KeyringCredentialStore(createEntry)

    await store.set('01991d5a-1c00-7000-8000-000000000000', 'secret')

    expect(createEntry).toHaveBeenCalledWith(
      'app.draftmd.desktop',
      '01991d5a-1c00-7000-8000-000000000000',
    )
    expect(await store.get('01991d5a-1c00-7000-8000-000000000000')).toBe('secret')
  })


  it('maps an undefined native password to an absent credential', async () => {
    const entry: KeyringEntry = {
      setPassword: vi.fn(),
      getPassword: vi.fn().mockResolvedValue(undefined),
      deletePassword: vi.fn().mockResolvedValue(false),
    }
    const store = new KeyringCredentialStore(() => entry)

    await expect(store.get('01991d5a-1c00-7000-8000-000000000000')).resolves.toBeNull()
  })

  it('normalizes a missing item without including secret or native error text', async () => {
    const entry: KeyringEntry = {
      setPassword: vi.fn(),
      getPassword: vi.fn().mockRejectedValue(Object.assign(new Error('No password for private@example.com'), { code: 'NoEntry' })),
      deletePassword: vi.fn().mockResolvedValue(false),
    }
    const store = new KeyringCredentialStore(() => entry)

    await expect(store.get('01991d5a-1c00-7000-8000-000000000000')).resolves.toBeNull()
  })

  it.each([
    ['permission denied', 'KEYCHAIN_DENIED'],
    ['user canceled the operation', 'KEYCHAIN_DENIED'],
    ['keychain is not available', 'KEYCHAIN_UNAVAILABLE'],
  ])('normalizes native failure %s', async (message, code) => {
    const entry: KeyringEntry = {
      setPassword: vi.fn().mockRejectedValue(new Error(`${message}: known-test-secret`)),
      getPassword: vi.fn(),
      deletePassword: vi.fn(),
    }
    const store = new KeyringCredentialStore(() => entry)

    let thrown: unknown
    try { await store.set('01991d5a-1c00-7000-8000-000000000000', 'known-test-secret') } catch (error) { thrown = error }
    expect(thrown).toMatchObject({ code })
    expect(JSON.stringify(thrown)).not.toContain('known-test-secret')
    expect((thrown as Error).message).toBe(code)
  })
})
