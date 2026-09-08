import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { peArchitecture, validatePackagedNativeModules } from '../../../scripts/afterPack.js'

const app = join('release', 'DraftMD.app')
const winApp = join('release', 'win-unpacked')

function path(name: string): string {
  return join(app, 'Contents', 'Resources', 'node_modules', name)
}

function winPath(name: string): string {
  return join(winApp, 'resources', 'node_modules', name)
}

function pe(machine: number): Buffer {
  const bytes = Buffer.alloc(0x90)
  bytes.write('MZ')
  bytes.writeUInt32LE(0x80, 0x3c)
  bytes.write('PE\0\0', 0x80)
  bytes.writeUInt16LE(machine, 0x84)
  return bytes
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

  it('validates Windows x64 native module paths and PE machine headers', () => {
    const required = [
      winPath('better-sqlite3/lib/index.js'),
      winPath('better-sqlite3/prebuilds/win32-x64.node'),
      winPath('@napi-rs/keyring/index.js'),
      winPath('@napi-rs/keyring-win32-x64-msvc/keyring.win32-x64-msvc.node'),
    ]
    const exists = vi.fn((candidate: string) => required.includes(candidate))
    const nativeArchitecture = vi.fn(() => 'x64')
    expect(validatePackagedNativeModules({
      appPath: winApp, platform: 'win32', arch: 'x64', exists, nativeArchitecture,
    })).toEqual(required)
    expect(nativeArchitecture).toHaveBeenCalledTimes(2)
  })

  it('reads x64 PE headers and rejects non-PE binaries', () => {
    expect(peArchitecture('/fixture/addon.node', () => pe(0x8664))).toBe('x64')
    expect(peArchitecture('/fixture/addon.node', () => pe(0xaa64))).toBe('arm64')
    expect(() => peArchitecture('/fixture/addon.node', () => Buffer.from('not a PE'))).toThrow(/not a PE/i)
  })
})
