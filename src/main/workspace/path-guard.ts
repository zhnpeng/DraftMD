import { lstat, realpath, stat } from 'node:fs/promises'
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

interface PathOperations {
  readonly sep: string
  relative(from: string, to: string): string
  isAbsolute(path: string): boolean
}

const WINDOWS_RESERVED_NAMES = /^(?:CON|PRN|AUX|NUL|CLOCK\$|COM[1-9\u00b9\u00b2\u00b3]|LPT[1-9\u00b9\u00b2\u00b3])(?:\..*)?$/i
const WINDOWS_FORBIDDEN_CHARACTERS = /[<>:"|?*\x00-\x1f]/

export function isWithinWorkspaceRoot(
  root: string,
  target: string,
  paths: PathOperations = { sep, relative, isAbsolute },
): boolean {
  const pathFromRoot = paths.relative(root, target)
  return pathFromRoot === ''
    || (!pathFromRoot.startsWith(`..${paths.sep}`) && pathFromRoot !== '..' && !paths.isAbsolute(pathFromRoot))
}

function validateWindowsCompatibleSegment(part: string, errorCode: WorkspacePathErrorCode): void {
  if (part.endsWith('.') || part.endsWith(' ') || WINDOWS_FORBIDDEN_CHARACTERS.test(part) || WINDOWS_RESERVED_NAMES.test(part)) {
    throw new WorkspacePathError(errorCode)
  }
}

function normalizeRelativeWorkspacePath(
  input: string,
  finalSegmentError: WorkspacePathErrorCode,
  isWindows: boolean,
): string {
  if (input.includes('\0') || input.includes('\\')
    || /%2f|%5c|(?:^|\/)%2e%2e(?:\/|$|%2f|%5c)/i.test(input)) {
    throw new WorkspacePathError('PATH_OUTSIDE_WORKSPACE')
  }

  const normalized = input.normalize('NFC')
  if (normalized.length === 0
    || posix.isAbsolute(normalized)
    || win32.isAbsolute(normalized)
    || /^[a-z]:/i.test(normalized)
    || posix.normalize(normalized) !== normalized
    || normalized.split('/').some((part) => part.length === 0 || part === '.' || part === '..')) {
    throw new WorkspacePathError('PATH_OUTSIDE_WORKSPACE')
  }

  if (isWindows) {
    const parts = normalized.split('/')
    for (let index = 0; index < parts.length; index += 1) {
      validateWindowsCompatibleSegment(parts[index], index === parts.length - 1 ? finalSegmentError : 'PATH_OUTSIDE_WORKSPACE')
    }
  }

  return normalized
}

export function normalizeWorkspaceDirectory(input: string, isWindows = process.platform === 'win32'): string {
  if (input === '') return ''
  return normalizeRelativeWorkspacePath(input, 'PATH_OUTSIDE_WORKSPACE', isWindows)
}

export function normalizeRelativeMarkdownPath(input: string, isWindows = process.platform === 'win32'): string {
  const normalized = normalizeRelativeWorkspacePath(input, 'UNSUPPORTED_FILE_TYPE', isWindows)

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

async function validateFinalLink(root: WorkspaceRoot, path: string): Promise<void> {
  let metadata
  try {
    metadata = await lstat(path)
  } catch (error) {
    if (isMissingPath(error)) return
    throw new WorkspacePathError('PATH_OUTSIDE_WORKSPACE')
  }
  if (!metadata.isSymbolicLink()) return
  try {
    const canonical = await realpath(path)
    if (!isWithinWorkspaceRoot(root.canonicalPath, canonical)) throw new WorkspacePathError('PATH_OUTSIDE_WORKSPACE')
  } catch (error) {
    if (error instanceof WorkspacePathError) throw error
    throw new WorkspacePathError('PATH_OUTSIDE_WORKSPACE')
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
    if (!isWithinWorkspaceRoot(root.canonicalPath, canonical) || !isWithinWorkspaceRoot(canonical, root.canonicalPath)
      || identity.dev !== root.device || identity.ino !== root.inode || !identity.isDirectory()) {
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
    if (!isWithinWorkspaceRoot(root.canonicalPath, absolutePath)) {
      throw new WorkspacePathError('PATH_OUTSIDE_WORKSPACE')
    }
    if ((await stat(absolutePath)).nlink > 1) {
      throw new WorkspacePathError('PATH_OUTSIDE_WORKSPACE')
    }
    return { absolutePath, relativePath }
  }

  // lstat catches dangling final links that realpath cannot resolve. Existing
  // links must resolve back into the workspace before they can be treated as an
  // occupied destination.
  await validateFinalLink(root, logicalTarget)
  const existingTarget = await resolveNearestExistingPath(logicalTarget)
  if (existingTarget.missing.length === 0) {
    if (!isWithinWorkspaceRoot(root.canonicalPath, existingTarget.canonical)) {
      throw new WorkspacePathError('PATH_OUTSIDE_WORKSPACE')
    }
    // Keep the requested spelling for case-only Windows renames, after checking
    // the resolved final node so an external symlink cannot become a destination.
    return { absolutePath: logicalTarget, relativePath }
  }

  // Resolve through the nearest existing parent so a case-only Windows rename keeps
  // the requested destination spelling instead of inheriting an existing entry's case.
  const { canonical, missing } = await resolveNearestExistingPath(dirname(logicalTarget))
  if (!isWithinWorkspaceRoot(root.canonicalPath, canonical)) {
    throw new WorkspacePathError('PATH_OUTSIDE_WORKSPACE')
  }
  const absolutePath = join(canonical, ...missing, basename(logicalTarget))
  if (!isWithinWorkspaceRoot(root.canonicalPath, absolutePath)) {
    throw new WorkspacePathError('PATH_OUTSIDE_WORKSPACE')
  }
  return { absolutePath, relativePath }
}
