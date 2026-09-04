import '../shared/zod-jitless'
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import {
  IpcEventSchemas,
  IpcInvokeSchemas,
  IpcSendSchemas,
  MAX_SAVE_STREAM_LENGTH,
  SAVE_STREAM_CHUNK_LENGTH,
  type DraftMDAPI,
  type IpcEventMap,
  type IpcInvokeMap,
  type IpcSendMap,
  type Unsubscribe,
} from '../shared/contracts'

export type { DraftMDAPI, SiblingFile } from '../shared/contracts'

type InvokeChannel = keyof IpcInvokeMap
type SendChannel = keyof IpcSendMap
type EventChannel = keyof IpcEventMap

function contractError(channel: string): Error {
  return new Error(`IPC contract violation: ${channel}`)
}

async function invoke<Channel extends InvokeChannel>(
  channel: Channel,
  ...args: IpcInvokeMap[Channel]['args']
): Promise<IpcInvokeMap[Channel]['result']> {
  const schema = IpcInvokeSchemas[channel]
  const parsedArgs = schema.args.safeParse(args)
  if (!parsedArgs.success) throw contractError(channel)
  const result: unknown = await ipcRenderer.invoke(channel, ...parsedArgs.data)
  const parsedResult = schema.result.safeParse(result)
  if (!parsedResult.success) throw contractError(channel)
  return parsedResult.data as IpcInvokeMap[Channel]['result']
}

function send<Channel extends SendChannel>(channel: Channel, ...args: IpcSendMap[Channel]): void {
  const parsed = IpcSendSchemas[channel].safeParse(args)
  if (!parsed.success) {
    console.error(`[DraftMD IPC] Invalid send payload: ${channel}`)
    return
  }
  ipcRenderer.send(channel, ...parsed.data)
}

function parseEvent<Channel extends EventChannel>(
  channel: Channel,
  args: unknown[],
): IpcEventMap[Channel] | null {
  const parsed = IpcEventSchemas[channel].safeParse(args)
  if (!parsed.success) {
    console.error(`[DraftMD IPC] Invalid event payload: ${channel}`)
    return null
  }
  return parsed.data as IpcEventMap[Channel]
}

function subscribe<Channel extends EventChannel>(
  channel: Channel,
  callback: (...args: IpcEventMap[Channel]) => void,
): Unsubscribe {
  const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]): void => {
    const parsed = parseEvent(channel, args)
    if (parsed) callback(...parsed)
  }
  ipcRenderer.on(channel, listener)
  let active = true
  return () => {
    if (!active) return
    active = false
    ipcRenderer.removeListener(channel, listener)
  }
}

function createBufferedEvent<Channel extends 'app-bootstrap' | 'file-opened' | 'workspace:opened' | 'open-provider-settings'>(channel: Channel): {
  subscribe(callback: (...args: IpcEventMap[Channel]) => void): Unsubscribe
} {
  const pending: IpcEventMap[Channel][] = []
  let buffering = true
  const earlyListener = (_event: Electron.IpcRendererEvent, ...args: unknown[]): void => {
    const parsed = parseEvent(channel, args)
    if (parsed) pending.push(parsed)
  }
  ipcRenderer.on(channel, earlyListener)

  return {
    subscribe(callback) {
      const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]): void => {
        const parsed = parseEvent(channel, args)
        if (parsed) callback(...parsed)
      }
      ipcRenderer.on(channel, listener)
      if (buffering) {
        buffering = false
        ipcRenderer.removeListener(channel, earlyListener)
        for (const args of pending.splice(0)) callback(...args)
      }
      let active = true
      return () => {
        if (!active) return
        active = false
        ipcRenderer.removeListener(channel, listener)
      }
    },
  }
}

// These listeners must exist as preload starts: main can send bootstrap and
// initial content before the renderer has registered its callbacks.
const appBootstrap = createBufferedEvent('app-bootstrap')
const fileOpened = createBufferedEvent('file-opened')
const workspaceOpened = createBufferedEvent('workspace:opened')
const openProviderSettings = createBufferedEvent('open-provider-settings')

const SAVE_STREAM_THRESHOLD = 1024 * 1024

async function saveContent(
  mode: 'save' | 'save-as',
  content: string,
  expectedPath?: string,
  rebuildMenu = false,
): Promise<string | null> {
  if (content.length < SAVE_STREAM_THRESHOLD) {
    return mode === 'save'
      ? invoke('save-file', content, expectedPath, rebuildMenu)
      : invoke('save-file-as', content, expectedPath)
  }
  if (content.length > MAX_SAVE_STREAM_LENGTH) throw contractError('save-stream-begin')
  const uploadId = await invoke('save-stream-begin', { mode, totalLength: content.length, expectedPath, rebuildMenu })
  let index = 0
  for (let offset = 0; offset < content.length; offset += SAVE_STREAM_CHUNK_LENGTH) {
    const accepted = await invoke('save-stream-chunk', uploadId, index, content.slice(offset, offset + SAVE_STREAM_CHUNK_LENGTH))
    if (!accepted) throw contractError('save-stream-chunk')
    index += 1
  }
  return invoke('save-stream-commit', uploadId)
}

