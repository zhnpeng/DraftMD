import { createHash } from 'node:crypto'
import { access, chmod, lstat, mkdtemp, readFile, readdir, realpath, rename, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createDocumentService, DocumentVersionMismatchError, type DocumentService } from '../../../src/main/documents/document-service'

const roots: string[] = []

async function tempFile(bytes: Buffer): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'draftmd-document-'))
  roots.push(root)
  const path = join(root, 'spec.md')
  await writeFile(path, bytes)
  return path
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('DocumentService', () => {
  it('hashes the actual source bytes while resolving display image URLs', async () => {
    const bytes = Buffer.from('![x](./img/a.png)\n', 'utf8')
    const path = await tempFile(bytes)
    const concrete = createDocumentService({ readFile, writeFile })
    const service: DocumentService = concrete

    const loaded = await service.load(path)
    const snapshot = await concrete.loadSnapshot(path)

    expect(loaded).toEqual({
      content: expect.stringContaining('file://'),
      version: createHash('sha256').update(bytes).digest('hex'),
    })
    expect(snapshot.sourceContent).toBe('![x](./img/a.png)\n')
    expect(snapshot.content).toBe(loaded.content)
    expect(snapshot.version).toBe(loaded.version)
  })

  it('restores source image paths and returns the written-byte version', async () => {
    const path = await tempFile(Buffer.from('# Before\n'))
    const service = createDocumentService({ readFile, writeFile })
    const shown = `![x](file://${join(path, '../img/a.png')})`

    const saved = await service.save({ path, content: shown })
    const bytes = await readFile(path)

    expect(bytes.toString('utf8')).toBe('![x](./img/a.png)')
    expect(saved).toEqual({ path, version: createHash('sha256').update(bytes).digest('hex') })
  })

  it('hashes the actual bytes present on disk after saving', async () => {
    const disk = new Map<string, Buffer>([['/work/spec.md', Buffer.from('# Before')]])
    const service = createDocumentService({
      readFile: async (path) => Buffer.from(disk.get(path)!),
      writeFile: async (path, data) => {
        const requested = Buffer.from(data)
        disk.set(path, Buffer.concat([requested, Buffer.from('\n')]))
      },
      stat: async () => ({ mode: 0o100600 }) as never,
      chmod: async () => {},
      rename: async (from, to) => { disk.set(to, disk.get(from)!); disk.delete(from) },
      unlink: async (path) => { disk.delete(path) },
      temporaryPath: () => '/work/.spec.tmp',
    })

    const saved = await service.save({ path: '/work/spec.md', content: '# After' })
    const actualBytes = disk.get('/work/spec.md')!

    expect(saved.version).toBe(createHash('sha256').update(actualBytes).digest('hex'))
  })

  it('rejects an existing-file save when the expected version does not match', async () => {
    const path = await tempFile(Buffer.from('# Current\n'))
    const service = createDocumentService({ readFile, writeFile })

    await expect(service.save({ path, content: '# Replacement', expectedVersion: 'stale' }))
      .rejects.toBeInstanceOf(DocumentVersionMismatchError)
    expect(await readFile(path, 'utf8')).toBe('# Current\n')
  })
})


it('rejects an external edit injected after the temporary write and removes the temp file', async () => {
  const original = Buffer.from('# Original\n')
  const path = await tempFile(original)
  const expectedVersion = createHash('sha256').update(original).digest('hex')
  const temporaryPaths: string[] = []
  const service = createDocumentService({
    readFile,
    stat,
    rename,
    unlink,
    writeFile: async (writePath, data, options) => {
      await writeFile(writePath, data, options)
      if (writePath !== path) {
        temporaryPaths.push(writePath)
        await writeFile(path, '# External\n', 'utf8')
      }
    },
  })

  await expect(service.save({ path, content: '# Mine\n', expectedVersion }))
    .rejects.toBeInstanceOf(DocumentVersionMismatchError)
  expect(await readFile(path, 'utf8')).toBe('# External\n')
  expect(temporaryPaths).toHaveLength(1)
  await expect(access(temporaryPaths[0])).rejects.toThrow()
  expect((await readdir(join(path, '..'))).filter((name) => name !== 'spec.md')).toEqual([])
})

