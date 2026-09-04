import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { normalizeArchitectures, symlinks } from '../../../scripts/verify-universal.js'

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
