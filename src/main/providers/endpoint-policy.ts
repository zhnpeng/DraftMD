import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'

export type EndpointPolicyErrorCode =
  | 'INVALID_ENDPOINT'
  | 'INSECURE_HTTP_APPROVAL_REQUIRED'
  | 'ENDPOINT_ADDRESS_CHANGED'

export class EndpointPolicyError extends Error {
  constructor(readonly code: EndpointPolicyErrorCode) {
    super(code)
    this.name = 'EndpointPolicyError'
  }
}

export interface ValidatedEndpoint {
  url: URL
  local: boolean
}

type Lookup = typeof dnsLookup

function isPrivateIPv4(address: string): boolean {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
  return parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
}

function isPrivateIPv6(address: string): boolean {
  const normalized = address.toLowerCase().split('%')[0]
  return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')
}

function isPrivateAddress(address: string): boolean {
  const family = isIP(address)
  return family === 4 ? isPrivateIPv4(address) : family === 6 ? isPrivateIPv6(address) : false
}

function normalizedHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, '')
}

function isLocalHost(hostname: string): boolean {
  const normalized = normalizedHostname(hostname)
  return normalized === 'localhost' || normalized.endsWith('.local') || isPrivateAddress(normalized)
}

export function validateProviderEndpoint(endpoint: string, insecureHttpApproved: boolean): ValidatedEndpoint {
  let url: URL
  try { url = new URL(endpoint) } catch { throw new EndpointPolicyError('INVALID_ENDPOINT') }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:')
    || url.username || url.password || url.hash) throw new EndpointPolicyError('INVALID_ENDPOINT')
  const local = isLocalHost(url.hostname)
  if (url.protocol === 'http:' && !local && !insecureHttpApproved) {
    throw new EndpointPolicyError('INSECURE_HTTP_APPROVAL_REQUIRED')
  }
  return { url, local }
}

export async function assertEndpointBeforeRequest(
  endpoint: string,
  insecureHttpApproved: boolean,
  lookup: Lookup = dnsLookup,
): Promise<void> {
  const validated = validateProviderEndpoint(endpoint, insecureHttpApproved)
  const hostname = normalizedHostname(validated.url.hostname)
  if (isIP(hostname) || hostname === 'localhost') return
  const addresses = await lookup(hostname, { all: true, verbatim: true })
  if (!validated.local && addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new EndpointPolicyError('ENDPOINT_ADDRESS_CHANGED')
  }
}
