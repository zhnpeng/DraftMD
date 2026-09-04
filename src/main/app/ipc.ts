import { BrowserWindow, dialog, ipcMain, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { MAX_SAVE_STREAM_LENGTH, SAVE_STREAM_CHUNK_LENGTH } from '../../shared/contracts/ipc'
import { basename, dirname, join } from 'node:path'
import type { WindowManager } from './window-manager'
import type { WorkspaceManager } from '../workspace/workspace-manager'
import type { DiagnosticsBundle } from '../../shared/contracts/diagnostics'
import type { InterruptedTaskSummaryDTO } from '../../shared/contracts/agent'
import type { CapabilityTestResult, ProviderConfigDTO, ProviderConfigInput, ProviderSecretsInput } from '../../shared/contracts/provider'
import { exportPDF } from '../export/pdf'
import { exportHTML, type HtmlExportSnapshot } from '../export/html'
import { IpcEventSchemas, IpcInvokeSchemas, IpcSendSchemas, type IpcInvokeMap, type IpcSendMap } from '../../shared/contracts'
import { t, type Locale } from '../../shared/i18n'

export interface IpcRegistrationDeps {
  windowManager: WindowManager
  workspaceManager: WorkspaceManager
  providerConfigService: {
    listConfigs(): ProviderConfigDTO[]
    saveConfig(input: ProviderConfigInput, secrets: ProviderSecretsInput): Promise<ProviderConfigDTO>
    setDefault(id: string): void
    deleteConfig(id: string, deleteSecrets: boolean): Promise<boolean>
  }
  testProvider(id: string, signal: AbortSignal): Promise<CapabilityTestResult>
  agentSessionService: {
    sessionHistory(win: BrowserWindow, sessionId: string): unknown
    listSessions(win: BrowserWindow, workspaceId: string): unknown[]
    createSession(win: BrowserWindow, input: { workspaceId: string; title: string }): unknown
    renameSession(win: BrowserWindow, input: { id: string; title: string }): boolean
    deleteSession(win: BrowserWindow, id: string): boolean
    switchModel(win: BrowserWindow, input: { sessionId: string; providerConfigId: string }): void
    start(win: BrowserWindow, input: any): Promise<unknown>
    stop(win: BrowserWindow, taskId: string): boolean
  }
  taskActions: {
    changes(win: BrowserWindow, taskId: string): Promise<unknown>
    undo(win: BrowserWindow, taskId: string): Promise<unknown>
  }
  agentActions: {
    respond(win: BrowserWindow, input: { taskId: string; approvalId: string; decision: 'approve' | 'deny' }): boolean
    listInterrupted(): InterruptedTaskSummaryDTO[] | Promise<InterruptedTaskSummaryDTO[]>
    keepInterrupted(id: string): boolean
    undoInterrupted(id: string): Promise<unknown>
  }
  diagnostics: {
    preview(): DiagnosticsBundle
    export(path: string): Promise<void>
  }
  locale(): Locale
  setLocale(locale: Locale): void
  writeFile(path: string, data: string | Uint8Array, encoding?: BufferEncoding): Promise<unknown>
  rebuildMenu(): void
  reportTheme(theme: string): void
  loadSystemFonts(): Promise<string[]>
  downloadUpdate(): Promise<boolean>
  installUpdate(): boolean
}

function winFromEvent(event: IpcMainInvokeEvent | IpcMainEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender)
}

function invokeHandler<Channel extends keyof typeof IpcInvokeSchemas>(
  channel: Channel,
  handler: (event: IpcMainInvokeEvent, ...args: IpcInvokeMap[Channel]['args']) => Promise<unknown> | unknown,
): void {
  ipcMain.handle(channel, async (event, ...rawArgs: unknown[]) => {
    const schema = IpcInvokeSchemas[channel]
    const args = schema.args.safeParse(rawArgs)
    if (!args.success) throw new Error(`IPC contract violation: ${channel}`)
    const result = await handler(event, ...args.data as IpcInvokeMap[Channel]['args'])
    const parsed = schema.result.safeParse(result)
    if (!parsed.success) throw new Error(`IPC contract violation: ${channel}`)
    return parsed.data
  })
}

