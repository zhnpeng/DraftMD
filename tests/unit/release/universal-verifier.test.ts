import { expect, it } from 'vitest'
import { architectures, symlinks } from '../../../scripts/verify-universal.js'

it('normalizes the current Universal executable architectures', () => {
  expect(architectures('release/mac-universal/DraftMD.app/Contents/MacOS/DraftMD').sort()).toEqual(['arm64', 'x64'])
})

it('finds no symlink in the current packaged runtime', () => {
  expect(symlinks('release/mac-universal/DraftMD.app/Contents/Resources/node_modules')).toEqual([])
})
