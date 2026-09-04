export interface CredentialStore {
  set(ref: string, secret: string): Promise<void>
  get(ref: string): Promise<string | null>
  delete(ref: string): Promise<boolean>
}

export type CredentialStoreErrorCode =
  | 'KEYCHAIN_DENIED'
  | 'KEYCHAIN_UNAVAILABLE'
  | 'KEYCHAIN_ITEM_NOT_FOUND'

export class CredentialStoreError extends Error {
  constructor(readonly code: CredentialStoreErrorCode) {
    super(code)
    this.name = 'CredentialStoreError'
  }
}
