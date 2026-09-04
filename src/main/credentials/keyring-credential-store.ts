import type { AsyncEntry as AsyncEntryType } from '@napi-rs/keyring'
import { runtimeModule } from '../app/runtime-module-loader'

const { AsyncEntry } = runtimeModule('@napi-rs/keyring') as { AsyncEntry: typeof AsyncEntryType }
import { CredentialStoreError, type CredentialStore, type CredentialStoreErrorCode } from './credential-store'

const SERVICE_NAME = 'app.draftmd.desktop'

export interface KeyringEntry {
  setPassword(secret: string): Promise<void>
  getPassword(): Promise<string | undefined>
  deletePassword(): Promise<boolean>
}

type EntryFactory = (service: string, account: string) => KeyringEntry

function errorCode(error: unknown): CredentialStoreErrorCode {
  const nativeCode = String((error as NodeJS.ErrnoException).code ?? '').toLowerCase()
  const message = error instanceof Error ? error.message.toLowerCase() : ''
  const value = `${nativeCode} ${message}`
  if (/noentry|not found|no password/.test(value)) return 'KEYCHAIN_ITEM_NOT_FOUND'
  if (/denied|cancel|interaction.*not.*allowed|auth/.test(value)) return 'KEYCHAIN_DENIED'
  return 'KEYCHAIN_UNAVAILABLE'
}

function normalize(error: unknown): CredentialStoreError {
  return new CredentialStoreError(errorCode(error))
}

export class KeyringCredentialStore implements CredentialStore {
  constructor(private readonly createEntry: EntryFactory) {}

  async set(ref: string, secret: string): Promise<void> {
    try {
      await this.createEntry(SERVICE_NAME, ref).setPassword(secret)
    } catch (error) {
      throw normalize(error)
    }
  }

  async get(ref: string): Promise<string | null> {
    try {
      return await this.createEntry(SERVICE_NAME, ref).getPassword() ?? null
    } catch (error) {
      const normalized = normalize(error)
      if (normalized.code === 'KEYCHAIN_ITEM_NOT_FOUND') return null
      throw normalized
    }
  }

  async delete(ref: string): Promise<boolean> {
    try {
      return await this.createEntry(SERVICE_NAME, ref).deletePassword()
    } catch (error) {
      const normalized = normalize(error)
      if (normalized.code === 'KEYCHAIN_ITEM_NOT_FOUND') return false
      throw normalized
    }
  }

  toJSON(): Record<string, never> {
    return {}
  }
}

export function createKeyringCredentialStore(): KeyringCredentialStore {
  return new KeyringCredentialStore((service, account) => new AsyncEntry(service, account))
}
