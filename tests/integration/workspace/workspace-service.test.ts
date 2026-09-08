import { chmod, link, mkdtemp, mkdir, readFile, readdir, stat, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { createWorkspaceRoot } from '../../../src/main/workspace/path-guard'
import {
  createWorkspaceService,
  type WorkspaceServiceDependencies,
} from '../../../src/main/workspace/workspace-service'

async function setupWorkspace(files: Record<string, string> = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'draftmd-service-'))
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = join(directory, ...relativePath.split('/'))
    await mkdir(join(absolutePath, '..'), { recursive: true })
    await writeFile(absolutePath, content)
  }
  return {
    directory,
    service: createWorkspaceService(await createWorkspaceRoot(directory)),
  }
}

describe('versioned Markdown CRUD', () => {
  it('creates a Markdown file without overwriting an existing file', async () => {
    const { directory, service } = await setupWorkspace({ 'existing.md': '# Existing\n' })

    const created = await service.create('notes/new.md', '# New\n')
    expect(await readFile(join(directory, 'notes/new.md'), 'utf8')).toBe('# New\n')
    expect(created).toEqual({
      path: 'notes/new.md',
      version: 'f676b43bd55f91451babc1663739064abb7e11e2b5f4a7efe62c29e4eeb0d117',
    })
    await expect(service.create('existing.md', '# Replacement\n')).rejects.toMatchObject({
      code: 'FILE_ALREADY_EXISTS',
    })
    expect(await readFile(join(directory, 'existing.md'), 'utf8')).toBe('# Existing\n')
  })

  it('reads UTF-8 content with a SHA-256 version', async () => {
    const { service } = await setupWorkspace({ 'spec.md': '# Old\n' })

    await expect(service.read('spec.md')).resolves.toEqual({
      path: 'spec.md',
      content: '# Old\n',
      version: 'ccd2955cfc4a825d2f7a5462af7450e9ffa3206a551ce903071776fa6bb78590',
    })
  })

  it('applies an exact single text edit and returns the new version', async () => {
    const { directory, service } = await setupWorkspace({ 'spec.md': '# Old\nBody\n' })
    const before = await service.read('spec.md')

    const result = await service.edit('spec.md', {
      oldText: '# Old',
      newText: '# New',
      expectedOccurrences: 1,
    }, before.version)

    expect(await readFile(join(directory, 'spec.md'), 'utf8')).toBe('# New\nBody\n')
    expect(result.path).toBe('spec.md')
    expect(result.version).not.toBe(before.version)
  })

  it('rejects stale edits without changing disk content', async () => {
    const { directory, service } = await setupWorkspace({ 'spec.md': '# Old\n' })
    const before = await service.read('spec.md')
    await writeFile(join(directory, 'spec.md'), '# External\n')

    await expect(service.edit('spec.md', {
      oldText: '# Old',
      newText: '# New',
      expectedOccurrences: 1,
    }, before.version)).rejects.toMatchObject({ code: 'VERSION_CONFLICT' })
    expect(await readFile(join(directory, 'spec.md'), 'utf8')).toBe('# External\n')
  })

  it.each([
    ['missing target', '# Current\n', '# Missing', 'EDIT_TARGET_NOT_FOUND'],
    ['ambiguous target', 'same\nsame\n', 'same', 'EDIT_TARGET_AMBIGUOUS'],
  ])('rejects a %s', async (_label, content, oldText, code) => {
    const { directory, service } = await setupWorkspace({ 'spec.md': content })
    const before = await service.read('spec.md')

    await expect(service.edit('spec.md', {
      oldText,
      newText: 'replacement',
      expectedOccurrences: 1,
    }, before.version)).rejects.toMatchObject({ code })
    expect(await readFile(join(directory, 'spec.md'), 'utf8')).toBe(content)
  })

  it('renames only the expected version and never overwrites a destination', async () => {
    const { directory, service } = await setupWorkspace({
      'old.md': '# Old\n',
      'occupied.md': '# Occupied\n',
    })
    const before = await service.read('old.md')

    await expect(service.rename('old.md', 'occupied.md', before.version)).rejects.toMatchObject({
      code: 'FILE_ALREADY_EXISTS',
    })
    await expect(service.rename('old.md', 'new.md', 'stale')).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
    })
    await expect(service.rename('old.md', 'new.md', before.version)).resolves.toEqual({
      from: 'old.md',
      to: 'new.md',
      version: before.version,
    })
    expect(await readFile(join(directory, 'new.md'), 'utf8')).toBe('# Old\n')
  })

  it('permits a case-only rename without treating the source as an occupied destination', async () => {
    const { directory, service } = await setupWorkspace({ 'Readme.md': '# Readme\n' })
    const before = await service.read('Readme.md')

    await expect(service.rename('Readme.md', 'README.md', before.version)).resolves.toEqual({
      from: 'Readme.md',
      to: 'README.md',
      version: before.version,
    })
    expect(await readFile(join(directory, 'README.md'), 'utf8')).toBe('# Readme\n')
  })

  it.runIf(process.platform === 'win32')('updates the physical spelling for a Windows case-only rename', async () => {
    const { directory, service } = await setupWorkspace({ 'Readme.md': '# Readme\n' })
    const before = await service.read('Readme.md')

    await service.rename('Readme.md', 'README.md', before.version)

    expect(await readdir(directory)).toContain('README.md')
    expect(await readdir(directory)).not.toContain('Readme.md')
  })

  it.runIf(process.platform !== 'win32')('does not treat a symlink to the source as a case-only rename destination', async () => {
    const { directory, service } = await setupWorkspace({ 'source.md': '# Source\n' })
    await symlink('source.md', join(directory, 'alias.md'))
    const before = await service.read('source.md')

    await expect(service.rename('source.md', 'alias.md', before.version)).rejects.toMatchObject({
      code: 'FILE_ALREADY_EXISTS',
    })
    expect(await readFile(join(directory, 'source.md'), 'utf8')).toBe('# Source\n')
  })

  it.runIf(process.platform === 'win32')('rejects a hard-linked source before a case-only rename can overwrite it', async () => {
    const { directory, service } = await setupWorkspace({ 'Readme.md': '# Readme\n' })
    await link(join(directory, 'Readme.md'), join(directory, 'alias.md'))

    await expect(service.rename('Readme.md', 'README.md', 'any-version')).rejects.toMatchObject({
      code: 'PATH_OUTSIDE_WORKSPACE',
    })
    expect(await readFile(join(directory, 'Readme.md'), 'utf8')).toBe('# Readme\n')
    expect(await readFile(join(directory, 'alias.md'), 'utf8')).toBe('# Readme\n')
  })

  it('deletes only the expected version', async () => {
    const { directory, service } = await setupWorkspace({ 'old.md': '# Old\n' })
    const before = await service.read('old.md')

    await expect(service.delete('old.md', 'stale')).rejects.toMatchObject({ code: 'VERSION_CONFLICT' })
    await expect(service.delete('old.md', before.version)).resolves.toEqual({
      path: 'old.md',
      version: before.version,
    })
    await expect(stat(join(directory, 'old.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('inherits the destination mode and leaves no temp artifact after an atomic replacement', async () => {
    const { directory, service } = await setupWorkspace({ 'spec.md': '# Old\n' })
    if (process.platform !== 'win32') await chmod(join(directory, 'spec.md'), 0o640)
    const before = await service.read('spec.md')

    await service.edit('spec.md', {
      oldText: '# Old',
      newText: '# New',
      expectedOccurrences: 1,
    }, before.version)

    if (process.platform !== 'win32') expect((await stat(join(directory, 'spec.md'))).mode & 0o777).toBe(0o640)
    expect((await readdir(directory)).filter((name) => name.includes('draftmd-tmp'))).toEqual([])
  })

  it('cleans its temp artifact when the atomic rename fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'draftmd-service-'))
    await writeFile(join(directory, 'spec.md'), '# Old\n')
    const dependencies: WorkspaceServiceDependencies = {
      rename: async () => { throw new Error('rename failed') },
    }
    const service = createWorkspaceService(await createWorkspaceRoot(directory), dependencies)
    const before = await service.read('spec.md')

    await expect(service.edit('spec.md', {
      oldText: '# Old',
      newText: '# New',
      expectedOccurrences: 1,
    }, before.version)).rejects.toThrow('rename failed')
    expect(await readFile(join(directory, 'spec.md'), 'utf8')).toBe('# Old\n')
    expect((await readdir(directory)).filter((name) => name.includes('draftmd-tmp'))).toEqual([])
  })
})

