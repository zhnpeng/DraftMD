import { expect, it } from 'vitest'
import { selectionChipLabel } from '../../../src/renderer/agent/selection-chip'
import type { SelectionReference } from '../../../src/shared/contracts/agent'

const reference: SelectionReference = {
  workspaceId: 'a'.repeat(64), path: '/Users/example/workspace/docs/spec.md',
  headingPath: ['Product', 'Errors'], selectedText: '  Handle\n   timeout   safely  ',
  beforeAnchor: '', afterAnchor: '', sourceMode: false, version: 'b'.repeat(64),
}

it('formats a selection chip without exposing an absolute path', () => {
  expect(selectionChipLabel(reference)).toBe('spec.md · Product / Errors · “Handle timeout safely”')
})

it('omits an empty heading path and truncates the quote by code points', () => {
  expect(selectionChipLabel({ ...reference, headingPath: [], selectedText: '界'.repeat(70) })).toBe(
    `spec.md · “${'界'.repeat(57)}…”`,
  )
})

import { selectionErrorMessageKey } from '../../../src/renderer/agent/selection-chip'

it('maps only known selection failures to localized messages', () => {
  expect(selectionErrorMessageKey(Object.assign(new Error('SELECTION_STALE'), { code: 'SELECTION_STALE' }))).toBe('dock.selectionChanged')
  expect(selectionErrorMessageKey(new Error("Error invoking remote method 'agent-start': Error: SELECTION_NOT_FOUND"))).toBe('dock.selectionChanged')
  expect(selectionErrorMessageKey(Object.assign(new Error('large'), { code: 'SELECTION_TOO_LARGE' }))).toBe('dock.selectionTooLarge')
  expect(selectionErrorMessageKey(new Error('secret provider response'))).toBeNull()
})
