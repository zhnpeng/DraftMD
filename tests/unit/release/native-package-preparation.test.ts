import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  KEYRING_PACKAGES,
  findSymlinks,
  lockedPackage,
  runtimeClosure,
  runtimePackageRoots,
  stageLegalNotices,
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

it('extracts only bare runtime package roots from built CommonJS', () => {
  expect(runtimePackageRoots(`
    require('node:fs'); require('path'); require('electron'); require('./local');
    require('@scope/package/subpath'); require('plain/subpath');
  `)).toEqual(['@scope/package', 'plain'])
})

it('builds an empty runtime closure from a clean fixture with no runtime packages', () => {
  const root = mkdtempSync(join(tmpdir(), 'draftmd-runtime-closure-'))
  try {
    mkdirSync(join(root, 'dist/main/chunks'), { recursive: true })
    writeFileSync(join(root, 'package.json'), '{"name":"fixture"}\n')
    writeFileSync(join(root, 'dist/main/index.js'), "require('node:fs')\n")
    expect([...runtimeClosure(root)]).toEqual([])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

it('detects symlinks in a clean runtime fixture', () => {
  const root = mkdtempSync(join(tmpdir(), 'draftmd-runtime-links-'))
  try {
    writeFileSync(join(root, 'target'), 'target')
    symlinkSync('target', join(root, 'link'))
    expect(findSymlinks(root)).toEqual([join(root, 'link')])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

it('keeps the packaging Electron version aligned with the installed runtime', () => {
  const builder = readFileSync('electron-builder.yml', 'utf8')
  const configured = /^electronVersion:\s*['"]([^'"]+)['"]/m.exec(builder)?.[1]
  const installed = JSON.parse(readFileSync('node_modules/electron/package.json', 'utf8')).version
  expect(configured).toBe(installed)
})

it('stages the project license and attribution from a clean fixture', () => {
  const root = mkdtempSync(join(tmpdir(), 'draftmd-legal-source-'))
  const packageRoot = join(root, '.build/package')
  try {
    mkdirSync(packageRoot, { recursive: true })
    writeFileSync(join(root, 'LICENSE'), 'license text\n')
    writeFileSync(join(root, 'NOTICE.md'), 'notice text\n')
    stageLegalNotices(root, packageRoot)
    expect(readFileSync(join(packageRoot, 'LICENSE'), 'utf8')).toBe('license text\n')
    expect(readFileSync(join(packageRoot, 'NOTICE.md'), 'utf8')).toBe('notice text\n')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
