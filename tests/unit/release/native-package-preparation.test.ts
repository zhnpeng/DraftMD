import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  KEYRING_PACKAGES,
  findSymlinks,
  lockedPackage,
  nativeCopiesForTarget,
  nativeTarget,
  parseTargetArguments,
  runtimeClosure,
  runtimePackageRoots,
  stageLegalNotices,
  stagedPackageMetadata,
  verifyIntegrity,
} from '../../../scripts/prepare-native-packages.js'

const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'))

describe('Universal native package preparation', () => {
  it('pins both Darwin keyring architectures to lockfile URLs and integrity', () => {
    expect(KEYRING_PACKAGES).toEqual([
      '@napi-rs/keyring-darwin-arm64',
      '@napi-rs/keyring-darwin-x64',
      '@napi-rs/keyring-win32-x64-msvc',
    ])
    for (const name of KEYRING_PACKAGES) {
      const item = lockedPackage(lock, name)
      expect(item.version).toBe('2.0.0')
      expect(item.resolved).toMatch(/^https:\/\/registry\.npmjs\.org\//)
      expect(item.integrity).toMatch(/^sha512-/)
    }
  })

  it('selects the locked Windows x64 keyring binary without staging Darwin binaries', () => {
    const target = nativeTarget('win32', 'x64')
    expect(parseTargetArguments(['--platform', 'win32', '--arch=x64'])).toEqual(target)
    expect(nativeCopiesForTarget(target).map(([, destination]) => destination)).toEqual([
      'better-sqlite3/lib',
      'better-sqlite3/package.json',
      'better-sqlite3/prebuilds/win32-x64.node',
      '@napi-rs/keyring/index.js',
      '@napi-rs/keyring/package.json',
      '@napi-rs/keyring-win32-x64-msvc',
    ])
    expect(() => nativeTarget('win32', 'arm64')).toThrow(/unsupported native package target/i)
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
    mkdirSync(join(root, 'target'))
    symlinkSync(join(root, 'target'), join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir')
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

it('preserves repository metadata required by electron-updater in the staged package', () => {
  const staged = stagedPackageMetadata(JSON.parse(readFileSync('package.json', 'utf8')))
  expect(staged.repository).toEqual({
    type: 'git',
    url: 'https://github.com/zhnpeng/DraftMD.git',
  })
})
