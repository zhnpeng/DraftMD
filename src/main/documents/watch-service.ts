import { basename, dirname, extname } from 'node:path'
import type { BrowserWindow } from 'electron'
import type { FSWatcher, WatchListener } from 'node:fs'
import type { DocumentDiskSnapshot } from './document-service'
import { IpcEventSchemas } from '../../shared/contracts'
import type { SiblingFile } from '../../shared/contracts'

const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdown', '.mkd']
type AgentState = 'idle' | 'active' | 'cooldown'

interface WriteSuppression {
  count: number
  eventDuringSuppression: boolean
  reconcile: (() => void) | null
}

interface WatchedDocument {
  watcher: FSWatcher | null
  browseWatcher: FSWatcher | null
  filePath: string
  browsePath: string
  suppression: WriteSuppression
  lastInternalSaveContent: string | null
  debounceTimer: ReturnType<typeof setTimeout> | null
  establishmentTimer: ReturnType<typeof setTimeout> | null
  watcherGeneration: number
  browseGeneration: number
  siblingsRequestGeneration: number
  reloadGeneration: number
  siblingsTimer: ReturnType<typeof setTimeout> | null
  agentState: AgentState
  lastExternalChange: number
  agentCooldownTimer: ReturnType<typeof setTimeout> | null
}

export interface WatchService {
  watch(win: BrowserWindow, input: { filePath: string; browsePath: string; knownSourceContent?: string }): void
  stop(win: BrowserWindow): void
  beginInternalWrite(win: BrowserWindow): () => void
  setKnownSourceContent(win: BrowserWindow, content: string): void
  updateBrowsePath(win: BrowserWindow, browsePath: string): void
}

export interface WatchServiceDeps {
  watch(path: string, listener: WatchListener<string>): FSWatcher
  readFile(path: string, encoding: BufferEncoding): Promise<string>
  existsSync(path: string): boolean
  listSiblings(filePath: string, browsePath: string): Promise<SiblingFile[]>
  loadDocument(path: string): Promise<DocumentDiskSnapshot>
  onExternalDocument(win: BrowserWindow, path: string, document: DocumentDiskSnapshot): void
  send(win: BrowserWindow, channel: 'file-changed', content: string): void
  send(win: BrowserWindow, channel: 'document-snapshot-changed', change: { path: string; content: string; version: string }): void
  send(win: BrowserWindow, channel: 'agent-activity', state: AgentState): void
  send(win: BrowserWindow, channel: 'siblings-changed', files: SiblingFile[]): void
  now?: () => number
  setTimeout?: typeof globalThis.setTimeout
  clearTimeout?: typeof globalThis.clearTimeout
}

