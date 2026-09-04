import { basename, isAbsolute, join, posix, relative, resolve, sep } from 'node:path'
import { opendir, realpath } from 'node:fs/promises'
import { watch as watchFileSystem, type FSWatcher } from 'node:fs'
import type { BrowserWindow } from 'electron'
import type { SiblingFile, WorkspaceDescriptor } from '../../shared/contracts'
import { IpcEventSchemas } from '../../shared/contracts'
import { createWorkspaceRoot, resolveMarkdownPath, WorkspacePathError, type WorkspaceRoot } from './path-guard'
import type { RecentWorkspaces } from './recent-workspaces'
import { workspaceId } from './workspace-id'

const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules'])

export interface ActiveWorkspace {
  descriptor: WorkspaceDescriptor
  root: WorkspaceRoot
}

interface ManagedWorkspace extends ActiveWorkspace {
  watcher: FSWatcher | null
  refreshTimer: ReturnType<typeof setTimeout> | null
  window: BrowserWindow
}

export interface WorkspaceManager {
  openFolder(win: BrowserWindow, path?: string): Promise<WorkspaceDescriptor | null>
  current(windowId: number): ActiveWorkspace | null
  list(windowId: number, directory?: string): Promise<SiblingFile[]>
  resolveFile(windowId: number, relativePath: string): Promise<string>
  close(windowId: number): void
}

export interface WorkspaceManagerDependencies {
  chooseFolder(win: BrowserWindow): Promise<string | null>
  recent: RecentWorkspaces
  prepare?(win: BrowserWindow, canonicalRoot: string): Promise<boolean>
  watch?(path: string, options: { recursive: true }, listener: () => void): FSWatcher
}

function sendWorkspaceEvent(win: BrowserWindow, channel: 'workspace:opened' | 'workspace:files-changed', ...args: unknown[]): void {
  const parsed = IpcEventSchemas[channel].safeParse(args)
  if (parsed.success && !win.isDestroyed() && !win.webContents.isDestroyed()) {
    win.webContents.send(channel, ...parsed.data)
  }
}

function logicalDirectory(input: string): string {
  const normalized = input.normalize('NFC')
  if (normalized === '') return ''
  if (normalized.includes('\0') || normalized.includes('\\') || posix.isAbsolute(normalized)
    || posix.normalize(normalized) !== normalized
    || normalized.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new WorkspacePathError('PATH_OUTSIDE_WORKSPACE')
  }
  return normalized
}

function isWithinRoot(root: string, target: string): boolean {
  const fromRoot = relative(root, target)
  return fromRoot === '' || (fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot))
}

function isMarkdown(name: string): boolean {
  const lower = name.toLowerCase()
  return !name.startsWith('.') && (lower.endsWith('.md') || lower.endsWith('.markdown'))
}

export function createWorkspaceManager(deps: WorkspaceManagerDependencies): WorkspaceManager {
  const states = new Map<number, ManagedWorkspace>()
  const watch = deps.watch ?? watchFileSystem

  const close = (windowId: number): void => {
    const state = states.get(windowId)
    if (!state) return
    if (state.refreshTimer) clearTimeout(state.refreshTimer)
    state.watcher?.close()
    states.delete(windowId)
  }
  const required = (windowId: number): ManagedWorkspace => {
    const state = states.get(windowId)
    if (!state) throw new WorkspacePathError('PATH_NOT_FOUND')
    return state
  }
  const scheduleRefresh = (state: ManagedWorkspace): void => {
    if (state.refreshTimer) clearTimeout(state.refreshTimer)
    state.refreshTimer = setTimeout(() => {
      state.refreshTimer = null
      if (states.get(state.window.id) === state) sendWorkspaceEvent(state.window, 'workspace:files-changed')
    }, 150)
  }

  return {
    async openFolder(win, selectedPath) {
      const path = selectedPath ?? await deps.chooseFolder(win)
      if (!path) return null
      const root = await createWorkspaceRoot(path)
      const descriptor = {
        id: workspaceId(root.canonicalPath),
        name: basename(root.canonicalPath),
      }
      if (deps.prepare && !await deps.prepare(win, root.canonicalPath)) return null
      close(win.id)
      const state: ManagedWorkspace = { descriptor, root, watcher: null, refreshTimer: null, window: win }
      states.set(win.id, state)
      try {
        state.watcher = watch(root.canonicalPath, { recursive: true }, () => scheduleRefresh(state))
        state.watcher.on('error', () => {
          state.watcher?.close()
          state.watcher = null
        })
      } catch {
        state.watcher = null
      }
      deps.recent.add(root.canonicalPath)
      sendWorkspaceEvent(win, 'workspace:opened', descriptor)
      return descriptor
    },
    current(windowId) {
      const state = states.get(windowId)
      return state ? { descriptor: state.descriptor, root: state.root } : null
    },
    async list(windowId, input = '') {
      const state = states.get(windowId)
      if (!state) return []
      const directory = logicalDirectory(input)
      const logicalTarget = directory ? resolve(state.root.canonicalPath, ...directory.split('/')) : state.root.canonicalPath
      let canonicalTarget: string
      try {
        canonicalTarget = await realpath(logicalTarget)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new WorkspacePathError('PATH_NOT_FOUND')
        throw error
      }
      if (!isWithinRoot(state.root.canonicalPath, canonicalTarget)) throw new WorkspacePathError('PATH_OUTSIDE_WORKSPACE')

      const entries = []
      for await (const entry of await opendir(canonicalTarget)) entries.push(entry)
      const files: SiblingFile[] = []
      if (directory) {
        const parent = posix.dirname(directory)
        files.push({ name: '..', path: parent === '.' ? '' : parent, kind: 'parent' })
      }
      const compare = (left: SiblingFile, right: SiblingFile): number => left.name < right.name ? -1 : left.name > right.name ? 1 : 0
      files.push(...entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && !SKIPPED_DIRECTORIES.has(entry.name))
        .map((entry) => ({ name: entry.name, path: directory ? `${directory}/${entry.name}` : entry.name, kind: 'directory' as const }))
        .sort(compare))
      files.push(...entries
        .filter((entry) => entry.isFile() && isMarkdown(entry.name))
        .map((entry) => ({ name: entry.name, path: directory ? `${directory}/${entry.name}` : entry.name, kind: 'file' as const }))
        .sort(compare))
      return files
    },
    async resolveFile(windowId, relativePath) {
      const state = required(windowId)
      return (await resolveMarkdownPath(state.root, relativePath, 'existing')).absolutePath
    },
    close,
  }
}
