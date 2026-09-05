import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { normalizeArchitectures, symlinks, verifyUniversal } from '../../../scripts/verify-universal.js'

it('verifies the explicitly selected artifact directory instead of a previous release', () => {
  const root = mkdtempSync(join(tmpdir(), 'draftmd-selected-artifacts-'))
  try {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.1.0-preview.5' }))
    const output = join(root, 'candidate')
    expect(() => verifyUniversal(root, output)).toThrow(`Missing Universal artifact: ${join(output, 'mac-universal/DraftMD.app')}`)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

it('normalizes Universal executable architecture output', () => {
  expect(normalizeArchitectures('x86_64 arm64\n').sort()).toEqual(['arm64', 'x64'])
})

it('detects symlinks in a clean packaged-runtime fixture', () => {
  const root = mkdtempSync(join(tmpdir(), 'draftmd-universal-links-'))
  try {
    writeFileSync(join(root, 'target'), 'target')
    expect(symlinks(root)).toEqual([])
    symlinkSync('target', join(root, 'link'))
    expect(symlinks(root)).toEqual([join(root, 'link')])
  } finally { rmSync(root, { recursive: true, force: true }) }
})
