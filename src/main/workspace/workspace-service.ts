import { randomUUID } from 'node:crypto'
import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { TextEditSchema, type TextEdit } from '../../shared/contracts/workspace'
import { fileVersion } from './file-version'
import {
  listMarkdownFiles,
  searchMarkdownFiles,
  type MarkdownFileInfo,
  type SearchMatch,
} from './markdown-index'
import {
  resolveMarkdownPath,
  type WorkspaceRoot,
} from './path-guard'

export type WorkspaceServiceErrorCode =
  | 'FILE_ALREADY_EXISTS'
  | 'VERSION_CONFLICT'
  | 'EDIT_TARGET_NOT_FOUND'
  | 'EDIT_TARGET_AMBIGUOUS'

export class WorkspaceServiceError extends Error {
  constructor(readonly code: WorkspaceServiceErrorCode) {
    super(code)
    this.name = 'WorkspaceServiceError'
  }
}

export interface FileMutationResult {
  path: string
  version: string
}

export interface RenameResult {
  from: string
  to: string
  version: string
}

export interface MarkdownReadResult extends FileMutationResult {
  content: string
}

export interface WorkspaceService {
  list(signal?: AbortSignal): Promise<MarkdownFileInfo[]>
  search(query: string, limit?: number, signal?: AbortSignal): Promise<SearchMatch[]>
  read(path: string): Promise<MarkdownReadResult>
  create(path: string, content: string): Promise<FileMutationResult>
  edit(path: string, edit: TextEdit, expectedVersion: string): Promise<FileMutationResult>
  rename(from: string, to: string, expectedVersion: string): Promise<RenameResult>
  delete(path: string, expectedVersion: string): Promise<FileMutationResult>
}

export interface WorkspaceServiceDependencies {
  rename?: typeof rename
}

function isFileExists(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'EEXIST'
}

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

async function syncParent(path: string): Promise<void> {
  let handle
  try {
    handle = await open(dirname(path), 'r')
    await handle.sync()
  } catch {
    // Directory fsync is best-effort because support varies by filesystem.
  } finally {
    await handle?.close()
  }
}

async function atomicReplace(
  destination: string,
  bytes: Buffer,
  mode: number,
  renameFile: typeof rename,
): Promise<void> {
  const temporaryPath = join(dirname(destination), `.${basename(destination)}.${randomUUID()}.draftmd-tmp`)
  let moved = false
  try {
    const handle = await open(temporaryPath, 'wx', mode)
    try {
      await handle.writeFile(bytes)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await chmod(temporaryPath, mode)
    await renameFile(temporaryPath, destination)
    moved = true
    await syncParent(destination)
  } finally {
    if (!moved) {
      try {
        await unlink(temporaryPath)
      } catch (error) {
        if (!isMissingFile(error)) throw error
      }
    }
  }
}

function countOccurrences(content: string, target: string): number {
  let count = 0
  let offset = 0
  while (true) {
    const found = content.indexOf(target, offset)
    if (found === -1) return count
    count += 1
    offset = found + target.length
  }
}

async function readVersioned(path: string): Promise<{ bytes: Buffer; version: string }> {
  const bytes = await readFile(path)
  return { bytes, version: fileVersion(bytes) }
}

export function createWorkspaceService(
  root: WorkspaceRoot,
  dependencies: WorkspaceServiceDependencies = {},
): WorkspaceService {
  const renameFile = dependencies.rename ?? rename

  return {
    list(signal) {
      return listMarkdownFiles(root, signal)
    },
    search(query, limit, signal) {
      return searchMarkdownFiles(root, query, limit, signal)
    },
    async read(path) {
      const resolved = await resolveMarkdownPath(root, path, 'existing')
      const { bytes, version } = await readVersioned(resolved.absolutePath)
      return { path: resolved.relativePath, content: bytes.toString('utf8'), version }
    },
    async create(path, content) {
      const resolved = await resolveMarkdownPath(root, path, 'new')
      await mkdir(dirname(resolved.absolutePath), { recursive: true })
      const revalidated = await resolveMarkdownPath(root, path, 'new')
      const bytes = Buffer.from(content, 'utf8')
      try {
        await writeFile(revalidated.absolutePath, bytes, { flag: 'wx', mode: 0o600 })
      } catch (error) {
        if (isFileExists(error)) throw new WorkspaceServiceError('FILE_ALREADY_EXISTS')
        throw error
      }
      await syncParent(revalidated.absolutePath)
      return { path: resolved.relativePath, version: fileVersion(bytes) }
    },
    async edit(path, input, expectedVersion) {
      const edit = TextEditSchema.parse(input)
      const resolved = await resolveMarkdownPath(root, path, 'existing')
      const before = await readVersioned(resolved.absolutePath)
      if (before.version !== expectedVersion) throw new WorkspaceServiceError('VERSION_CONFLICT')

      const content = before.bytes.toString('utf8')
      const occurrences = countOccurrences(content, edit.oldText)
      if (occurrences === 0) throw new WorkspaceServiceError('EDIT_TARGET_NOT_FOUND')
      if (occurrences !== edit.expectedOccurrences) throw new WorkspaceServiceError('EDIT_TARGET_AMBIGUOUS')

      const current = await readVersioned(resolved.absolutePath)
      if (current.version !== expectedVersion) throw new WorkspaceServiceError('VERSION_CONFLICT')
      const nextBytes = Buffer.from(content.replace(edit.oldText, edit.newText), 'utf8')
      const mode = (await stat(resolved.absolutePath)).mode & 0o777
      await atomicReplace(resolved.absolutePath, nextBytes, mode, renameFile)
      return { path: resolved.relativePath, version: fileVersion(nextBytes) }
    },
    async rename(from, to, expectedVersion) {
      const source = await resolveMarkdownPath(root, from, 'existing')
      const destination = await resolveMarkdownPath(root, to, 'new')
      const current = await readVersioned(source.absolutePath)
      if (current.version !== expectedVersion) throw new WorkspaceServiceError('VERSION_CONFLICT')
      try {
        await stat(destination.absolutePath)
        throw new WorkspaceServiceError('FILE_ALREADY_EXISTS')
      } catch (error) {
        if (!isMissingFile(error)) throw error
      }
      await mkdir(dirname(destination.absolutePath), { recursive: true })
      const revalidated = await resolveMarkdownPath(root, to, 'new')
      const latest = await readVersioned(source.absolutePath)
      if (latest.version !== expectedVersion) throw new WorkspaceServiceError('VERSION_CONFLICT')
      try {
        await renameFile(source.absolutePath, revalidated.absolutePath)
      } catch (error) {
        if (isFileExists(error)) throw new WorkspaceServiceError('FILE_ALREADY_EXISTS')
        throw error
      }
      await syncParent(revalidated.absolutePath)
      return { from: source.relativePath, to: destination.relativePath, version: expectedVersion }
    },
    async delete(path, expectedVersion) {
      const resolved = await resolveMarkdownPath(root, path, 'existing')
      const current = await readVersioned(resolved.absolutePath)
      if (current.version !== expectedVersion) throw new WorkspaceServiceError('VERSION_CONFLICT')
      await unlink(resolved.absolutePath)
      await syncParent(resolved.absolutePath)
      return { path: resolved.relativePath, version: current.version }
    },
  }
}
