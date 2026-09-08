import { mkdtemp, mkdir, realpath, writeFile } from 'node:fs/promises'
import { join, win32 } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  createWorkspaceRoot,
  isWithinWorkspaceRoot,
  normalizeRelativeMarkdownPath,
  normalizeWorkspaceDirectory,
  resolveMarkdownPath,
} from '../../../src/main/workspace/path-guard'
import { workspaceId } from '../../../src/main/workspace/workspace-id'
import { WorkspaceDescriptorSchema } from '../../../src/shared/contracts/workspace'

async function makeWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'draftmd-path-guard-'))
}

describe('Markdown workspace path guard', () => {
  it.each([
    '../secret.md',
    '/tmp/secret.md',
    'a/../../secret.md',
    './note.md',
    'notes//note.md',
    'C:/Users/example/secret.md',
    'C:relative.md',
    'note.md\0.txt',
  ])('rejects non-normalized or escaping path %s', async (relativePath) => {
    const directory = await makeWorkspace()
    const root = await createWorkspaceRoot(directory)

    await expect(resolveMarkdownPath(root, relativePath, 'new')).rejects.toMatchObject({
      code: 'PATH_OUTSIDE_WORKSPACE',
    })
  })

  it.each(['a.txt', 'a.md.exe', '.md', 'notes/.markdown'])('rejects unsupported extension %s', async (relativePath) => {
    const directory = await makeWorkspace()
    const root = await createWorkspaceRoot(directory)

    await expect(resolveMarkdownPath(root, relativePath, 'new')).rejects.toMatchObject({
      code: 'UNSUPPORTED_FILE_TYPE',
    })
  })

  it.each([
    'note.md:metadata',
    'con.md',
    'AUX.markdown',
    'COM1.md',
    'COM\u00b9.md',
    'COM\u00b2.md',
    'COM\u00b3.md',
    'LPT\u00b9.md',
    'LPT\u00b2.md',
    'LPT\u00b3.md',
    'LPT9.markdown',
    'clock$.md',
    'note?.md',
  ])('rejects Windows path aliases and reserved names %s', (relativePath) => {
    expect(() => normalizeRelativeMarkdownPath(relativePath, true)).toThrow('UNSUPPORTED_FILE_TYPE')
  })

  it('rejects Windows-incompatible directory aliases before listing', () => {
    for (const directory of ['docs:stream', 'docs ', 'docs.', 'PRN', 'docs/COM1']) {
      expect(() => normalizeWorkspaceDirectory(directory, true)).toThrow('PATH_OUTSIDE_WORKSPACE')
    }
  })

  it('retains valid macOS filename characters outside the Windows compatibility mode', () => {
    expect(normalizeRelativeMarkdownPath('notes:2026?.md', false)).toBe('notes:2026?.md')
    expect(normalizeWorkspaceDirectory('aux', false)).toBe('aux')
  })

  it('resolves an existing Markdown file and preserves its logical relative path', async () => {
    const directory = await makeWorkspace()
    await mkdir(join(directory, 'notes'))
    await writeFile(join(directory, 'notes', 'spec.md'), '# Spec\n')
    const root = await createWorkspaceRoot(directory)

    await expect(resolveMarkdownPath(root, 'notes/spec.md', 'existing')).resolves.toEqual({
      absolutePath: await realpath(join(directory, 'notes', 'spec.md')),
      relativePath: 'notes/spec.md',
    })
  })

  it('resolves a new nested Markdown path through its nearest existing parent', async () => {
    const directory = await makeWorkspace()
    await mkdir(join(directory, 'drafts'))
    const root = await createWorkspaceRoot(directory)

    await expect(resolveMarkdownPath(root, 'drafts/next/spec.markdown', 'new')).resolves.toEqual({
      absolutePath: join(await realpath(directory), 'drafts', 'next', 'spec.markdown'),
      relativePath: 'drafts/next/spec.markdown',
    })
  })

  it('keeps the requested destination casing for a case-only rename', async () => {
    const directory = await makeWorkspace()
    await writeFile(join(directory, 'Readme.md'), '# Readme\n')
    const root = await createWorkspaceRoot(directory)

    await expect(resolveMarkdownPath(root, 'README.md', 'new')).resolves.toEqual({
      absolutePath: join(await realpath(directory), 'README.md'),
      relativePath: 'README.md',
    })
  })

  it('uses Windows case-insensitive containment semantics when running against win32 paths', () => {
    expect(isWithinWorkspaceRoot('C:\\DraftMD\\Notes', 'c:\\draftmd\\notes\\spec.md', win32)).toBe(true)
    expect(isWithinWorkspaceRoot('C:\\DraftMD\\Notes', 'C:\\DraftMD\\Notes-archive\\spec.md', win32)).toBe(false)
    expect(isWithinWorkspaceRoot('C:\\DraftMD\\Notes', 'D:\\DraftMD\\Notes\\spec.md', win32)).toBe(false)
  })

  it('normalizes logical paths to NFC without changing the resolved target', async () => {
    const directory = await makeWorkspace()
    const root = await createWorkspaceRoot(directory)
    const decomposed = 'cafe\u0301.md'

    await expect(resolveMarkdownPath(root, decomposed, 'new')).resolves.toEqual({
      absolutePath: join(await realpath(directory), 'caf\u00e9.md'),
      relativePath: 'caf\u00e9.md',
    })
  })

  it('accepts Markdown extensions case-insensitively', async () => {
    const directory = await makeWorkspace()
    const root = await createWorkspaceRoot(directory)

    await expect(resolveMarkdownPath(root, 'README.MD', 'new')).resolves.toMatchObject({
      relativePath: 'README.MD',
    })
  })

  it('rejects a missing path in existing mode with a stable error code', async () => {
    const directory = await makeWorkspace()
    const root = await createWorkspaceRoot(directory)

    await expect(resolveMarkdownPath(root, 'missing.md', 'existing')).rejects.toMatchObject({
      code: 'PATH_NOT_FOUND',
    })
  })
})

describe('workspace identity', () => {
  it('derives a stable namespaced SHA-256 identifier without exposing the root', () => {
    const id = workspaceId('/Users/example/Documents', false)

    expect(id).toBe('78bbdeec8e528da3d2ec7bea8f31b442b3368131871f10450b59af2748d9596f')
    expect(id).not.toContain('/Users/example')
  })

  it('uses a case-insensitive identity for Windows roots', () => {
    expect(workspaceId('C:\\Users\\Ada\\DraftMD', true)).toBe(workspaceId('c:\\users\\ada\\draftmd', true))
    expect(workspaceId('C:\\Users\\Ada\\DraftMD', true)).not.toBe(workspaceId('C:\\Users\\Ada\\DraftMD', false))
  })
})


describe('workspace descriptor contract', () => {
  it('accepts only an opaque id and display name', () => {
    expect(WorkspaceDescriptorSchema.parse({
      id: '78bbdeec8e528da3d2ec7bea8f31b442b3368131871f10450b59af2748d9596f',
      name: 'Documents',
    })).toEqual({
      id: '78bbdeec8e528da3d2ec7bea8f31b442b3368131871f10450b59af2748d9596f',
      name: 'Documents',
    })
    expect(() => WorkspaceDescriptorSchema.parse({
      id: '78bbdeec8e528da3d2ec7bea8f31b442b3368131871f10450b59af2748d9596f',
      name: 'Documents',
      root: '/Users/example/Documents',
    })).toThrow()
  })
})
