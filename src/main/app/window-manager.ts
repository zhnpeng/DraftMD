import { BrowserWindow, dialog, type IpcMainEvent } from 'electron'
import { basename, dirname, extname, isAbsolute, join, relative, sep } from 'node:path'
import type { Dirent } from 'node:fs'
import { DocumentVersionMismatchError, type DocumentService, type DocumentDiskSnapshot, type DocumentSnapshotLoader } from '../documents/document-service'
import { restoreImagePaths } from '../documents/image-paths'
import type { RecentStore } from '../documents/recent-store'
import type { WatchService } from '../documents/watch-service'
import { IpcEventSchemas, type DocumentSnapshot, type SiblingFile } from '../../shared/contracts'
import { t, type Locale } from '../../shared/i18n'

const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdown', '.mkd']

export interface WindowState {
  filePath: string | null
  browsePath: string | null
  version: string | null
  dirty: boolean
  closePromise: Promise<'saved' | 'discarded' | 'cancelled'> | null
  rendererReady: boolean
  writeQueue: Promise<void>
  closeAuthorized: boolean
  pendingExternalDocument: DocumentDiskSnapshot | null
  documentGeneration: number
}

interface PendingDocumentStateRequest {
  webContentsId: number
  resolve: (snapshot: DocumentSnapshot | null) => void
  timer: ReturnType<typeof setTimeout>
}

export interface WindowManager {
  createWindow(filePath?: string, initialContent?: string, initialBrowsePath?: string): BrowserWindow
  openFile(filePath: string, preferredWindow?: BrowserWindow): Promise<void>
  prepareForWorkspace(win: BrowserWindow, rootPath: string): Promise<boolean>
  loadFileInWindow(win: BrowserWindow, filePath: string): Promise<{ path: string; content: string; version: string } | null>
  getState(win: BrowserWindow): WindowState
  listSiblings(win: BrowserWindow): Promise<SiblingFile[]>
  openSibling(win: BrowserWindow, filePath: string): Promise<boolean>
  save(win: BrowserWindow, content: string, expectedPath?: string, rebuildMenu?: boolean): Promise<string | null>
  saveAs(win: BrowserWindow, content: string, expectedPath?: string): Promise<string | null>
  reportExternalConflict(win: BrowserWindow): Promise<void>
  stageExternalDocument(win: BrowserWindow, path: string, snapshot: DocumentDiskSnapshot): void
  acknowledgeExternalVersion(win: BrowserWindow, path: string, version: string): void
  respondDocumentState(event: IpcMainEvent, requestId: string, snapshot: DocumentSnapshot): void
  setRendererReady(win: BrowserWindow): void
  setDirty(win: BrowserWindow, dirty: boolean): void
  confirmAllWindowsClose(): Promise<boolean>
  setQuitting(quitting: boolean): void
  dispose(win: BrowserWindow): void
}

export interface WindowManagerDeps {
  documentService: DocumentService
  snapshotLoader: DocumentSnapshotLoader
  watchService: WatchService
  recentStore: RecentStore
  locale(): Locale
  appVersion(): string
  databaseWarning(): 'DATABASE_RECOVERED' | 'DATABASE_MEMORY_FALLBACK' | null
  preloadPath: string
  rendererPath: string
  rendererURL?: string
  readdir(path: string, options: { withFileTypes: true }): Promise<Dirent[]>
  stat(path: string): Promise<{ isDirectory(): boolean }>
  rebuildMenu(): void
  addRecentDocument(path: string): void
  platform: NodeJS.Platform
  onStartupMark?(name: string): void
  onRendererReady?(): void
  onWindowClosed?(win: BrowserWindow): void
}

function sendEvent<Channel extends keyof typeof IpcEventSchemas>(
  win: BrowserWindow,
  channel: Channel,
  ...args: unknown[]
): void {
  const parsed = IpcEventSchemas[channel].safeParse(args)
  if (!parsed.success || win.isDestroyed() || win.webContents.isDestroyed()) return
  win.webContents.send(channel, ...parsed.data)
}

