import { mkdtemp, mkdir, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { createWorkspaceManager } from '../../../src/main/workspace/workspace-manager'

function fakeWindow(id = 1) {
  return {
    id,
    isDestroyed: () => false,
    webContents: { isDestroyed: () => false, send: vi.fn() },
  } as never
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'draftmd-manager-'))
  await mkdir(join(root, 'docs'))
  await writeFile(join(root, 'README.md'), '# Readme\n')
  await writeFile(join(root, 'docs', 'spec.markdown'), '# Spec\n')
  await writeFile(join(root, 'private.txt'), 'ignore\n')
  return root
}

describe('WorkspaceManager', () => {
  it('returns an empty file list before a workspace is attached', async () => {
    const manager = createWorkspaceManager({
      chooseFolder: vi.fn(),
      recent: { add: vi.fn(), get: vi.fn(() => []), clear: vi.fn() },
    })

    await expect(manager.list(999)).resolves.toEqual([])
  })

  it('opens an explicitly chosen folder and publishes an opaque descriptor', async () => {
    const root = await fixture()
    const recent = { add: vi.fn(), get: vi.fn(() => []), clear: vi.fn() }
    const win = fakeWindow()
    const manager = createWorkspaceManager({
      chooseFolder: vi.fn().mockResolvedValue(root),
      recent,
    })

    await expect(manager.openFolder(win)).resolves.toMatchObject({ name: root.split('/').at(-1) })
    const current = manager.current(win.id)
    expect(current?.root.canonicalPath).toBe(await realpath(root))
    expect(current?.descriptor.id).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(current?.descriptor)).not.toContain(root)
    expect(recent.add).toHaveBeenCalledWith(await realpath(root))
    expect(win.webContents.send).toHaveBeenCalledWith('workspace:opened', current?.descriptor)
  })

  it('keeps the current workspace when folder selection is cancelled', async () => {
    const root = await fixture()
    const win = fakeWindow()
    const manager = createWorkspaceManager({
      chooseFolder: vi.fn().mockResolvedValueOnce(root).mockResolvedValueOnce(null),
      recent: { add: vi.fn(), get: vi.fn(() => []), clear: vi.fn() },
    })
    await manager.openFolder(win)
    const before = manager.current(win.id)

    await expect(manager.openFolder(win)).resolves.toBeNull()
    expect(manager.current(win.id)).toStrictEqual(before)
  })


  it('does not replace the current workspace when document preparation is denied', async () => {
    const first = await fixture()
    const second = await fixture()
    const win = fakeWindow()
    const prepare = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const manager = createWorkspaceManager({
      chooseFolder: vi.fn(), prepare,
      recent: { add: vi.fn(), get: vi.fn(() => []), clear: vi.fn() },
    })
    await manager.openFolder(win, first)
    const before = manager.current(win.id)

    await expect(manager.openFolder(win, second)).resolves.toBeNull()

    expect(manager.current(win.id)).toStrictEqual(before)
    expect(prepare).toHaveBeenLastCalledWith(win, await realpath(second))
    expect(win.webContents.send).toHaveBeenCalledTimes(1)
  })

  it('lists only workspace Markdown entries and never exposes a parent above root', async () => {
    const root = await fixture()
    const win = fakeWindow()
    const manager = createWorkspaceManager({
      chooseFolder: vi.fn().mockResolvedValue(root),
      recent: { add: vi.fn(), get: vi.fn(() => []), clear: vi.fn() },
    })
    await manager.openFolder(win)

    await expect(manager.list(win.id)).resolves.toEqual([
      { name: 'docs', path: 'docs', kind: 'directory' },
      { name: 'README.md', path: 'README.md', kind: 'file' },
    ])
    await expect(manager.list(win.id, 'docs')).resolves.toEqual([
      { name: '..', path: '', kind: 'parent' },
      { name: 'spec.markdown', path: 'docs/spec.markdown', kind: 'file' },
    ])
    await expect(manager.list(win.id, '..')).rejects.toMatchObject({ code: 'PATH_OUTSIDE_WORKSPACE' })
  })

  it('resolves only Markdown files inside the attached workspace', async () => {
    const root = await fixture()
    const win = fakeWindow()
    const manager = createWorkspaceManager({
      chooseFolder: vi.fn().mockResolvedValue(root),
      recent: { add: vi.fn(), get: vi.fn(() => []), clear: vi.fn() },
    })
    await manager.openFolder(win)

    await expect(manager.resolveFile(win.id, 'docs/spec.markdown')).resolves.toBe(await realpath(join(root, 'docs/spec.markdown')))
    await expect(manager.resolveFile(win.id, '../outside.md')).rejects.toMatchObject({ code: 'PATH_OUTSIDE_WORKSPACE' })
  })

  it('closes the workspace watcher and forgets state', async () => {
    const root = await fixture()
    const close = vi.fn()
    const watcher = { close, on: vi.fn().mockReturnThis() }
    const win = fakeWindow()
    const manager = createWorkspaceManager({
      chooseFolder: vi.fn().mockResolvedValue(root),
      recent: { add: vi.fn(), get: vi.fn(() => []), clear: vi.fn() },
      watch: vi.fn(() => watcher as never),
    })
    await manager.openFolder(win)

    manager.close(win.id)

    expect(close).toHaveBeenCalledOnce()
    expect(manager.current(win.id)).toBeNull()
  })
})