function sendHandler<Channel extends keyof typeof IpcSendSchemas>(
  channel: Channel,
  handler: (event: IpcMainEvent, ...args: IpcSendMap[Channel]) => void,
): void {
  ipcMain.on(channel, (event, ...rawArgs: unknown[]) => {
    const parsed = IpcSendSchemas[channel].safeParse(rawArgs)
    if (!parsed.success) return
    handler(event, ...parsed.data as IpcSendMap[Channel])
  })
}

function suggestFileName(content?: string): string | undefined {
  const match = content?.match(/^#\s+(.+)/m) || content?.match(/^(.+)/m)
  return match?.[1].trim().replace(/[/\\:*?"<>|]/g, '').slice(0, 60) || undefined
}

export function registerIpcHandlers(deps: IpcRegistrationDeps): void {
  type SaveUpload = {
    id: string
    senderId: number
    mode: 'save' | 'save-as'
    totalLength: number
    expectedPath?: string
    rebuildMenu: boolean
    chunks: string[]
    receivedLength: number
    nextIndex: number
  }
  const saveUploads = new Map<number, SaveUpload>()
  const saveUploadSenders = new Set<number>()
  invokeHandler('save-stream-begin', (event, input) => {
    const id = randomUUID()
    saveUploads.set(event.sender.id, {
      id, senderId: event.sender.id, mode: input.mode, totalLength: input.totalLength,
      expectedPath: input.expectedPath, rebuildMenu: input.rebuildMenu,
      chunks: [], receivedLength: 0, nextIndex: 0,
    })
    if (!saveUploadSenders.has(event.sender.id)) {
      saveUploadSenders.add(event.sender.id)
      event.sender.once('destroyed', () => {
        saveUploads.delete(event.sender.id)
        saveUploadSenders.delete(event.sender.id)
      })
    }
    return id
  })
  invokeHandler('save-stream-chunk', (event, id, index, chunk) => {
    const upload = saveUploads.get(event.sender.id)
    if (!upload || upload.id !== id || upload.senderId !== event.sender.id || index !== upload.nextIndex
      || chunk.length > SAVE_STREAM_CHUNK_LENGTH
      || upload.receivedLength + chunk.length > upload.totalLength
      || upload.receivedLength + chunk.length > MAX_SAVE_STREAM_LENGTH) {
      saveUploads.delete(event.sender.id)
      throw new Error('Invalid save stream chunk')
    }
    upload.chunks.push(chunk)
    upload.receivedLength += chunk.length
    upload.nextIndex += 1
    return true
  })
  invokeHandler('save-stream-commit', async (event, id) => {
    const upload = saveUploads.get(event.sender.id)
    saveUploads.delete(event.sender.id)
    if (!upload || upload.id !== id || upload.senderId !== event.sender.id || upload.receivedLength !== upload.totalLength) {
      throw new Error('Incomplete save stream')
    }
    const win = winFromEvent(event)
    if (!win) throw new Error('Window unavailable')
    const content = upload.chunks.join('')
    return upload.mode === 'save'
      ? deps.windowManager.save(win, content, upload.expectedPath, upload.rebuildMenu)
      : deps.windowManager.saveAs(win, content, upload.expectedPath)
  })
  invokeHandler('diagnostics-preview', () => deps.diagnostics.preview())
  invokeHandler('diagnostics-export', async (event) => {
    const win = winFromEvent(event)
    const result = win
      ? await dialog.showSaveDialog(win, { defaultPath: 'DraftMD-diagnostics.json', filters: [{ name: 'JSON', extensions: ['json'] }] })
      : await dialog.showSaveDialog({ defaultPath: 'DraftMD-diagnostics.json', filters: [{ name: 'JSON', extensions: ['json'] }] })
    if (result.canceled || !result.filePath) return false
    await deps.diagnostics.export(result.filePath)
    return true
  })
  invokeHandler('set-app-locale', (_event, locale) => deps.setLocale(locale))
  sendHandler('open-external', (_event, url) => { void shell.openExternal(url) })
  sendHandler('set-dirty', (event, dirty) => {
    const win = winFromEvent(event)
    if (win) deps.windowManager.setDirty(win, dirty)
  })
  sendHandler('renderer-ready', (event) => {
    const win = winFromEvent(event)
    if (win) deps.windowManager.setRendererReady(win)
  })
  sendHandler('document-state-response', (event, requestId, snapshot) => {
    deps.windowManager.respondDocumentState(event, requestId, snapshot)
  })
  sendHandler('acknowledge-external-version', (event, path, version) => {
    const win = winFromEvent(event)
    if (win) deps.windowManager.acknowledgeExternalVersion(win, path, version)
  })

  invokeHandler('session-history', (event, sessionId) => { const win = winFromEvent(event); if (!win) throw new Error('Window unavailable'); return deps.agentSessionService.sessionHistory(win, sessionId) })
  invokeHandler('session-list', (event, workspaceId) => { const win = winFromEvent(event); return win ? deps.agentSessionService.listSessions(win, workspaceId) : [] })
  invokeHandler('session-create', (event, input) => { const win = winFromEvent(event); if (!win) throw new Error('Window unavailable'); return deps.agentSessionService.createSession(win, input) })
  invokeHandler('session-rename', (event, input) => { const win = winFromEvent(event); return win ? deps.agentSessionService.renameSession(win, input) : false })
  invokeHandler('session-delete', (event, id) => { const win = winFromEvent(event); return win ? deps.agentSessionService.deleteSession(win, id) : false })
  invokeHandler('session-switch-model', (event, input) => { const win = winFromEvent(event); if (win) deps.agentSessionService.switchModel(win, input) })
  invokeHandler('agent-start', (event, input) => { const win = winFromEvent(event); if (!win) throw new Error('Window unavailable'); return deps.agentSessionService.start(win, input) })
  invokeHandler('agent-task-changes', (event, id) => { const win = winFromEvent(event); if (!win) throw new Error('Window unavailable'); return deps.taskActions.changes(win, id) })
  invokeHandler('agent-task-undo', (event, id) => { const win = winFromEvent(event); if (!win) throw new Error('Window unavailable'); return deps.taskActions.undo(win, id) })
  invokeHandler('agent-stop', (event, id) => { const win = winFromEvent(event); return win ? deps.agentSessionService.stop(win, id) : false })
  invokeHandler('agent-respond-approval', (event, decision) => {
    const win = winFromEvent(event)
    return win ? deps.agentActions.respond(win, decision) : false
  })
  invokeHandler('agent-list-interrupted', () => deps.agentActions.listInterrupted())
  invokeHandler('agent-keep-interrupted', (_event, id) => deps.agentActions.keepInterrupted(id))
  invokeHandler('agent-undo-interrupted', (_event, id) => deps.agentActions.undoInterrupted(id))
  invokeHandler('provider-list', () => deps.providerConfigService.listConfigs())
  invokeHandler('provider-save', async (_event, config, secrets) => {
    const saved = await deps.providerConfigService.saveConfig(config, secrets)
    deps.rebuildMenu()
    return saved
  })
  invokeHandler('provider-test', async (_event, id) => deps.testProvider(id, new AbortController().signal))
  invokeHandler('provider-set-default', (_event, id) => {
    deps.providerConfigService.setDefault(id)
    deps.rebuildMenu()
  })
  invokeHandler('provider-delete', async (_event, id, deleteSecrets) => {
    const deleted = await deps.providerConfigService.deleteConfig(id, deleteSecrets)
    if (deleted) deps.rebuildMenu()
    return deleted
  })
  invokeHandler('current-document-version', (event) => {
    const win = winFromEvent(event)
    return win ? deps.windowManager.getState(win).version : null
  })
  invokeHandler('open-workspace', async (event) => {
    const win = winFromEvent(event)
    if (!win) return null
    const descriptor = await deps.workspaceManager.openFolder(win)
    if (descriptor) deps.rebuildMenu()
    return descriptor
  })
  invokeHandler('list-workspace-files', async (event, directory) => {
    const win = winFromEvent(event)
    return win ? deps.workspaceManager.list(win.id, directory) : null
  })
  invokeHandler('open-workspace-file', async (event, relativePath) => {
    const win = winFromEvent(event)
    if (!win) return false
    const filePath = await deps.workspaceManager.resolveFile(win.id, relativePath)
    await deps.windowManager.openFile(filePath, win)
    return true
  })
  invokeHandler('open-file', async (event) => {
    const win = winFromEvent(event)
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      filters: [
        { name: t(deps.locale(), 'filter.markdown'), extensions: ['md', 'markdown', 'mdown', 'mkd'] },
        { name: t(deps.locale(), 'filter.text'), extensions: ['txt'] },
        { name: t(deps.locale(), 'filter.allFiles'), extensions: ['*'] },
      ],
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const filePath = result.filePaths[0]
    await deps.windowManager.openFile(filePath, win)
    return null
  })
  invokeHandler('open-file-path', async (event, filePath) => {
    const win = winFromEvent(event)
    if (!win) return null
    await deps.windowManager.openFile(filePath, win)
    return null
  })
  invokeHandler('list-siblings', async (event) => {
    const win = winFromEvent(event)
    return win ? deps.windowManager.listSiblings(win) : null
  })
  invokeHandler('open-sibling', async (event, filePath) => {
    const win = winFromEvent(event)
    return win ? deps.windowManager.openSibling(win, filePath) : false
  })
  invokeHandler('save-file', async (event, content, expectedPath, rebuildMenu) => {
    const win = winFromEvent(event)
    return win ? deps.windowManager.save(win, content, expectedPath, rebuildMenu) : null
  })
  invokeHandler('save-file-as', async (event, content, expectedPath) => {
    const win = winFromEvent(event)
    return win ? deps.windowManager.saveAs(win, content, expectedPath) : null
  })
  invokeHandler('export-pdf', async (event) => {
    const win = winFromEvent(event)
    if (!win) return false
    const state = deps.windowManager.getState(win)
    const defaultPath = state.filePath ? join(dirname(state.filePath), basename(state.filePath, '.md')) : undefined
    const result = await dialog.showSaveDialog(win, {
      defaultPath,
      filters: [{ name: t(deps.locale(), 'filter.pdf'), extensions: ['pdf'] }],
    })
    return result.canceled || !result.filePath ? false : exportPDF(win, result.filePath, deps)
  })
  invokeHandler('export-html', async (event, snapshot) => {
    const win = winFromEvent(event)
    if (!win) return false
    const state = deps.windowManager.getState(win)
    const baseName = state.filePath ? basename(state.filePath, '.md') : suggestFileName(snapshot.content) ?? t(deps.locale(), 'document.untitled')
    const result = await dialog.showSaveDialog(win, {
      defaultPath: state.filePath ? join(dirname(state.filePath), `${baseName}.html`) : `${baseName}.html`,
      filters: [{ name: t(deps.locale(), 'filter.html'), extensions: ['html'] }],
    })
    return result.canceled || !result.filePath ? false : exportHTML(result.filePath, snapshot as HtmlExportSnapshot, {
      title: baseName, locale: deps.locale(), writeFile: deps.writeFile, showItemInFolder: shell.showItemInFolder,
    })
  })
  invokeHandler('report-theme', (_event, theme) => { deps.reportTheme(theme) })
  invokeHandler('list-system-fonts', () => deps.loadSystemFonts())
  invokeHandler('set-editor-font', (event, prefs) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.webContents !== event.sender && !win.webContents.isDestroyed()) {
        const parsed = IpcEventSchemas['editor-font-changed'].safeParse([prefs])
        if (parsed.success) win.webContents.send('editor-font-changed', ...parsed.data)
      }
    }
  })
  invokeHandler('report-external-conflict', async (event) => {
    const win = winFromEvent(event)
    if (win) await deps.windowManager.reportExternalConflict(win)
  })
  invokeHandler('download-update', async () => await deps.downloadUpdate())
  invokeHandler('install-update', () => deps.installUpdate())
}

