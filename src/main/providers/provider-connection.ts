import { providerApiMode, type ProviderConfig } from '../../shared/contracts/provider'

export function sameProviderConnection(left: ProviderConfig, right: ProviderConfig): boolean {
  if (providerApiMode(left) !== providerApiMode(right)) return false
  const fields = [
    'kind', 'preset', 'baseUrl', 'model', 'credentialRef', 'timeoutMs',
    'streamEnabled', 'toolsEnabled', 'insecureHttpApproved',
  ] as const
  if (fields.some(field => left[field] !== right[field])) return false
  const names = Object.keys(left.headerCredentialRefs)
  return names.length === Object.keys(right.headerCredentialRefs).length
    && names.every(name => left.headerCredentialRefs[name] === right.headerCredentialRefs[name])
}
