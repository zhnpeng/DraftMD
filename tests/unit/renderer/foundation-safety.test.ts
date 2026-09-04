import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolveTestDocumentPath } from '../../helpers/electron-app'

describe('Electron E2E document path safety', () => {
  it.each(['/tmp/escape.md', '../escape.md', 'nested/escape.md', 'nested\\escape.md', '.', '..'])(
    'rejects documentName %s outside the test userData root',
    (name) => expect(() => resolveTestDocumentPath('/tmp/draftmd-root', name)).toThrow(),
  )
  it('resolves a plain filename inside test userData', () => {
    expect(resolveTestDocumentPath('/tmp/draftmd-root', 'foundation.md')).toBe('/tmp/draftmd-root/foundation.md')
  })
})

describe('renderer lifecycle source', () => {
  it('disposes the SearchPanel DOM and global key handler from bootstrap', () => {
    const search = readFileSync('src/renderer/editor/search-panel.ts', 'utf8')
    const bootstrap = readFileSync('src/renderer/app/bootstrap.ts', 'utf8')
    expect(search).toContain('dispose(): void')
    expect(search).toContain("document.removeEventListener('keydown'")
    expect(search).toContain('this.container.remove()')
    expect(bootstrap).toContain('searchPanel.dispose()')
  })
})
