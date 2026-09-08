import { dirname, join } from 'node:path'

export interface RecentWorkspaces {
  get(): string[]
  add(path: string): boolean
  clear(): void
}

export interface RecentWorkspacesDependencies {
  path: string
  readFileSync(path: string, encoding: BufferEncoding): string
  writeFileSync(path: string, data: string, encoding: BufferEncoding): void
  mkdirSync(path: string, options: { recursive: true }): unknown
  statSync(path: string): { isDirectory(): boolean }
}

export function recentWorkspacesPath(userDataPath: string): string {
  return join(userDataPath, 'recent-workspaces.json')
}

export function parseRecentWorkspaces(serialized: string): string[] {
  try {
    const parsed: unknown = JSON.parse(serialized)
    if (!parsed || typeof parsed !== 'object') return []
    const recent = (parsed as { recent?: unknown }).recent
    return Array.isArray(recent)
      ? recent.filter((path): path is string => typeof path === 'string').slice(0, 10)
      : []
  } catch {
    return []
  }
}

function workspacePathKey(path: string, isWindows: boolean): string {
  return isWindows ? path.normalize('NFC').toLowerCase() : path
}

export function addRecentWorkspace(recent: string[], path: string, isWindows = process.platform === 'win32'): string[] {
  const pathKey = workspacePathKey(path, isWindows)
  return [path, ...recent.filter((candidate) => workspacePathKey(candidate, isWindows) !== pathKey)].slice(0, 10)
}

export function createRecentWorkspaces(deps: RecentWorkspacesDependencies): RecentWorkspaces {
  let recent: string[] = []
  try {
    recent = parseRecentWorkspaces(deps.readFileSync(deps.path, 'utf8'))
  } catch {
    // First run or unreadable best-effort state.
  }

  const persist = (): void => {
    try {
      deps.mkdirSync(dirname(deps.path), { recursive: true })
      deps.writeFileSync(deps.path, JSON.stringify({ recent }, null, 2), 'utf8')
    } catch {
      // Recent workspaces never block document editing.
    }
  }
  const prune = (): void => {
    const next = recent.filter((path) => {
      try {
        return deps.statSync(path).isDirectory()
      } catch {
        return false
      }
    })
    if (next.length !== recent.length || next.some((path, index) => path !== recent[index])) {
      recent = next
      persist()
    }
  }

  return {
    get() {
      prune()
      return [...recent]
    },
    add(path) {
      const next = addRecentWorkspace(recent, path)
      const changed = next.length !== recent.length || next.some((candidate, index) => candidate !== recent[index])
      if (changed) {
        recent = next
        persist()
      }
      return changed
    },
    clear() {
      recent = []
      persist()
    },
  }
}
