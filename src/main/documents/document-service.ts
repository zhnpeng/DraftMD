import { createHash, randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { chmod, lstat, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { restoreImagePaths, resolveImagePaths } from './image-paths'

export interface DocumentService {
  load(path: string): Promise<{ content: string; version: string }>
  save(input: { path: string; content: string; expectedVersion?: string }): Promise<{ path: string; version: string }>
}

export interface DocumentDiskSnapshot {
  content: string
  sourceContent: string
  version: string
}

export interface DocumentSnapshotLoader {
  loadSnapshot(path: string): Promise<DocumentDiskSnapshot>
}

export type ConcreteDocumentService = DocumentService & DocumentSnapshotLoader

export interface DocumentServiceDeps {
  readFile(path: string): Promise<Buffer>
  writeFile?: typeof writeFile
  chmod?: typeof chmod
  lstat?: typeof lstat
  realpath?: typeof realpath
  rename?: typeof rename
  unlink?: typeof unlink
  stat?: typeof stat
  temporaryPath?(destination: string): string
}

export class DocumentVersionMismatchError extends Error {
  constructor(readonly path: string) {
    super(`Document version mismatch: ${path}`)
    this.name = 'DocumentVersionMismatchError'
  }
}

function hash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function defaultTemporaryPath(destination: string): string {
  return join(dirname(destination), `.${randomUUID()}.tmp`)
}

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

export function createDocumentService(deps: DocumentServiceDeps): ConcreteDocumentService {
  const writeTemporaryFile = deps.writeFile ?? writeFile
  const setTemporaryMode = deps.chmod ?? chmod
  const inspectLogicalPath = deps.lstat ?? lstat
  const resolveRealPath = deps.realpath ?? realpath
  const renameTemporaryFile = deps.rename ?? rename
  const removeTemporaryFile = deps.unlink ?? unlink
  const inspectFile = deps.stat ?? stat
  const temporaryPath = deps.temporaryPath ?? defaultTemporaryPath

  const currentVersion = async (path: string): Promise<string | null> => {
    try {
      return hash(await deps.readFile(path))
    } catch {
      return null
    }
  }

  const loadSnapshot = async (path: string): Promise<DocumentDiskSnapshot> => {
    const bytes = await deps.readFile(path)
    const sourceContent = bytes.toString('utf8')
    return {
      content: resolveImagePaths(sourceContent, path),
      sourceContent,
      version: hash(bytes),
    }
  }

  return {
    loadSnapshot,
    async load(path) {
      const { content, version } = await loadSnapshot(path)
      return { content, version }
    },
    async save(input) {
      let writeTarget = input.path
      let logicalSymlinkTarget: string | null = null
      try {
        if ((await inspectLogicalPath(input.path)).isSymbolicLink()) {
          try {
            writeTarget = await resolveRealPath(input.path)
            logicalSymlinkTarget = writeTarget
          } catch (error) {
            if (input.expectedVersion !== undefined && isMissingFile(error)) {
              throw new DocumentVersionMismatchError(input.path)
            }
            throw error
          }
        }
      } catch (error) {
        if (!isMissingFile(error) || error instanceof DocumentVersionMismatchError) throw error
      }

      if (input.expectedVersion !== undefined
        && await currentVersion(writeTarget) !== input.expectedVersion) {
        throw new DocumentVersionMismatchError(input.path)
      }

      let mode = 0o600
      try {
        mode = (await inspectFile(writeTarget)).mode & 0o777
      } catch (error) {
        if (!isMissingFile(error)) throw error
      }

      const source = restoreImagePaths(input.content, input.path)
      const bytes = Buffer.from(source, 'utf8')
      const tempPath = temporaryPath(writeTarget)
      if (tempPath === writeTarget || dirname(tempPath) !== dirname(writeTarget)) {
        throw new Error('Document temporary file must be unique and in the destination directory')
      }

      let renamed = false
      let operationError: unknown
      try {
        await writeTemporaryFile(tempPath, bytes, { flag: 'wx', mode })
        await setTemporaryMode(tempPath, mode)
        const tempBytes = await deps.readFile(tempPath)

        if (logicalSymlinkTarget !== null) {
          try {
            const currentLogical = await inspectLogicalPath(input.path)
            const currentTarget = currentLogical.isSymbolicLink() ? await resolveRealPath(input.path) : null
            if (currentTarget !== logicalSymlinkTarget) throw new DocumentVersionMismatchError(input.path)
          } catch (error) {
            if (error instanceof DocumentVersionMismatchError) throw error
            throw new DocumentVersionMismatchError(input.path)
          }
        }

        if (input.expectedVersion !== undefined
          && await currentVersion(writeTarget) !== input.expectedVersion) {
          throw new DocumentVersionMismatchError(input.path)
        }
        await renameTemporaryFile(tempPath, writeTarget)
        renamed = true
        return { path: input.path, version: hash(tempBytes) }
      } catch (error) {
        operationError = error
        throw error
      } finally {
        if (!renamed) {
          try {
            await removeTemporaryFile(tempPath)
          } catch (cleanupError) {
            if (!isMissingFile(cleanupError) && operationError === undefined) throw cleanupError
          }
        }
      }
    },
  }
}