it('atomically renames a same-directory temp over the destination and preserves its mode', async () => {
  const path = await tempFile(Buffer.from('# Before\n'))
  await chmod(path, 0o640)
  const renames: Array<[string, string]> = []
  const service = createDocumentService({
    readFile,
    writeFile,
    stat,
    unlink,
    rename: async (from, to) => {
      renames.push([from, to])
      await rename(from, to)
    },
  })

  const saved = await service.save({ path, content: '# After\n' })

  expect(await readFile(path, 'utf8')).toBe('# After\n')
  expect((await stat(path)).mode & 0o777).toBe(0o640)
  expect(renames).toHaveLength(1)
  expect(dirname(renames[0][0])).toBe(dirname(path))
  expect(renames[0][1]).toBe(path)
  expect(saved.version).toBe(createHash('sha256').update('# After\n').digest('hex'))
})

it('preserves destination mode bits that the process umask would otherwise remove', async () => {
  const path = await tempFile(Buffer.from('# Before\n'))
  await chmod(path, 0o666)
  const service = createDocumentService({ readFile, writeFile, rename, unlink, stat, chmod })

  await service.save({ path, content: '# After\n' })

  expect((await stat(path)).mode & 0o777).toBe(0o666)
})

it('creates a new destination with mode 0600', async () => {
  const root = await mkdtemp(join(tmpdir(), 'draftmd-document-'))
  roots.push(root)
  const path = join(root, 'new.md')
  const service = createDocumentService({ readFile, writeFile, rename, unlink, stat })

  await service.save({ path, content: '# New\n' })

  expect(await readFile(path, 'utf8')).toBe('# New\n')
  expect((await stat(path)).mode & 0o777).toBe(0o600)
})

it('cleans the same-directory temp and preserves the destination when rename fails', async () => {
  const path = await tempFile(Buffer.from('# Before\n'))
  const temporaryPaths: string[] = []
  const service = createDocumentService({
    readFile,
    stat,
    unlink,
    writeFile: async (writePath, data, options) => {
      temporaryPaths.push(writePath)
      await writeFile(writePath, data, options)
    },
    rename: async () => { throw new Error('rename failed') },
  })

  await expect(service.save({ path, content: '# After\n' })).rejects.toThrow('rename failed')
  expect(await readFile(path, 'utf8')).toBe('# Before\n')
  expect(temporaryPaths).toHaveLength(1)
  await expect(access(temporaryPaths[0])).rejects.toThrow()
})

it('still reports a version mismatch if filesystem refusal prevents temp cleanup', async () => {
  const original = Buffer.from('# Original\n')
  const path = await tempFile(original)
  const expectedVersion = createHash('sha256').update(original).digest('hex')
  const tempPath = join(dirname(path), '.cleanup-refused.tmp')
  const service = createDocumentService({
    readFile,
    stat,
    chmod,
    rename,
    temporaryPath: () => tempPath,
    writeFile: async (writePath, data, options) => {
      await writeFile(writePath, data, options)
      await writeFile(path, '# External\n', 'utf8')
    },
    unlink: async () => { throw Object.assign(new Error('cleanup refused'), { code: 'EACCES' }) },
  })

  await expect(service.save({ path, content: '# Mine\n', expectedVersion }))
    .rejects.toBeInstanceOf(DocumentVersionMismatchError)
  expect(await readFile(path, 'utf8')).toBe('# External\n')
  expect(await readFile(tempPath, 'utf8')).toBe('# Mine\n')
})

it('removes a partial temp file when the temporary write creates then rejects', async () => {
  const path = await tempFile(Buffer.from('# Destination\n'))
  const tempPath = join(dirname(path), '.partial.tmp')
  const unlinkCalls: string[] = []
  const service = createDocumentService({
    readFile, chmod, rename, stat,
    temporaryPath: () => tempPath,
    writeFile: async (writePath, data, options) => {
      await writeFile(writePath, Buffer.from(data).subarray(0, 3), options)
      throw new Error('partial write')
    },
    unlink: async (unlinkPath) => {
      unlinkCalls.push(unlinkPath)
      await unlink(unlinkPath)
    },
  })

  await expect(service.save({ path, content: '# Mine\n' })).rejects.toThrow('partial write')
  expect(unlinkCalls).toEqual([tempPath])
  await expect(access(tempPath)).rejects.toThrow()
  expect(await readFile(path, 'utf8')).toBe('# Destination\n')
})


