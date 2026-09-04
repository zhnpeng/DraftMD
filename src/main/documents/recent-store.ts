import { dirname, join } from 'node:path'

export interface RecentStoreData {
  recent: string[]
  restoreOnLaunch: boolean
}

export interface RecentStore {
  get(): RecentStoreData
  add(filePath: string): boolean
  clear(): void
  setRestoreOnLaunch(enabled: boolean): void
}

export interface RecentStoreDeps {
  path: string
  readFileSync(path: string, encoding: BufferEncoding): string
  writeFileSync(path: string, data: string, encoding: BufferEncoding): void
  mkdirSync(path: string, options: { recursive: true }): unknown
}

export function draftMDRecentStorePath(userDataPath: string): string {
  return join(userDataPath, 'recent.json')
}

const EMPTY_STORE: RecentStoreData = { recent: [], restoreOnLaunch: true }

export function parseRecentStore(serialized: string): RecentStoreData {
  try {
    const parsed: unknown = JSON.parse(serialized)
    if (!parsed || typeof parsed !== 'object') return { ...EMPTY_STORE }
    const value = parsed as { recent?: unknown; restoreOnLaunch?: unknown }
    return {
      recent: Array.isArray(value.recent)
        ? value.recent.filter((path): path is string => typeof path === 'string').slice(0, 10)
        : [],
      restoreOnLaunch: typeof value.restoreOnLaunch === 'boolean' ? value.restoreOnLaunch : true,
    }
  } catch {
    return { ...EMPTY_STORE }
  }
}

export function addRecentFile(store: RecentStoreData, filePath: string): RecentStoreData {
  return {
    ...store,
    recent: [filePath, ...store.recent.filter((path) => path !== filePath)].slice(0, 10),
  }
}

export function createRecentStore(deps: RecentStoreDeps): RecentStore {
  let data = { ...EMPTY_STORE }
  try {
    data = parseRecentStore(deps.readFileSync(deps.path, 'utf-8'))
  } catch {
    // First run or unreadable store.
  }

  const persist = (): void => {
    try {
      deps.mkdirSync(dirname(deps.path), { recursive: true })
      deps.writeFileSync(deps.path, JSON.stringify(data, null, 2), 'utf-8')
    } catch {
      // Recent files are best-effort state.
    }
  }

  return {
    get: () => ({ recent: [...data.recent], restoreOnLaunch: data.restoreOnLaunch }),
    add(filePath) {
      const next = addRecentFile(data, filePath)
      const changed = next.recent.length !== data.recent.length
        || next.recent.some((path, index) => path !== data.recent[index])
      if (changed) {
        data = next
        persist()
      }
      return changed
    },
    clear() {
      data = { ...data, recent: [] }
      persist()
    },
    setRestoreOnLaunch(enabled) {
      data = { ...data, restoreOnLaunch: enabled }
      persist()
    },
  }
}
