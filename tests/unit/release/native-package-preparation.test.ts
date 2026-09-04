import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  KEYRING_PACKAGES,
  lockedPackage,
  verifyIntegrity,
} from '../../../scripts/prepare-native-packages.js'

const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'))

describe('Universal native package preparation', () => {
  it('pins both Darwin keyring architectures to lockfile URLs and integrity', () => {
    expect(KEYRING_PACKAGES).toEqual([
      '@napi-rs/keyring-darwin-arm64',
      '@napi-rs/keyring-darwin-x64',
    ])
    for (const name of KEYRING_PACKAGES) {
      const item = lockedPackage(lock, name)
      expect(item.version).toBe('2.0.0')
      expect(item.resolved).toMatch(/^https:\/\/registry\.npmjs\.org\//)
      expect(item.integrity).toMatch(/^sha512-/)
    }
  })

  it('accepts exact SRI bytes and rejects tampering', () => {
    const bytes = Buffer.from('locked native package')
    const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`
    expect(() => verifyIntegrity(bytes, integrity)).not.toThrow()
    expect(() => verifyIntegrity(Buffer.from('tampered'), integrity)).toThrow(/integrity/i)
  })

  it('rejects missing or incomplete lock entries', () => {
    expect(() => lockedPackage({ packages: {} }, '@napi-rs/keyring-darwin-x64')).toThrow(/lockfile/i)
  })
})

it('extracts only bare runtime package roots from built CommonJS', async () => {
  const { runtimePackageRoots } = await import('../../../scripts/prepare-native-packages.js')
  expect(runtimePackageRoots(`
    require('node:fs'); require('path'); require('electron'); require('./local');
    require('@scope/package/subpath'); require('plain/subpath');
  `)).toEqual(['@scope/package', 'plain'])
})

it('keeps the current main runtime roots free of renderer-only packages', async () => {
  const { runtimePackageRoots } = await import('../../../scripts/prepare-native-packages.js')
  const { readdirSync } = await import('node:fs')
  const files = ['dist/main/index.js', ...readdirSync('dist/main/chunks').filter((name) => name.endsWith('.js')).map((name) => `dist/main/chunks/${name}`)]
  const roots = [...new Set(files.flatMap((file) => runtimePackageRoots(readFileSync(file, 'utf8'))))].sort()
  expect(roots).toEqual([])
  expect(roots.some((name) => /milkdown|mermaid|katex/.test(name))).toBe(false)
  for (const file of [
    '.build/package/node_modules/better-sqlite3/prebuilds/darwin-arm64.node',
    '.build/package/node_modules/better-sqlite3/prebuilds/darwin-x64.node',
    '.build/package/node_modules/@napi-rs/keyring-darwin-arm64/keyring.darwin-arm64.node',
    '.build/package/node_modules/@napi-rs/keyring-darwin-x64/keyring.darwin-x64.node',
  ]) expect(() => readFileSync(file)).not.toThrow()
})


it('keeps the packaging Electron version aligned with the installed runtime', () => {
  const builder = readFileSync('electron-builder.yml', 'utf8')
  const configured = /^electronVersion:\s*['"]([^'"]+)['"]/m.exec(builder)?.[1]
  const installed = JSON.parse(readFileSync('node_modules/electron/package.json', 'utf8')).version
  expect(configured).toBe(installed)
})

it('produces a runtime stage without symlinks that can escape packaging', async () => {
  const { findSymlinks, prepareNativePackages } = await import('../../../scripts/prepare-native-packages.js')
  await prepareNativePackages(process.cwd())
  expect(findSymlinks('.build/package/node_modules')).toEqual([])
})
