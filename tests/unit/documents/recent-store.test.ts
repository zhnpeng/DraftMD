import { describe, expect, it } from 'vitest'
import { addRecentFile, parseRecentStore } from '../../../src/main/documents/recent-store'

describe('recent file store', () => {
  it('keeps at most ten recent files with the newest first', () => {
    let store = parseRecentStore('{}')
    for (let index = 0; index < 12; index += 1) {
      store = addRecentFile(store, `/work/${index}.md`)
    }

    expect(store.recent).toHaveLength(10)
    expect(store.recent[0]).toBe('/work/11.md')
    expect(store.recent.at(-1)).toBe('/work/2.md')
  })

  it('deduplicates a file while moving it to the front', () => {
    const store = parseRecentStore(JSON.stringify({
      recent: ['/work/a.md', '/work/b.md', '/work/c.md'],
      restoreOnLaunch: false,
    }))

    expect(addRecentFile(store, '/work/b.md')).toEqual({
      recent: ['/work/b.md', '/work/a.md', '/work/c.md'],
      restoreOnLaunch: false,
    })
  })

  it('ignores malformed JSON', () => {
    expect(parseRecentStore('{not json')).toEqual({ recent: [], restoreOnLaunch: true })
  })

  it('ignores malformed fields while preserving valid preferences', () => {
    expect(parseRecentStore(JSON.stringify({ recent: [1, '/work/a.md', null], restoreOnLaunch: false }))).toEqual({
      recent: ['/work/a.md'],
      restoreOnLaunch: false,
    })
  })
})

  it('persists the first mutation synchronously when the parent directory is absent', async () => {
    const { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { createRecentStore } = await import('../../../src/main/documents/recent-store')
    const root = mkdtempSync(join(tmpdir(), 'draftmd-recent-'))
    const storePath = join(root, 'missing', 'recent.json')
    try {
      const store = createRecentStore({ path: storePath, readFileSync, writeFileSync, mkdirSync })
      store.add('/work/first.md')

      expect(JSON.parse(readFileSync(storePath, 'utf8'))).toEqual({
        recent: ['/work/first.md'], restoreOnLaunch: true,
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

it('keeps DraftMD recents isolated in userData and ignores legacy ColaMD state', async () => {
  const { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { createRecentStore, draftMDRecentStorePath } = await import('../../../src/main/documents/recent-store')
  const root = mkdtempSync(join(tmpdir(), 'draftmd-isolation-'))
  const legacy = join(root, '.colamd', 'recent.json')
  const userDataA = join(root, 'DraftMD-A')
  const userDataB = join(root, 'DraftMD-B')
  try {
    mkdirSync(join(root, '.colamd'), { recursive: true })
    writeFileSync(legacy, JSON.stringify({ recent: ['/cola.md'], restoreOnLaunch: false }))
    const pathA = draftMDRecentStorePath(userDataA)
    const pathB = draftMDRecentStorePath(userDataB)
    const a = createRecentStore({ path: pathA, readFileSync, writeFileSync, mkdirSync })
    const b = createRecentStore({ path: pathB, readFileSync, writeFileSync, mkdirSync })

    expect(a.get()).toEqual({ recent: [], restoreOnLaunch: true })
    expect(b.get()).toEqual({ recent: [], restoreOnLaunch: true })
    a.add('/draft-a.md')

    expect(JSON.parse(readFileSync(pathA, 'utf8')).recent).toEqual(['/draft-a.md'])
    expect(b.get().recent).toEqual([])
    expect(JSON.parse(readFileSync(legacy, 'utf8')).recent).toEqual(['/cola.md'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
