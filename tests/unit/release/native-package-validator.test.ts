import { describe, expect, it, vi } from 'vitest'
import { validatePackagedNativeModules } from '../../../scripts/afterPack.js'

const app = '/release/DraftMD.app'

function path(name: string): string {
  return `${app}/Contents/Resources/node_modules/${name}`
}

describe('packaged native module validator', () => {
  it('reports the exact first missing runtime module path', () => {
    const exists = vi.fn(() => false)
    expect(() => validatePackagedNativeModules({ appPath: app, arch: 'arm64', exists, architectures: vi.fn() }))
      .toThrow(path('better-sqlite3/lib/index.js'))
  })

  it.each([
    ['arm64', 'better-sqlite3/prebuilds/darwin-arm64.node', '@napi-rs/keyring-darwin-arm64/keyring.darwin-arm64.node'],
    ['x64', 'better-sqlite3/prebuilds/darwin-x64.node', '@napi-rs/keyring-darwin-x64/keyring.darwin-x64.node'],
  ] as const)('validates the %s package paths and Mach-O architecture', (arch, sqlite, keyring) => {
    const required = [
      path('better-sqlite3/lib/index.js'), path(sqlite),
      path('@napi-rs/keyring/index.js'), path(keyring),
    ]
    const exists = vi.fn((candidate: string) => required.includes(candidate))
    const architectures = vi.fn(() => [arch === 'x64' ? 'x86_64' : arch])
    expect(validatePackagedNativeModules({ appPath: app, arch, exists, architectures })).toEqual(required)
    expect(architectures).toHaveBeenCalledTimes(2)
  })


  it('validates both architecture-specific binaries in the final Universal app', () => {
    const required = [
      path('better-sqlite3/lib/index.js'),
      path('better-sqlite3/prebuilds/darwin-arm64.node'),
      path('better-sqlite3/prebuilds/darwin-x64.node'),
      path('@napi-rs/keyring/index.js'),
      path('@napi-rs/keyring-darwin-arm64/keyring.darwin-arm64.node'),
      path('@napi-rs/keyring-darwin-x64/keyring.darwin-x64.node'),
    ]
    const exists = vi.fn((candidate: string) => required.includes(candidate))
    const architectures = vi.fn((candidate: string) => candidate.includes('arm64') ? ['arm64'] : ['x86_64'])
    expect(validatePackagedNativeModules({ appPath: app, arch: 'universal', exists, architectures })).toEqual(required)
    expect(architectures).toHaveBeenCalledTimes(4)
  })

  it('fails closed when a packaged binary has the wrong architecture', () => {
    const exists = vi.fn(() => true)
    expect(() => validatePackagedNativeModules({ appPath: app, arch: 'x64', exists, architectures: () => ['arm64'] }))
      .toThrow(/expected x64.*found arm64/i)
  })
})
