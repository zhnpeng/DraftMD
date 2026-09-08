import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createKeyringCredentialStore } from '../../../src/main/credentials/keyring-credential-store'

const run = ['darwin', 'win32'].includes(process.platform) && process.env.DRAFTMD_RUN_KEYCHAIN_TESTS === '1'

describe.skipIf(!run)('system credential store integration', () => {
  it('round-trips and removes a random credential', async () => {
    const store = createKeyringCredentialStore()
    const ref = randomUUID()
    const secret = randomUUID()
    try {
      await store.set(ref, secret)
      expect(await store.get(ref)).toBe(secret)
    } finally {
      await store.delete(ref)
    }
    expect(await store.get(ref)).toBeNull()
  })
})
