import { describe, expect, it } from 'vitest'
import { InMemoryCredentialStore } from '../../../src/main/credentials/in-memory-credential-store'

function contract(factory: () => InMemoryCredentialStore): void {
  it('sets, retrieves, overwrites, and deletes a secret by opaque reference', async () => {
    const store = factory()
    const ref = '01991d5a-1c00-7000-8000-000000000000'

    expect(await store.get(ref)).toBeNull()
    await store.set(ref, 'first-secret')
    expect(await store.get(ref)).toBe('first-secret')
    await store.set(ref, 'second-secret')
    expect(await store.get(ref)).toBe('second-secret')
    expect(await store.delete(ref)).toBe(true)
    expect(await store.delete(ref)).toBe(false)
    expect(await store.get(ref)).toBeNull()
  })

  it('does not expose stored secrets through serialization or property inspection', async () => {
    const store = factory()
    await store.set('01991d5a-1c00-7000-8000-000000000001', 'known-test-secret')

    expect(JSON.stringify(store)).not.toContain('known-test-secret')
    expect(Object.values(store)).not.toContain('known-test-secret')
  })
}

describe('CredentialStore contract', () => {
  contract(() => new InMemoryCredentialStore())
})
