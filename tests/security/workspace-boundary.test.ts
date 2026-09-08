import { link, mkdir, mkdtemp, rename, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { createWorkspaceRoot, resolveMarkdownPath } from '../../src/main/workspace/path-guard'

async function workspace() {
  const rootPath = await mkdtemp(join(tmpdir(), 'draftmd-security-root-'))
  return { rootPath, root: await createWorkspaceRoot(rootPath) }
}

describe('adversarial Markdown workspace boundaries', () => {
  it.each([
    '/tmp/escape.md', '../escape.md', 'a/../../escape.md', '..\\escape.md',
    '%2e%2e/escape.md', '%2E%2E/escape.md', '%2e%2e%2fescape.md',
    'safe/%2f..%2fescape.md', 'safe\\..\\escape.md', 'a.md\0.png',
  ])('rejects traversal corpus entry %j', async (path) => {
    const { root } = await workspace()
    await expect(resolveMarkdownPath(root, path, 'new')).rejects.toMatchObject({ code: 'PATH_OUTSIDE_WORKSPACE' })
  })

  it.each(['note.md.exe', 'note.md ', 'note.md.', 'note.MD.png', '.markdown', 'note%2emd.exe'])
  ('rejects extension masquerade %j', async (path) => {
    const { root } = await workspace()
    await expect(resolveMarkdownPath(root, path, 'new')).rejects.toMatchObject({ code: 'UNSUPPORTED_FILE_TYPE' })
  })

  it('normalizes Unicode names to NFC and accepts case-variant Markdown extensions', async () => {
    const { root } = await workspace()
    await expect(resolveMarkdownPath(root, 'café.MD', 'new')).resolves.toMatchObject({ relativePath: 'café.MD' })
  })

  it('rejects direct, chained, and nested-parent symlink escapes', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'draftmd-security-outside-'))
    await writeFile(join(outside, 'secret.md'), 'SECRET')
    const { rootPath, root } = await workspace()
    await symlink(join(outside, 'secret.md'), join(rootPath, 'direct.md'))
    await symlink('direct.md', join(rootPath, 'chain.md'))
    await symlink(outside, join(rootPath, 'linked-parent'))
    for (const path of ['direct.md', 'chain.md', 'linked-parent/secret.md']) {
      await expect(resolveMarkdownPath(root, path, 'existing')).rejects.toMatchObject({ code: 'PATH_OUTSIDE_WORKSPACE' })
    }
  })

  it('rejects an external final symlink when resolving a new destination', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'draftmd-security-outside-'))
    const { rootPath, root } = await workspace()
    await symlink(join(outside, 'missing.md'), join(rootPath, 'linked.md'))

    await expect(resolveMarkdownPath(root, 'linked.md', 'new')).rejects.toMatchObject({
      code: 'PATH_OUTSIDE_WORKSPACE',
    })
  })

  it('rejects an in-workspace hard link to content outside the workspace', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'draftmd-security-hardlink-'))
    const secret = join(outside, 'secret.md')
    await writeFile(secret, 'SECRET')
    const { rootPath, root } = await workspace()
    await link(secret, join(rootPath, 'linked.md'))
    await expect(resolveMarkdownPath(root, 'linked.md', 'existing')).rejects.toMatchObject({ code: 'PATH_OUTSIDE_WORKSPACE' })
  })

  it('invalidates a WorkspaceRoot when its directory is replaced', async () => {
    const { rootPath, root } = await workspace()
    await writeFile(join(rootPath, 'original.md'), '# Original\n')
    const moved = `${rootPath}-moved`
    await rename(rootPath, moved)
    await mkdir(rootPath)
    await writeFile(join(rootPath, 'replacement.md'), '# Replacement\n')
    await expect(resolveMarkdownPath(root, 'replacement.md', 'existing')).rejects.toMatchObject({ code: 'PATH_OUTSIDE_WORKSPACE' })
  })
})