describe('bounded Markdown listing and search', () => {
  it('lists visible Markdown recursively while skipping hidden and dependency directories', async () => {
    const { service } = await setupWorkspace({
      'README.md': '# Root\n',
      'docs/spec.markdown': '# Spec\n',
      'docs/note.txt': 'ignore',
      '.hidden/private.md': 'ignore',
      '.git/config.md': 'ignore',
      'node_modules/pkg/readme.md': 'ignore',
      '.draftmd-tmp.md': 'ignore',
    })

    const files = await service.list()

    expect(files.map((file) => file.path)).toEqual(['README.md', 'docs/spec.markdown'])
    expect(files.every((file) => file.size > 0 && Number.isFinite(file.mtimeMs))).toBe(true)
    expect(files.every((file) => !('content' in file) && !('version' in file))).toBe(true)
  })

  it('caps listing at 1,000 files in deterministic path order', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'draftmd-service-'))
    await mkdir(join(directory, 'docs'))
    await Promise.all(Array.from({ length: 1_005 }, (_, index) =>
      writeFile(join(directory, 'docs', `${String(index).padStart(4, '0')}.md`), `# ${index}\n`)))
    const service = createWorkspaceService(await createWorkspaceRoot(directory))

    const files = await service.list()

    expect(files).toHaveLength(1_000)
    expect(files[0]?.path).toBe('docs/0000.md')
    expect(files[999]?.path).toBe('docs/0999.md')
  })

  it('returns lexical matches with heading paths and two surrounding lines', async () => {
    const { service } = await setupWorkspace({
      'spec.md': [
        '# Product',
        'Intro',
        '## Offline Mode',
        'Before',
        'The app supports offline mode.',
        'After',
        'End',
      ].join('\n'),
      'other.md': '# Other\nNo match\n',
    })

    await expect(service.search('offline mode')).resolves.toEqual([{
      path: 'spec.md',
      line: 3,
      headingPath: ['Product', 'Offline Mode'],
      context: ['# Product', 'Intro', '## Offline Mode', 'Before', 'The app supports offline mode.'],
    }, {
      path: 'spec.md',
      line: 5,
      headingPath: ['Product', 'Offline Mode'],
      context: ['## Offline Mode', 'Before', 'The app supports offline mode.', 'After', 'End'],
    }])
  })

  it('limits search results and honors cancellation', async () => {
    const { service } = await setupWorkspace({
      'matches.md': Array.from({ length: 80 }, (_, index) => `match ${index}`).join('\n'),
    })

    expect(await service.search('match')).toHaveLength(50)
    expect(await service.search('match', 3)).toHaveLength(3)

    const controller = new AbortController()
    controller.abort()
    await expect(service.search('match', 50, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
  })
})