export function createSystemFontLoader(getLocale: () => string): () => Promise<string[]> {
  let cached: string[] | null = null
  let pending: Promise<string[]> | null = null
  return () => {
    if (cached) return Promise.resolve(cached)
    if (pending) return pending
    pending = new Promise((resolve) => {
      if (process.platform !== 'darwin') return resolve([])
      const script = [
        'ObjC.import("AppKit")', 'const nm = $.NSFontManager.sharedFontManager', 'const out = []',
        'const fams = nm.availableFontFamilies.js',
        'for (const f of fams) { out.push(nm.localizedNameForFamilyFace($(f), $()).js) }', 'out.join("\\n")',
      ].join('; ')
      execFile('osascript', ['-l', 'JavaScript', '-e', script], { maxBuffer: 4 * 1024 * 1024, timeout: 15000 }, (error, stdout) => {
        if (error) console.error('[font-list] osascript failed:', (error as NodeJS.ErrnoException).message)
        const collator = new Intl.Collator(getLocale().startsWith('zh') ? 'zh-Hans' : 'en', { sensitivity: 'base', numeric: true })
        cached = error ? [] : [...new Set(stdout.split('\n').map((value) => value.trim()).filter(Boolean))].sort(collator.compare)
        resolve(cached)
      })
    })
    return pending
  }
}
