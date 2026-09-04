import { describe, expect, it, vi } from 'vitest'
import {
  assertEndpointBeforeRequest,
  validateProviderEndpoint,
} from '../../../src/main/providers/endpoint-policy'

describe('provider endpoint policy', () => {
  it.each([
    ['https://api.example.com/v1', false],
    ['http://localhost:11434/v1', true],
    ['http://127.0.0.1:11434/v1', true],
    ['http://[::1]:1234/v1', true],
    ['http://modelbox.local/v1', true],
    ['http://10.1.2.3/v1', true],
    ['http://172.16.1.2/v1', true],
    ['http://192.168.1.2/v1', true],
  ])('allows %s with local=%s', (endpoint, local) => {
    expect(validateProviderEndpoint(endpoint, false)).toMatchObject({ local })
  })

  it('requires explicit approval for public HTTP', () => {
    expect(() => validateProviderEndpoint('http://api.example.com/v1', false)).toThrowError(expect.objectContaining({
      code: 'INSECURE_HTTP_APPROVAL_REQUIRED',
    }))
    expect(validateProviderEndpoint('http://api.example.com/v1', true)).toMatchObject({ local: false })
  })

  it.each([
    'file:///tmp/model',
    'ftp://example.com/model',
    'https://user:pass@example.com/v1',
    'https://example.com/v1#private',
    'not a URL',
  ])('rejects unsafe endpoint %s', (endpoint) => {
    expect(() => validateProviderEndpoint(endpoint, true)).toThrowError(expect.objectContaining({
      code: 'INVALID_ENDPOINT',
    }))
  })

  it('allows a public hostname that resolves to public addresses immediately before request', async () => {
    const lookup = vi.fn().mockResolvedValue([
      { address: '203.0.113.5', family: 4 },
      { address: '2001:db8::5', family: 6 },
    ])

    await expect(assertEndpointBeforeRequest('https://api.example.com/v1', false, lookup)).resolves.toBeUndefined()
    expect(lookup).toHaveBeenCalledWith('api.example.com', { all: true, verbatim: true })
  })

  it('rejects DNS rebinding from a public hostname to a private address', async () => {
    const lookup = vi.fn().mockResolvedValue([{ address: '127.0.0.1', family: 4 }])

    await expect(assertEndpointBeforeRequest('https://api.example.com/v1', false, lookup)).rejects.toMatchObject({
      code: 'ENDPOINT_ADDRESS_CHANGED',
    })
  })

  it('permits private DNS resolution only for an endpoint explicitly classified as local', async () => {
    const lookup = vi.fn().mockResolvedValue([{ address: '192.168.1.20', family: 4 }])

    await expect(assertEndpointBeforeRequest('http://modelbox.local/v1', false, lookup)).resolves.toBeUndefined()
  })
})
