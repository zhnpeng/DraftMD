import { mkdtemp, mkdir, realpath, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { createWorkspaceRoot, resolveMarkdownPath } from '../../../src/main/workspace/path-guard'

describe('workspace symlink boundary', () => {
  it('rejects existing and new paths that escape through a symlink', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'draftmd-workspace-'))
    const outside = await mkdtemp(join(tmpdir(), 'draftmd-outside-'))
    await writeFile(join(outside, 'secret.md'), '# Secret\n')
    await symlink(outside, join(workspace, 'linked'))
    const root = await createWorkspaceRoot(workspace)

    await expect(resolveMarkdownPath(root, 'linked/secret.md', 'existing')).rejects.toMatchObject({
      code: 'PATH_OUTSIDE_WORKSPACE',
    })
    await expect(resolveMarkdownPath(root, 'linked/new.md', 'new')).rejects.toMatchObject({
      code: 'PATH_OUTSIDE_WORKSPACE',
    })
  })

  it('allows an in-workspace symlink while retaining the logical display path', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'draftmd-workspace-'))
    await mkdir(join(workspace, 'actual'))
    await writeFile(join(workspace, 'actual', 'note.md'), '# Note\n')
    await symlink(join(workspace, 'actual'), join(workspace, 'linked'))
    const root = await createWorkspaceRoot(workspace)

    await expect(resolveMarkdownPath(root, 'linked/note.md', 'existing')).resolves.toEqual({
      absolutePath: await realpath(join(workspace, 'actual', 'note.md')),
      relativePath: 'linked/note.md',
    })
  })
})
