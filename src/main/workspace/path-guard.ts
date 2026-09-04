import { realpath, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep, win32 } from 'node:path'

export type MarkdownPathMode = 'existing' | 'new'

export interface WorkspaceRoot {
  readonly canonicalPath: string
  readonly device: number
  readonly inode: number
}

export interface ResolvedMarkdownPath {
  absolutePath: string
  relativePath: string
}

export type WorkspacePathErrorCode =
  | 'PATH_OUTSIDE_WORKSPACE'
  | 'UNSUPPORTED_FILE_TYPE'
  | 'PATH_NOT_FOUND'
  | 'WORKSPACE_NOT_DIRECTORY'

export class WorkspacePathError extends Error {
  constructor(readonly code: WorkspacePathErrorCode) {
    super(code)
    this.name = 'WorkspacePathError'
  }
}

function isMissingPath(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

function isWithinRoot(root: string, target: string): boolean {
  const pathFromRoot = relative(root, target)
  return pathFromRoot === ''
    || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..' && !isAbsolute(pathFromRoot))
}

function normalizeRelativeMarkdownPath(input: string): string {
  if (input.includes('\0') || input.includes('\\')
    || /%2f|%5c|(?:^|\/)%2e%2e(?:\/|$|%2f|%5c)/i.test(input)) {
    throw new WorkspacePathError('PATH_OUTSIDE_WORKSPACE')
  }

  const normalized = input.normalize('NFC')
  if (normalized.length === 0
    || posix.isAbsolute(normalized)
    || win32.isAbsolute(normalized)
    || posix.normalize(normalized) !== normalized
    || normalized.split('/').some((part) => part.length === 0 || part === '.' || part === '..')) {
    throw new WorkspacePathError('PATH_OUTSIDE_WORKSPACE')
  }

  const fileName = posix.basename(normalized)
  const extension = posix.extname(fileName).toLowerCase()
  const stem = fileName.slice(0, -extension.length)
  if ((extension !== '.md' && extension !== '.markdown') || stem.length === 0) {
    throw new WorkspacePathError('UNSUPPORTED_FILE_TYPE')
  }

  return normalized
}

async function resolveNearestExistingPath(path: string): Promise<{ canonical: string; missing: string[] }> {
  const missing: string[] = []
  let current = path

  while (true) {
    try {
      return { canonical: await realpath(current), missing }
    } catch (error) {
      if (!isMissingPath(error)) throw error
      const parent = dirname(current)
      if (parent === current) throw new WorkspacePathError('PATH_NOT_FOUND')
      missing.unshift(basename(current))
      current = parent
    }
  }
}

export async function createWorkspaceRoot(path: string): Promise<WorkspaceRoot> {
  const canonicalPath = await realpath(path)
  const identity = await stat(canonicalPath)
  if (!identity.isDirectory()) {
    throw new WorkspacePathError('WORKSPACE_NOT_DIRECTORY')
  }
  return Object.freeze({ canonicalPath, device: identity.dev, inode: identity.ino })
}

async function revalidateWorkspaceRoot(root: WorkspaceRoot): Promise<void> {
  try {
    const canonical = await realpath(root.canonicalPath)
    const identity = await stat(canonical)
    if (canonical !== root.canonicalPath || identity.dev !== root.device || identity.ino !== root.inode || !identity.isDirectory()) {
      throw new WorkspacePathError('PATH_OUTSIDE_WORKSPACE')
    }
  } catch (error) {
    if (error instanceof WorkspacePathError) throw error
    throw new WorkspacePathError('PATH_OUTSIDE_WORKSPACE')
  }
}

export async function resolveMarkdownPath(
  root: WorkspaceRoot,
  input: string,
  mode: MarkdownPathMode,
): Promise<ResolvedMarkdownPath> {
  await revalidateWorkspaceRoot(root)
  const relativePath = normalizeRelativeMarkdownPath(input)
  const logicalTarget = resolve(root.canonicalPath, ...relativePath.split('/'))

  if (mode === 'existing') {
    let absolutePath: string
    try {
      absolutePath = await realpath(logicalTarget)
    } catch (error) {
      if (isMissingPath(error)) throw new WorkspacePathError('PATH_NOT_FOUND')
      throw error
    }
    if (!isWithinRoot(root.canonicalPath, absolutePath)) {
      throw new WorkspacePathError('PATH_OUTSIDE_WORKSPACE')
    }
    if ((await stat(absolutePath)).nlink > 1) {
      throw new WorkspacePathError('PATH_OUTSIDE_WORKSPACE')
    }
    return { absolutePath, relativePath }
  }

  const { canonical, missing } = await resolveNearestExistingPath(logicalTarget)
  if (!isWithinRoot(root.canonicalPath, canonical)) {
    throw new WorkspacePathError('PATH_OUTSIDE_WORKSPACE')
  }
  const absolutePath = join(canonical, ...missing)
  if (!isWithinRoot(root.canonicalPath, absolutePath)) {
    throw new WorkspacePathError('PATH_OUTSIDE_WORKSPACE')
  }
  return { absolutePath, relativePath }
}