export const draftmd: DraftMDAPI = {
  onAppBootstrap: (callback) => appBootstrap.subscribe(callback),
  getSessionHistory: (sessionId) => invoke('session-history', sessionId),
  listSessions: (workspaceId) => invoke('session-list', workspaceId),
  createSession: (session) => invoke('session-create', session),
  renameSession: (session) => invoke('session-rename', session),
  deleteSession: (id) => invoke('session-delete', id),
  switchSessionModel: (input) => invoke('session-switch-model', input),
  startAgentTask: (input) => invoke('agent-start', input),
  getAgentTaskChanges: (id) => invoke('agent-task-changes', id),
  undoAgentTask: (id) => invoke('agent-task-undo', id),
  stopAgentTask: (id) => invoke('agent-stop', id),
  respondToAgentApproval: (decision) => invoke('agent-respond-approval', decision),
  listInterruptedTasks: () => invoke('agent-list-interrupted'),
  keepInterruptedTask: (id) => invoke('agent-keep-interrupted', id),
  undoInterruptedTask: (id) => invoke('agent-undo-interrupted', id),
  listProviderConfigs: () => invoke('provider-list'),
  saveProviderConfig: (config, secrets) => invoke('provider-save', config, secrets),
  testProviderConfig: (id) => invoke('provider-test', id),
  setDefaultProvider: (id) => invoke('provider-set-default', id),
  deleteProviderConfig: (id, deleteSecrets) => invoke('provider-delete', id, deleteSecrets),
  currentDocumentVersion: () => invoke('current-document-version'),
  openWorkspace: () => invoke('open-workspace'),
  listWorkspaceFiles: (directory) => invoke('list-workspace-files', directory),
  openWorkspaceFile: (path) => invoke('open-workspace-file', path),
  openFile: () => invoke('open-file'),
  openFilePath: (path) => invoke('open-file-path', path),
  listSiblings: () => invoke('list-siblings'),
  openSibling: (path) => invoke('open-sibling', path),
  saveFile: (content, expectedPath?, rebuildMenu?) => saveContent('save', content, expectedPath, rebuildMenu),
  saveFileAs: (content, expectedPath?) => saveContent('save-as', content, expectedPath),
  exportPDF: () => invoke('export-pdf'),
  exportHTML: (snapshot) => invoke('export-html', snapshot),
  reportTheme: (theme) => invoke('report-theme', theme),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  openExternal: (url) => send('open-external', url),
  onFileChanged: (callback) => subscribe('file-changed', callback),
  onDocumentSnapshotChanged: (callback) => subscribe('document-snapshot-changed', callback),
  onAutosaveRetryPaused: (callback) => subscribe('autosave-retry-paused', callback),
  onFileOpened: (callback) => fileOpened.subscribe(callback),
  onWorkspaceOpened: (callback) => workspaceOpened.subscribe(callback),
  onWorkspaceFilesChanged: (callback) => subscribe('workspace:files-changed', callback),
  onMenuOpen: (callback) => subscribe('menu-open', callback),
  onMenuSave: (callback) => subscribe('menu-save', callback),
  onMenuSaveAs: (callback) => subscribe('menu-save-as', callback),
  onMenuExportPDF: (callback) => subscribe('menu-export-pdf', callback),
  onMenuExportHTML: (callback) => subscribe('menu-export-html', callback),
  onSetTheme: (callback) => subscribe('set-theme', callback),
  onAgentTaskEvent: (callback) => subscribe('agent-task-event', callback),
  onAgentActivity: (callback) => subscribe('agent-activity', callback),
  onSearch: (callback) => subscribe('editor:search', callback),
  onMathModal: (callback) => subscribe('editor:math', callback),
  onSiblingsChanged: (callback) => subscribe('siblings-changed', callback),
  onFocusAgentDock: (callback) => subscribe('focus-agent-dock', callback),
  onToggleFilePanel: (callback) => subscribe('toggle-file-panel', callback),
  onToggleSourceMode: (callback) => subscribe('toggle-source-mode', callback),
  setAppLocale: (locale) => invoke('set-app-locale', locale),
  setEditorFont: (prefs) => invoke('set-editor-font', prefs),
  listSystemFonts: () => invoke('list-system-fonts'),
  onEditorFontChanged: (callback) => subscribe('editor-font-changed', callback),
  onOpenDiagnostics: (callback) => subscribe('open-diagnostics', callback),
  onOpenOnboarding: (callback) => subscribe('open-onboarding', callback),
  onOpenProviderSettings: (callback) => openProviderSettings.subscribe(callback),
  onOpenFontSettings: (callback) => subscribe('open-font-settings', callback),
  reportExternalConflict: () => invoke('report-external-conflict'),
  onExternalConflictResult: (callback) => subscribe('external-conflict-result', callback),
  onUpdateAvailable: (callback) => subscribe('update-available', callback),
  onUpdateDownloaded: (callback) => subscribe('update-downloaded', callback),
  previewDiagnostics: () => invoke('diagnostics-preview'),
  exportDiagnostics: () => invoke('diagnostics-export'),
  downloadUpdate: () => invoke('download-update'),
  installUpdate: () => invoke('install-update'),
  reportDirty: (isDirty) => send('set-dirty', isDirty),
  reportRendererReady: () => send('renderer-ready'),
  acknowledgeExternalVersion: (path, version) => send('acknowledge-external-version', path, version),
  onRequestDocumentState: (callback) => subscribe('request-document-state', callback),
  respondDocumentState: (requestId, snapshot) => send('document-state-response', requestId, snapshot),
}

contextBridge.exposeInMainWorld('draftmd', draftmd)