it('atomically saves through an existing symlink while preserving the logical link', async () => {
  const root = await mkdtemp(join(tmpdir(), 'draftmd-document-'))
  roots.push(root)
  const targetPath = join(root, 'real.md')
  const logicalPath = join(root, 'link.md')
  const original = Buffer.from('# Original\n')
  await writeFile(targetPath, original)
  await chmod(targetPath, 0o640)
  await symlink('real.md', logicalPath)
  const expectedVersion = createHash('sha256').update(original).digest('hex')
  const service = createDocumentService({ readFile, writeFile, chmod, rename, unlink, stat, lstat, realpath })

  const saved = await service.save({ path: logicalPath, content: '# Updated\n', expectedVersion })

  expect((await lstat(logicalPath)).isSymbolicLink()).toBe(true)
  expect(await readFile(logicalPath, 'utf8')).toBe('# Updated\n')
  expect(await readFile(targetPath, 'utf8')).toBe('# Updated\n')
  expect((await stat(targetPath)).mode & 0o777).toBe(0o640)
  expect(saved).toEqual({
    path: logicalPath,
    version: createHash('sha256').update('# Updated\n').digest('hex'),
  })
})

it('treats a broken symlink with an expected version as a conflict without replacing it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'draftmd-document-'))
  roots.push(root)
  const logicalPath = join(root, 'link.md')
  await symlink('missing.md', logicalPath)
  const service = createDocumentService({ readFile, writeFile, chmod, rename, unlink, stat, lstat, realpath })

  await expect(service.save({ path: logicalPath, content: '# Replacement\n', expectedVersion: 'old-version' }))
    .rejects.toBeInstanceOf(DocumentVersionMismatchError)

  expect((await lstat(logicalPath)).isSymbolicLink()).toBe(true)
  await expect(readFile(logicalPath)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await readdir(root)).toEqual(['link.md'])
})

it('aborts if a logical symlink retargets after the second target read', async () => {
  const root = await mkdtemp(join(tmpdir(), 'draftmd-document-'))
  roots.push(root)
  const targetA = join(root, 'a.md')
  const targetB = join(root, 'b.md')
  const logicalPath = join(root, 'link.md')
  const originalA = Buffer.from('# Target A\n')
  const originalB = Buffer.from('# Target B\n')
  await writeFile(targetA, originalA)
  await writeFile(targetB, originalB)
  await symlink('a.md', logicalPath)
  const expectedVersion = createHash('sha256').update(originalA).digest('hex')
  let realpathCalls = 0
  const service = createDocumentService({
    readFile, writeFile, chmod, rename, unlink, stat, lstat,
    realpath: async (path) => {
      if (path === logicalPath && ++realpathCalls === 2) {
        await unlink(logicalPath)
        await symlink('b.md', logicalPath)
      }
      return realpath(path)
    },
  })

  await expect(service.save({ path: logicalPath, content: '# Mine\n', expectedVersion }))
    .rejects.toBeInstanceOf(DocumentVersionMismatchError)

  expect(await realpath(logicalPath)).toBe(await realpath(targetB))
  expect((await lstat(logicalPath)).isSymbolicLink()).toBe(true)
  expect(await readFile(targetA, 'utf8')).toBe('# Target A\n')
  expect(await readFile(targetB, 'utf8')).toBe('# Target B\n')
  expect((await readdir(root)).sort()).toEqual(['a.md', 'b.md', 'link.md'])
})

it('detects a target edit injected during final symlink identity validation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'draftmd-document-'))
  roots.push(root)
  const targetPath = join(root, 'real.md')
  const logicalPath = join(root, 'link.md')
  const original = Buffer.from('# Original\n')
  const external = Buffer.from('# External\n')
  await writeFile(targetPath, original)
  await symlink('real.md', logicalPath)
  const expectedVersion = createHash('sha256').update(original).digest('hex')
  let realpathCalls = 0
  const service = createDocumentService({
    readFile, writeFile, chmod, rename, unlink, stat, lstat,
    realpath: async (path) => {
      const resolved = await realpath(path)
      if (path === logicalPath && ++realpathCalls === 2) await writeFile(targetPath, external)
      return resolved
    },
  })

  await expect(service.save({ path: logicalPath, content: '# Mine\n', expectedVersion }))
    .rejects.toBeInstanceOf(DocumentVersionMismatchError)

  expect((await lstat(logicalPath)).isSymbolicLink()).toBe(true)
  expect(await readFile(targetPath)).toEqual(external)
  expect((await readdir(root)).sort()).toEqual(['link.md', 'real.md'])
})