export function createWindowManager(deps: WindowManagerDeps): WindowManager {
  const states = new Map<number, WindowState>()
  const pendingDocumentStateRequests = new Map<string, PendingDocumentStateRequest>()
  let nextDocumentStateRequestId = 0
  let isQuitting = false

  const getState = (win: BrowserWindow): WindowState => {
    let state = states.get(win.id)
    if (!state) {
      state = {
        filePath: null, browsePath: null, version: null, dirty: false, closePromise: null,
        rendererReady: false, writeQueue: Promise.resolve(), closeAuthorized: false, pendingExternalDocument: null, documentGeneration: 0,
      }
      states.set(win.id, state)
    }
    return state
  }

  const updateTitle = (win: BrowserWindow): void => {
    const state = getState(win)
    const fileName = state.filePath ? basename(state.filePath) : t(deps.locale(), 'document.untitled')
    win.setTitle(`${fileName} — ${t(deps.locale(), 'app.name')}`)
  }

  const suggestFileName = (win: BrowserWindow, content?: string): string | undefined => {
    const state = getState(win)
    if (state.filePath) return basename(state.filePath, '.md')
    const match = content?.match(/^#\s+(.+)/m) || content?.match(/^(.+)/m)
    return match?.[1].trim().replace(/[/\\:*?"<>|]/g, '').slice(0, 60) || undefined
  }

  const suggestSavePath = (win: BrowserWindow, fileName?: string): string | undefined => {
    const state = getState(win)
    const name = fileName ?? suggestFileName(win)
    return name ? (state.filePath ? join(dirname(state.filePath), name) : name) : undefined
  }

  const listSiblingFiles = async (filePath: string | null, browseDir?: string): Promise<SiblingFile[]> => {
    const dir = browseDir ?? (filePath ? dirname(filePath) : null)
    if (!dir) return []
    try {
      const entries = await deps.readdir(dir, { withFileTypes: true })
      const result: SiblingFile[] = []
      const parent = dirname(dir)
      if (parent !== dir) result.push({ name: '..', path: parent, kind: 'parent' })
      result.push(...entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .map((entry) => ({ name: entry.name, path: join(dir, entry.name), kind: 'directory' as const }))
        .sort((a, b) => a.name.localeCompare(b.name)))
      result.push(...entries.filter((entry) => entry.isFile() && MARKDOWN_EXTENSIONS.includes(extname(entry.name).toLowerCase()))
        .map((entry) => ({ name: entry.name, path: join(dir, entry.name), kind: 'file' as const }))
        .sort((a, b) => a.name.localeCompare(b.name)))
      return result
    } catch {
      return []
    }
  }

  const pushRecentFile = (filePath: string, rebuildMenu: boolean): void => {
    if (!deps.recentStore.add(filePath)) return
    // Rebuilding menus from autosave cancels macOS IME composition.
    if (deps.platform === 'darwin') deps.addRecentDocument(filePath)
    else if (rebuildMenu) deps.rebuildMenu()
  }

  const setActiveDocument = (win: BrowserWindow, filePath: string, version: string, sourceContent?: string): void => {
    const state = getState(win)
    state.filePath = filePath
    state.browsePath = dirname(filePath)
    state.version = version
    state.dirty = false
    state.documentGeneration += 1
    state.pendingExternalDocument = null
    deps.watchService.watch(win, { filePath, browsePath: state.browsePath, knownSourceContent: sourceContent })
    updateTitle(win)
  }

  const loadFileInWindow = async (win: BrowserWindow, filePath: string): Promise<{ path: string; content: string; version: string } | null> => {
    const state = getState(win)
    let result: { path: string; content: string; version: string } | null = null
    const operation = async (): Promise<void> => {
      try {
        const loaded = await deps.snapshotLoader.loadSnapshot(filePath)
        if (win.isDestroyed()) return
        setActiveDocument(win, filePath, loaded.version, loaded.sourceContent)
        pushRecentFile(filePath, true)
        const opened = { path: filePath, content: loaded.content, version: loaded.version }
        sendEvent(win, 'file-opened', opened)
        result = opened
      } catch {
        // Keep the current document when the selected file cannot be read.
      }
    }
    const next = state.writeQueue.then(operation, operation)
    state.writeQueue = next.then(() => undefined, () => undefined)
    await next
    return result
  }

  const findWindowForFile = (filePath: string): BrowserWindow | null => {
    for (const [id, state] of states) {
      if (state.filePath === filePath) return BrowserWindow.fromId(id) ?? null
    }
    return null
  }

  const findEmptyWindow = (): BrowserWindow | null => {
    for (const [id, state] of states) {
      if (!state.filePath) return BrowserWindow.fromId(id) ?? null
    }
    return null
  }

  const requestDocumentState = (win: BrowserWindow): Promise<DocumentSnapshot | null> => {
    const requestId = `${win.webContents.id}:${++nextDocumentStateRequestId}`
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const pending = pendingDocumentStateRequests.get(requestId)
        if (!pending) return
        pendingDocumentStateRequests.delete(requestId)
        pending.resolve(null)
      }, 3000)
      pendingDocumentStateRequests.set(requestId, { webContentsId: win.webContents.id, resolve, timer })
      sendEvent(win, 'request-document-state', requestId)
    })
  }

  const saveToPath = (win: BrowserWindow, filePath: string, content: string, sourcePath: string | null, rebuildMenu: boolean): Promise<boolean> => {
    const state = getState(win)
    const operation = async (): Promise<boolean> => {
      if (win.isDestroyed() || state.filePath !== sourcePath) return false
      const finishInternalWrite = deps.watchService.beginInternalWrite(win)
      try {
        const expectedVersion = filePath === sourcePath ? state.version ?? undefined : undefined
        const saved = await deps.documentService.save({ path: filePath, content, expectedVersion })
        deps.watchService.setKnownSourceContent(win, restoreImagePaths(content, filePath))
        if (win.isDestroyed() || state.filePath !== sourcePath) return false
        setActiveDocument(win, filePath, saved.version, restoreImagePaths(content, filePath))
        pushRecentFile(filePath, rebuildMenu)
        return true
      } catch (error) {
        if (error instanceof DocumentVersionMismatchError && sourcePath === filePath) {
          try {
            const disk = await deps.snapshotLoader.loadSnapshot(filePath)
            if (!win.isDestroyed() && state.filePath === sourcePath) {
              // Preserve the user's base version until they choose keep/load.
              // The existing renderer conflict path pauses autosave visibly.
              state.pendingExternalDocument = disk
              sendEvent(win, 'file-changed', disk.content)
              sendEvent(win, 'document-snapshot-changed', { path: filePath, content: disk.content, version: disk.version })
            }
          } catch {
            if (!win.isDestroyed() && state.filePath === sourcePath) {
              await dialog.showMessageBox(win, {
                type: 'warning', buttons: [t(deps.locale(), 'common.ok')],
                message: t(deps.locale(), 'conflict.readFailedTitle'),
                detail: t(deps.locale(), 'conflict.readFailedDetail'),
              })
              // Preserve dirty content but stop automatic retries. A later
              // user edit or manual Save explicitly re-arms persistence.
              sendEvent(win, 'autosave-retry-paused')
            }
          }
        }
        return false
      } finally {
        finishInternalWrite()
      }
    }
    const next = state.writeQueue.then(operation, operation)
    state.writeQueue = next.then(() => undefined, () => undefined)
    return next
  }

  const save = async (win: BrowserWindow, content: string, expectedPath?: string, rebuildMenu = false): Promise<string | null> => {
    const state = getState(win)
    const sourcePath = state.filePath
    if (expectedPath && sourcePath !== expectedPath) return null
    let filePath = sourcePath
    if (!filePath) {
      const result = await dialog.showSaveDialog(win, {
        defaultPath: suggestSavePath(win, suggestFileName(win, content)),
        filters: [
          { name: t(deps.locale(), 'filter.markdown'), extensions: ['md'] },
          { name: t(deps.locale(), 'filter.allFiles'), extensions: ['*'] },
        ],
      })
      if (result.canceled || !result.filePath) return null
      filePath = result.filePath
    }
    return await saveToPath(win, filePath, content, sourcePath, rebuildMenu) ? filePath : null
  }

  const saveAs = async (win: BrowserWindow, content: string, expectedPath?: string): Promise<string | null> => {
    const sourcePath = getState(win).filePath
    if (expectedPath && sourcePath !== expectedPath) return null
    const result = await dialog.showSaveDialog(win, {
      defaultPath: suggestSavePath(win, suggestFileName(win, content)),
      filters: [
        { name: t(deps.locale(), 'filter.markdown'), extensions: ['md'] },
        { name: t(deps.locale(), 'filter.allFiles'), extensions: ['*'] },
      ],
    })
    if (result.canceled || !result.filePath) return null
    return await saveToPath(win, result.filePath, content, sourcePath, true) ? result.filePath : null
  }

  type ConfirmationOutcome = 'saved' | 'discarded' | 'cancelled'

  const handleWindowClose = async (win: BrowserWindow, state: WindowState): Promise<ConfirmationOutcome> => {
    if (!state.rendererReady && !state.dirty) return 'saved'
    const snapshot = await requestDocumentState(win)
    if (!snapshot) {
      if (!state.dirty) return 'saved'
      const { response } = await dialog.showMessageBox(win, {
        type: 'warning', buttons: [t(deps.locale(), 'close.force'), t(deps.locale(), 'common.cancel')],
        defaultId: 1, cancelId: 1, message: t(deps.locale(), 'close.unresponsiveTitle'),
        detail: t(deps.locale(), 'close.unresponsiveDetail'),
      })
      return response === 0 ? 'discarded' : 'cancelled'
    }
    state.dirty = snapshot.dirty
    if (!snapshot.dirty) return 'saved'
    const locale = deps.locale()
    const detail = state.filePath
      ? t(locale, 'close.unsavedFile', { name: basename(state.filePath) })
      : t(locale, 'close.unsavedUntitled')
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning', buttons: [t(locale, 'common.save'), t(locale, 'common.dontSave'), t(locale, 'common.cancel')],
      defaultId: 0, cancelId: 2, message: t(locale, 'close.unsavedTitle'), detail,
    })
    if (response === 2) return 'cancelled'
    if (response === 1) {
      state.dirty = false
      return 'discarded'
    }
    const saved = await save(win, snapshot.content, state.filePath ?? undefined, true)
    if (!saved) {
      await dialog.showMessageBox(win, {
        type: 'error', buttons: [t(locale, 'common.ok')], message: t(locale, 'close.saveFailedTitle'),
        detail: t(locale, 'close.saveFailedDetail'),
      })
      return 'cancelled'
    }
    state.dirty = false
    return 'saved'
  }

  const confirmWindowClose = (win: BrowserWindow, state: WindowState): Promise<ConfirmationOutcome> => {
    if (!state.closePromise) {
      state.closePromise = handleWindowClose(win, state).finally(() => { state.closePromise = null })
    }
    return state.closePromise
  }

  let manager: WindowManager
  const createWindow = (filePath?: string, initialContent?: string, initialBrowsePath?: string): BrowserWindow => {
    const win = new BrowserWindow({
      width: 960, height: 720, minWidth: 600, minHeight: 400,
      titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 14 },
      webPreferences: {
        preload: deps.preloadPath, contextIsolation: true, nodeIntegration: false,
        sandbox: true, spellcheck: false,
      },
    })
    deps.onStartupMark?.('window-created')
    const state = getState(win)
    if (initialBrowsePath) state.browsePath = initialBrowsePath
    if (deps.rendererURL) void win.loadURL(deps.rendererURL)
    else void win.loadFile(deps.rendererPath)
    win.webContents.on('did-finish-load', () => {
      deps.onStartupMark?.('renderer-loaded')
      sendEvent(win, 'app-bootstrap', { locale: deps.locale(), platform: 'darwin', appVersion: deps.appVersion(), databaseWarning: deps.databaseWarning() })
      if (filePath) void loadFileInWindow(win, filePath)
      else if (initialContent) sendEvent(win, 'file-opened', { path: null, content: initialContent, version: null })
    })
    win.on('close', (event) => {
      const current = getState(win)
      if (isQuitting || current.closeAuthorized || (!current.rendererReady && !current.dirty)) return
      event.preventDefault()
      void confirmWindowClose(win, current).then((outcome) => {
        if (outcome !== 'cancelled' && !win.isDestroyed()) {
          current.closeAuthorized = true
          win.close()
        }
      })
    })
    win.on('closed', () => { deps.onWindowClosed?.(win); manager.dispose(win) })
    updateTitle(win)
    return win
  }

  manager = {
    createWindow,
    async openFile(filePath, preferredWindow) {
      const existing = findWindowForFile(filePath)
      if (existing) { existing.focus(); return }
      const preferredState = preferredWindow ? getState(preferredWindow) : null
      const empty = preferredState && !preferredState.filePath ? preferredWindow! : findEmptyWindow()
      if (empty) {
        const state = getState(empty)
        const wasDirty = state.dirty
        const outcome = wasDirty ? await confirmWindowClose(empty, state) : 'saved'
        if (outcome === 'cancelled') return
        const replacementPath = state.filePath
        const replacementGeneration = state.documentGeneration
        const opened = await loadFileInWindow(empty, filePath)
        if (!opened && outcome === 'discarded' && state.filePath === replacementPath && state.documentGeneration === replacementGeneration) {
          state.dirty = true
        }
        empty.focus()
        return
      }
      createWindow(filePath).focus()
    },
    loadFileInWindow,
    async prepareForWorkspace(win, rootPath) {
      const state = getState(win)
      if (state.filePath) {
        const pathFromRoot = relative(rootPath, state.filePath)
        const withinWorkspace = pathFromRoot !== ''
          && pathFromRoot !== '..'
          && !pathFromRoot.startsWith(`..${sep}`)
          && !isAbsolute(pathFromRoot)
        if (withinWorkspace) return true
      }
      if (state.dirty && await confirmWindowClose(win, state) === 'cancelled') return false
      deps.watchService.stop(win)
      state.filePath = null
      state.browsePath = null
      state.version = null
      state.dirty = false
      state.documentGeneration += 1
      state.pendingExternalDocument = null
      updateTitle(win)
      sendEvent(win, 'file-opened', { path: null, content: '', version: null })
      return true
    },
    getState,
    listSiblings(win) {
      const state = getState(win)
      return listSiblingFiles(state.filePath, state.browsePath ?? undefined)
    },
    async openSibling(win, filePath) {
      try {
        if ((await deps.stat(filePath)).isDirectory()) {
          const state = getState(win)
          state.browsePath = filePath
          deps.watchService.updateBrowsePath(win, filePath)
          sendEvent(win, 'siblings-changed', await listSiblingFiles(state.filePath, filePath))
          return true
        }
      } catch {
        return false
      }
      void loadFileInWindow(win, filePath)
      return true
    },
    save,
    saveAs,
    async reportExternalConflict(win) {
      const state = getState(win)
      const filePath = state.filePath
      const reviewedDisk = state.pendingExternalDocument
      const choice = await dialog.showMessageBox(win, {
        type: 'warning', buttons: [t(deps.locale(), 'conflict.keepMine'), t(deps.locale(), 'conflict.loadDisk')],
        defaultId: 0, cancelId: 0, message: t(deps.locale(), 'conflict.title'), detail: t(deps.locale(), 'conflict.detail'),
      })
      if (win.isDestroyed()) return
      let disk = reviewedDisk
      if (!disk && filePath) {
        try {
          disk = await deps.snapshotLoader.loadSnapshot(filePath)
        } catch {
          // Keep local content if disk cannot be read.
        }
      }
      if (disk && filePath) {
        // Apply the chosen disk generation only after the user decides. Keep
        // uses this version so the resumed autosave can intentionally replace it.
        state.version = disk.version
        if (state.pendingExternalDocument?.version === disk.version) state.pendingExternalDocument = null
        deps.watchService.setKnownSourceContent(win, disk.sourceContent)
        if (choice.response === 1) {
          sendEvent(win, 'external-conflict-result', { action: 'load', content: disk.content })
        } else {
          sendEvent(win, 'external-conflict-result', { action: 'keep' })
        }
      } else {
        sendEvent(win, 'external-conflict-result', { action: 'keep' })
      }
      const newerDisk = state.pendingExternalDocument
      if (filePath && newerDisk && newerDisk.version !== disk?.version) {
        // IPC ordering ensures the reviewed result is applied first. Replay the
        // newer staged generation so a clean renderer can adopt it, or a dirty
        // renderer can open a fresh conflict instead of silently going stale.
        sendEvent(win, 'document-snapshot-changed', {
          path: filePath, content: newerDisk.content, version: newerDisk.version,
        })
      }
    },
    stageExternalDocument(win, path, snapshot) {
      const state = getState(win)
      if (state.filePath === path) state.pendingExternalDocument = snapshot
    },
    acknowledgeExternalVersion(win, path, version) {
      const state = getState(win)
      const pending = state.pendingExternalDocument
      if (state.filePath !== path || !pending || pending.version !== version) return
      state.version = version
      state.pendingExternalDocument = null
      deps.watchService.setKnownSourceContent(win, pending.sourceContent)
    },
    respondDocumentState(event, requestId, snapshot) {
      const pending = pendingDocumentStateRequests.get(requestId)
      if (!pending || pending.webContentsId !== event.sender.id) return
      pendingDocumentStateRequests.delete(requestId)
      clearTimeout(pending.timer)
      pending.resolve(snapshot)
    },
    setRendererReady(win) {
      getState(win).rendererReady = true
      deps.onRendererReady?.()
    },
    setDirty(win, dirty) { getState(win).dirty = dirty },
    async confirmAllWindowsClose() {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed() && await confirmWindowClose(win, getState(win)) === 'cancelled') return false
      }
      return true
    },
    setQuitting(quitting) { isQuitting = quitting },
    dispose(win) {
      deps.watchService.stop(win)
      states.delete(win.id)
    },
  }
  return manager
}
