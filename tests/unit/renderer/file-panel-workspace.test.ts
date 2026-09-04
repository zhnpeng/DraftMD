import { describe, expect, it, vi } from 'vitest'
import { createWorkspaceNavigation } from '../../../src/renderer/app/file-panel-controller'

describe('workspace file panel navigation', () => {
  it('starts at the workspace root and never navigates above it', async () => {
    const listWorkspaceFiles = vi.fn().mockResolvedValue([])
    const navigation = createWorkspaceNavigation({ listWorkspaceFiles })

    await navigation.refresh()
    await navigation.open({ name: 'docs', path: 'docs', kind: 'directory' })
    await navigation.open({ name: '..', path: '', kind: 'parent' })
    await navigation.open({ name: '..', path: '', kind: 'parent' })

    expect(listWorkspaceFiles.mock.calls).toEqual([[''], ['docs'], [''], ['']])
    expect(navigation.directory()).toBe('')
  })

  it('opens files through workspace-relative IPC after the unsaved guard passes', async () => {
    const openWorkspaceFile = vi.fn().mockResolvedValue(true)
    const navigation = createWorkspaceNavigation({
      listWorkspaceFiles: vi.fn().mockResolvedValue([]),
      openWorkspaceFile,
      beforeOpenFile: vi.fn().mockResolvedValue(true),
    })

    await expect(navigation.open({ name: 'spec.md', path: 'docs/spec.md', kind: 'file' })).resolves.toBe(true)
    expect(openWorkspaceFile).toHaveBeenCalledWith('docs/spec.md')
  })

  it('does not open a file when the unsaved guard rejects replacement', async () => {
    const openWorkspaceFile = vi.fn()
    const navigation = createWorkspaceNavigation({
      listWorkspaceFiles: vi.fn().mockResolvedValue([]),
      openWorkspaceFile,
      beforeOpenFile: vi.fn().mockResolvedValue(false),
    })

    await expect(navigation.open({ name: 'spec.md', path: 'spec.md', kind: 'file' })).resolves.toBe(false)
    expect(openWorkspaceFile).not.toHaveBeenCalled()
  })

  it('resets to root when another workspace opens', async () => {
    const listWorkspaceFiles = vi.fn().mockResolvedValue([])
    const navigation = createWorkspaceNavigation({ listWorkspaceFiles })
    await navigation.open({ name: 'docs', path: 'docs', kind: 'directory' })

    await navigation.workspaceOpened()

    expect(navigation.directory()).toBe('')
    expect(listWorkspaceFiles).toHaveBeenLastCalledWith('')
  })
})