export function createWatchService(deps: WatchServiceDeps): WatchService {
  const states = new Map<number, WatchedDocument>()
  const suppressions = new Map<number, WriteSuppression>()
  const now = deps.now ?? Date.now
  const schedule = deps.setTimeout ?? globalThis.setTimeout
  const cancel = deps.clearTimeout ?? globalThis.clearTimeout
  const send = (win: BrowserWindow, channel: keyof typeof IpcEventSchemas, ...args: unknown[]): void => {
    const parsed = IpcEventSchemas[channel].safeParse(args)
    if (parsed.success && !win.isDestroyed()) {
      ;(deps.send as (target: BrowserWindow, event: string, ...payload: unknown[]) => void)(win, channel, ...parsed.data)
    }
  }
  const suppressionFor = (win: BrowserWindow): WriteSuppression => {
    let suppression = suppressions.get(win.id)
    if (!suppression) {
      suppression = { count: 0, eventDuringSuppression: false, reconcile: null }
      suppressions.set(win.id, suppression)
    }
    return suppression
  }
  const closeWatcher = (state: WatchedDocument): void => {
    state.watcher?.close()
    state.browseWatcher?.close()
    state.watcher = null
    state.browseWatcher = null
  }
  const clearDocumentTimers = (state: WatchedDocument): void => {
    if (state.debounceTimer) cancel(state.debounceTimer)
    if (state.establishmentTimer) cancel(state.establishmentTimer)
    if (state.siblingsTimer) cancel(state.siblingsTimer)
    if (state.agentCooldownTimer) cancel(state.agentCooldownTimer)
    state.debounceTimer = null
    state.establishmentTimer = null
    state.siblingsTimer = null
    state.agentCooldownTimer = null
  }
  const resetForRetarget = (win: BrowserWindow, nextPath: string): WriteSuppression => {
    const previous = states.get(win.id)
    if (!previous) return suppressionFor(win)
    closeWatcher(previous)
    clearDocumentTimers(previous)
    if (previous.agentState !== 'idle') send(win, 'agent-activity', 'idle')
    states.delete(win.id)
    if (previous.filePath === nextPath) return previous.suppression
    const suppression = { count: 0, eventDuringSuppression: false, reconcile: null }
    suppressions.set(win.id, suppression)
    return suppression
  }
  const stop = (win: BrowserWindow): void => {
    const state = states.get(win.id)
    if (state) {
      closeWatcher(state)
      clearDocumentTimers(state)
      if (state.agentState !== 'idle') send(win, 'agent-activity', 'idle')
      states.delete(win.id)
    }
    suppressions.delete(win.id)
  }
  const transitionAgentState = (win: BrowserWindow, state: WatchedDocument, next: AgentState): void => {
    if (state.agentCooldownTimer) cancel(state.agentCooldownTimer)
    state.agentCooldownTimer = null
    state.agentState = next
    send(win, 'agent-activity', next)
    if (next === 'active') state.agentCooldownTimer = schedule(() => transitionAgentState(win, state, 'cooldown'), 3000)
    else if (next === 'cooldown') state.agentCooldownTimer = schedule(() => transitionAgentState(win, state, 'idle'), 2000)
  }
  const watchDocument = (win: BrowserWindow, input: { filePath: string; browsePath: string; knownSourceContent?: string }): void => {
    const suppression = resetForRetarget(win, input.filePath)
    suppressions.set(win.id, suppression)
    const state: WatchedDocument = {
      watcher: null, browseWatcher: null, filePath: input.filePath, browsePath: input.browsePath, suppression,
      lastInternalSaveContent: input.knownSourceContent ?? null, debounceTimer: null, establishmentTimer: null, watcherGeneration: 0, browseGeneration: 0, siblingsRequestGeneration: 0, reloadGeneration: 0, siblingsTimer: null,
      agentState: 'idle', lastExternalChange: 0, agentCooldownTimer: null,
    }
    states.set(win.id, state)
    if (input.knownSourceContent === undefined) {
      void deps.readFile(input.filePath, 'utf-8').then((content) => {
        if (states.get(win.id) === state && state.lastInternalSaveContent === null) state.lastInternalSaveContent = content
      }).catch(() => {})
    }
    const filePath = input.filePath
    const dir = dirname(filePath)
    const fileName = basename(filePath)
    let suppressUntil = 0
    const scheduleReload = (): void => {
      const generation = ++state.reloadGeneration
      if (state.debounceTimer) cancel(state.debounceTimer)
      state.debounceTimer = schedule(() => {
        state.debounceTimer = null
        void (async () => {
          const loaded = await deps.loadDocument(filePath)
          if (states.get(win.id) !== state || generation !== state.reloadGeneration) return
          if (state.lastInternalSaveContent !== null && loaded.sourceContent === state.lastInternalSaveContent) return
          state.lastInternalSaveContent = null
          deps.onExternalDocument(win, filePath, loaded)
          send(win, 'file-changed', loaded.content)
          send(win, 'document-snapshot-changed', { path: filePath, content: loaded.content, version: loaded.version })
        })().catch(() => {})
      }, 100)
    }
    const reconcileSuppressedEvent = (): void => {
      if (!state.suppression.eventDuringSuppression || states.get(win.id) !== state) return
      if (state.suppression.count > 0) return
      const remaining = suppressUntil - now()
      if (remaining > 0) {
        if (state.establishmentTimer) cancel(state.establishmentTimer)
        const generation = state.watcherGeneration
        state.establishmentTimer = schedule(() => {
          state.establishmentTimer = null
          if (states.get(win.id) === state && state.watcherGeneration === generation) reconcileSuppressedEvent()
        }, remaining)
        return
      }
      state.suppression.eventDuringSuppression = false
      scheduleReload()
    }
    state.suppression.reconcile = reconcileSuppressedEvent
    const onExternalChange = (): void => {
      if (state.suppression.count > 0 || now() < suppressUntil) {
        state.suppression.eventDuringSuppression = true
        reconcileSuppressedEvent()
        return
      }
      const changedAt = now()
      const gap = changedAt - state.lastExternalChange
      state.lastExternalChange = changedAt
      if ((gap > 0 && gap < 2000) || state.agentState === 'active') transitionAgentState(win, state, 'active')
      scheduleReload()
    }
    const scheduleSiblingsRefresh = (isActiveWatcher: () => boolean): void => {
      if (state.siblingsTimer) cancel(state.siblingsTimer)
      const browsePath = state.browsePath
      const browseGeneration = state.browseGeneration
      const requestGeneration = ++state.siblingsRequestGeneration
      const isCurrent = (): boolean => states.get(win.id) === state
        && state.browsePath === browsePath
        && state.browseGeneration === browseGeneration
        && state.siblingsRequestGeneration === requestGeneration
        && isActiveWatcher()
      state.siblingsTimer = schedule(() => {
        state.siblingsTimer = null
        if (!isCurrent()) return
        void deps.listSiblings(filePath, browsePath).then((files) => {
          if (isCurrent()) send(win, 'siblings-changed', files)
        })
      }, 300)
    }
    const watchBrowseDirectory = (): void => {
      state.browseWatcher?.close()
      state.browseWatcher = null
      state.browseGeneration += 1
      if (state.browsePath === dir) return
      const browsePath = state.browsePath
      const browseGeneration = state.browseGeneration
      try {
        const watcher = deps.watch(browsePath, (_eventType, filename) => {
          if (states.get(win.id) !== state || state.browsePath !== browsePath || state.browseGeneration !== browseGeneration || state.browseWatcher !== watcher) return
          const changedName = filename?.toString() ?? null
          if (changedName === null || MARKDOWN_EXTENSIONS.includes(extname(changedName).toLowerCase())) {
            scheduleSiblingsRefresh(() => state.browseWatcher === watcher)
          }
        })
        watcher.on('error', () => {
          if (states.get(win.id) !== state || state.browsePath !== browsePath || state.browseGeneration !== browseGeneration || state.browseWatcher !== watcher) return
          state.browseWatcher = null
          state.browseGeneration += 1
          state.siblingsRequestGeneration += 1
          if (state.siblingsTimer) cancel(state.siblingsTimer)
          state.siblingsTimer = null
          watcher.close()
        })
        state.browseWatcher = watcher
      } catch {}
    }
    const establish = (): void => {
      if (states.get(win.id) !== state) return
      suppressUntil = now() + 300
      state.watcherGeneration += 1
      if (state.establishmentTimer) cancel(state.establishmentTimer)
      state.establishmentTimer = null
      closeWatcher(state)
      watchBrowseDirectory()
      const watcherGeneration = state.watcherGeneration
      try {
        const watcher = deps.watch(dir, (eventType, filename) => {
          if (states.get(win.id) !== state || state.watcherGeneration !== watcherGeneration) return
          const changedName = filename?.toString() ?? null
          if (changedName !== null && changedName !== fileName) {
            if (state.browsePath === dir && MARKDOWN_EXTENSIONS.includes(extname(changedName).toLowerCase())) {
              scheduleSiblingsRefresh(() => state.watcher === watcher && state.watcherGeneration === watcherGeneration)
            }
            return
          }
          if (eventType === 'rename') {
            onExternalChange()
            if (changedName === fileName && deps.existsSync(filePath)) establish()
          } else if (eventType === 'change') onExternalChange()
        })
        watcher.on('error', () => {
          if (states.get(win.id) === state && state.watcherGeneration === watcherGeneration) establish()
        })
        state.watcher = watcher
      } catch {
        try {
          const watcher = deps.watch(filePath, (eventType) => {
            if (states.get(win.id) !== state || state.watcherGeneration !== watcherGeneration) return
            if (eventType === 'change') onExternalChange()
          })
          watcher.on('error', () => {
            if (states.get(win.id) === state && state.watcherGeneration === watcherGeneration) establish()
          })
          state.watcher = watcher
        } catch {}
      }
      reconcileSuppressedEvent()
    }
    establish()
  }
  return {
    watch: watchDocument,
    stop,
    beginInternalWrite(win) {
      const suppression = suppressionFor(win)
      suppression.count += 1
      let released = false
      return () => {
        if (released) return
        released = true
        schedule(() => {
          suppression.count = Math.max(0, suppression.count - 1)
          if (suppression.count === 0 && suppression.eventDuringSuppression) suppression.reconcile?.()
        }, 100)
      }
    },
    updateBrowsePath(win, browsePath) {
      const state = states.get(win.id)
      if (!state || state.browsePath === browsePath) return
      state.browsePath = browsePath
      state.browseWatcher?.close()
      state.browseWatcher = null
      state.browseGeneration += 1
      const browseGeneration = state.browseGeneration
      const documentDir = dirname(state.filePath)
      if (browsePath === documentDir) return
      try {
        const watcher = deps.watch(browsePath, (_eventType, filename) => {
          if (states.get(win.id) !== state || state.browsePath !== browsePath || state.browseGeneration !== browseGeneration || state.browseWatcher !== watcher) return
          const changedName = filename?.toString() ?? null
          if (changedName === null || MARKDOWN_EXTENSIONS.includes(extname(changedName).toLowerCase())) {
            if (state.siblingsTimer) cancel(state.siblingsTimer)
            const requestGeneration = ++state.siblingsRequestGeneration
            const isCurrent = (): boolean => states.get(win.id) === state
              && state.browsePath === browsePath
              && state.browseGeneration === browseGeneration
              && state.siblingsRequestGeneration === requestGeneration
              && state.browseWatcher === watcher
            state.siblingsTimer = schedule(() => {
              state.siblingsTimer = null
              if (!isCurrent()) return
              void deps.listSiblings(state.filePath, browsePath).then((files) => {
                if (isCurrent()) send(win, 'siblings-changed', files)
              })
            }, 300)
          }
        })
        watcher.on('error', () => {
          if (states.get(win.id) !== state || state.browsePath !== browsePath || state.browseGeneration !== browseGeneration || state.browseWatcher !== watcher) return
          state.browseWatcher = null
          state.browseGeneration += 1
          state.siblingsRequestGeneration += 1
          if (state.siblingsTimer) cancel(state.siblingsTimer)
          state.siblingsTimer = null
          watcher.close()
        })
        state.browseWatcher = watcher
      } catch {}
    },
    setKnownSourceContent(win, content) {
      const state = states.get(win.id)
      if (state) state.lastInternalSaveContent = content
    },
  }
}
