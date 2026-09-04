import { describe, expect, it, vi } from 'vitest'
import {
  addRecentWorkspace,
  createRecentWorkspaces,
  parseRecentWorkspaces,
} from '../../../src/main/workspace/recent-workspaces'

describe('recent workspaces', () => {
  it('deduplicates folders, keeps newest first, and caps the list at ten', () => {
    let recent: string[] = []
    for (let index = 0; index < 12; index += 1) {
      recent = addRecentWorkspace(recent, `/work/${index}`)
    }
    recent = addRecentWorkspace(recent, '/work/5')

    expect(recent).toHaveLength(10)
    expect(recent[0]).toBe('/work/5')
    expect(new Set(recent).size).toBe(10)
  })

  it('fails closed for malformed persisted data', () => {
    expect(parseRecentWorkspaces('{bad json')).toEqual([])
    expect(parseRecentWorkspaces(JSON.stringify({ recent: ['/work/a', 4, null] }))).toEqual(['/work/a'])
    expect(parseRecentWorkspaces(JSON.stringify({ recent: [], secret: 'nope' }))).toEqual([])
  })

  it('prunes stale and non-directory paths before returning them', () => {
    const write = vi.fn()
    const store = createRecentWorkspaces({
      path: '/state/recent-workspaces.json',
      readFileSync: () => JSON.stringify({ recent: ['/work/file.md', '/work/kept', '/work/missing'] }),
      writeFileSync: write,
      mkdirSync: vi.fn(),
      statSync: (path) => ({ isDirectory: () => path === '/work/kept' }),
    })

    expect(store.get()).toEqual(['/work/kept'])
    expect(write).toHaveBeenCalledWith(
      '/state/recent-workspaces.json',
      JSON.stringify({ recent: ['/work/kept'] }, null, 2),
      'utf8',
    )
  })

  it('persists mutations but never defines an implicit startup workspace', () => {
    const write = vi.fn()
    const store = createRecentWorkspaces({
      path: '/state/recent-workspaces.json',
      readFileSync: () => { throw new Error('missing') },
      writeFileSync: write,
      mkdirSync: vi.fn(),
      statSync: () => ({ isDirectory: () => true }),
    })

    store.add('/work/project')

    expect(store.get()).toEqual(['/work/project'])
    expect(write).toHaveBeenCalledOnce()
    expect('restoreOnLaunch' in store).toBe(false)
  })
})
