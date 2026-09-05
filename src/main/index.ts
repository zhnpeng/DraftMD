import { app, BrowserWindow, Menu } from 'electron'
import { appendFile, chmod, lstat, readFile, readdir, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, watch, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveAppLocale, writeSavedLocale } from './locale'
import { createDocumentService } from './documents/document-service'
import { createRecentStore, draftMDRecentStorePath } from './documents/recent-store'
import { createWatchService } from './documents/watch-service'
import { createWindowManager, type WindowManager } from './app/window-manager'
import { buildApplicationMenu } from './app/menu'
import { createSystemFontLoader, registerIpcHandlers } from './app/ipc'
import { createBundledDocuments } from './app/bundled-documents'
import { setAsDefaultApp } from './app/default-app-service'
import { createUpdateService } from './app/update-service'
import { buildCapabilities } from './app/build-capabilities'
import { resolveTestEnvironment } from './test-environment'
import { createRecentWorkspaces, recentWorkspacesPath } from './workspace/recent-workspaces'
import { createWorkspaceManager } from './workspace/workspace-manager'
import { openDraftMDDatabase } from './persistence/database'
import { createToolActivityRepository } from './persistence/tool-activity-repository'
import { createMessageRepository } from './persistence/message-repository'
import { createSessionRepository } from './persistence/session-repository'
import { createWorkspaceRepository } from './persistence/workspace-repository'
import { createTaskRepository } from './persistence/task-repository'
import { cleanupSnapshotsAfterRecovery } from './changes/snapshot-retention'
import { createProviderConfigRepository } from './persistence/provider-config-repository'
import { createRuntimeCredentialStore } from './credentials/runtime-credential-store'
import { createProviderConfigService } from './providers/provider-config-service'
import { createCapabilityTester } from './providers/capability-test'
import { createProviderAdapter } from './providers/provider-factory'
import { createChangeSetService } from './changes/change-set-service'
import { createUndoService } from './changes/undo-service'
import { createTaskRecovery } from './agent/task-recovery'
import { createApprovalBroker } from './agent/approval-broker'
import { createRuntimeRegistry } from './agent/runtime-registry'
import { createAgentAppService } from './agent/agent-app-service'
import { createTaskActionService } from './agent/task-actions'
import { AgentRuntime } from './agent/agent-runtime'
import { ChatRuntime } from './agent/chat-runtime'
import { buildSessionHistory } from './agent/session-history'
import { createToolExecutor } from './agent/tools/executor'
import { buildProviderRequest } from './agent/context-builder'
import { normalizeSelectionReference } from './agent/selection-reference'
import { toolDefinitions } from './agent/tools/definitions'
import { createWorkspaceService } from './workspace/workspace-service'
import { randomUUID } from 'node:crypto'
import { uuidv7 } from './persistence/ids'
import { createSafeLogger } from './diagnostics/logger'
import { createDiagnosticsService } from './diagnostics/diagnostics-service'

const testEnvironment = resolveTestEnvironment({
  isPackaged: app.isPackaged,
  nodeEnv: process.env.NODE_ENV,
  requestedUserData: process.env.DRAFTMD_TEST_USER_DATA,
  tempRoot: tmpdir(),
  canonicalize: realpathSync,
})
const testUserData = testEnvironment.userData
if (testUserData) app.setPath('userData', testUserData)
const testUpdatesDisabled = testEnvironment.disableUpdates

const startedAt = performance.now()
const startupTraceEnabled = process.env.DRAFTMD_STARTUP_TRACE === '1'
const startupMarks: Record<string, number> = { 'main-loaded': 0 }
let startupTraceWritten = false
const markStartup = (name: string): void => {
  if (startupTraceEnabled && !startupTraceWritten) startupMarks[name] = Math.round(performance.now() - startedAt)
}
const writeStartupTrace = (): void => {
  if (!startupTraceEnabled || startupTraceWritten || !('renderer-ready' in startupMarks)) return
  startupTraceWritten = true
  const trace = JSON.stringify({ platform: process.platform, electron: process.versions.electron, ...startupMarks })
  void appendFile(join(app.getPath('userData'), 'startup-trace.jsonl'), `${trace}\n`).catch(() => {})
  console.info(`DraftMD startup trace: ${trace}`)
}
const locale = () => resolveAppLocale(join(app.getPath('userData'), 'settings.json'), app.getLocale())
const demoDir = app.isPackaged ? join(process.resourcesPath, 'demo') : join(__dirname, '../../resources/demo')
const cheatsheetDir = app.isPackaged ? join(process.resourcesPath, 'templates') : join(__dirname, '../../resources/templates')
const recentStore = createRecentStore({
  path: draftMDRecentStorePath(app.getPath('userData')),
  readFileSync, writeFileSync, mkdirSync,
})
const documentService = createDocumentService({ readFile, writeFile, chmod, lstat, realpath, rename, unlink, stat })
const recentWorkspaces = createRecentWorkspaces({
  path: recentWorkspacesPath(app.getPath('userData')),
  readFileSync, writeFileSync, mkdirSync, statSync,
})
let windowManager: WindowManager
const logsDirectory = join(app.getPath('userData'), 'logs')
const safeLogger = createSafeLogger({ directory: logsDirectory })
const persistence = openDraftMDDatabase(join(app.getPath('userData'), 'draftmd.sqlite'))
if (persistence.warning) {
  console.warn('[DraftMD] Local session database was recovered')
  safeLogger.write({ level: 'warn', module: 'database', code: persistence.warning.code, operation: 'recover' })
}
const workspaceRepository = createWorkspaceRepository(persistence.database)
const sessionRepository = createSessionRepository(persistence.database)
const messageRepository = createMessageRepository(persistence.database)
const taskRepository = createTaskRepository(persistence.database)
const toolActivityRepository = createToolActivityRepository(persistence.database)
const changeSetService = createChangeSetService(join(app.getPath('userData'), 'snapshots'))
const undoService = createUndoService(join(app.getPath('userData'), 'snapshots'))
let runtimeRegistry: ReturnType<typeof createRuntimeRegistry>
const approvalBroker = createApprovalBroker({
  onRequest: () => {},
  persist: (item) => toolActivityRepository.create({
    id: uuidv7(), taskId: item.taskId, kind: `approval-${item.status}`,
    payload: { approvalId: item.id, path: item.path, reason: item.reason, expectedVersion: item.expectedVersion },
    createdAt: new Date().toISOString(),
  }),
})
const interruptedContexts = taskRepository.listInterruptedContexts()
const recovery = createTaskRecovery({
  tasks: taskRepository,
  workspaceForTask: async (task) => {
    const context = interruptedContexts.find((candidate) => candidate.task.id === task.id)
    if (!context) throw Object.assign(new Error('Workspace not found for interrupted task'), { code: 'WORKSPACE_NOT_FOUND' })
    return context.workspace
  },
  changeSets: changeSetService,
  provider: { stream: () => { throw new Error('Recovery never calls a provider') } },
  cancelPendingApproval: (taskId) => approvalBroker.cancelTask(taskId),
  undo: undoService,
})
let recoveryReady: Promise<unknown> = Promise.resolve()
const providerConfigRepository = createProviderConfigRepository(persistence.database)
const providerConfigService = createProviderConfigService({
  repository: providerConfigRepository,
  credentials: createRuntimeCredentialStore({ testUserData }),
})
const capabilityTester = createCapabilityTester({
  materialize: providerConfigService.materialize,
  createAdapter: createProviderAdapter,
  persist: (id, result, expected) => providerConfigRepository.updateTestResult(id, {
    capability: result.capability, testedAt: result.testedAt, testedModel: result.model,
    latencyMs: result.latencyMs, errorCode: result.errorCode,
  }, expected),
  nonce: randomUUID,
  now: Date.now,
})
const workspaceManager = createWorkspaceManager({
  recent: recentWorkspaces,
  prepare: (win, canonicalRoot) => windowManager.prepareForWorkspace(win, canonicalRoot),
  chooseFolder: async (win) => {
    const result = await (await import('electron')).dialog.showOpenDialog(win, { properties: ['openDirectory'] })
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  },
  watch: (path, options, listener) => watch(path, options, listener),
})
let rebuildMenu = (): void => {}
const watchService = createWatchService({
  watch, readFile, existsSync,
  loadDocument: (path) => documentService.loadSnapshot(path),
  onExternalDocument: (win, path, document) => {
    windowManager.stageExternalDocument(win, path, document)
  },
  listSiblings: (path, browsePath) => {
    const win = BrowserWindow.getAllWindows().find((candidate) => windowManager.getState(candidate).filePath === path)
    if (!win) return Promise.resolve([])
    windowManager.getState(win).browsePath = browsePath
    return windowManager.listSiblings(win)
  },
  send: (win, channel, payload) => win.webContents.send(channel, payload),
})
windowManager = createWindowManager({
  documentService, snapshotLoader: documentService, watchService, recentStore, locale, appVersion: () => app.getVersion(),
  databaseWarning: () => persistence.warning?.code ?? null,
  preloadPath: join(__dirname, '../preload/index.js'), rendererPath: join(__dirname, '../renderer/index.html'),
  rendererURL: app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL,
  readdir, stat, rebuildMenu: () => rebuildMenu(),
  addRecentDocument: (path) => app.addRecentDocument(path), platform: process.platform,
  onStartupMark: markStartup, onWindowClosed: (win) => runtimeRegistry?.closeWindow(win), onRendererReady: () => { markStartup('renderer-ready'); writeStartupTrace() },
})
runtimeRegistry = createRuntimeRegistry({
  send: (win, event) => win.webContents.send('agent-task-event', event),
})
const agentSessionService = createAgentAppService({
  workspaceManager,
  workspaces: workspaceRepository,
  sessions: sessionRepository,
  messages: messageRepository,
  tasks: taskRepository,
  activities: toolActivityRepository,
  providers: providerConfigService,
  runtimeFactory: () => {},
  runtimeRegistry,
  now: () => new Date().toISOString(),
  createId: uuidv7,
  startTask: async (win, input) => {
    const materialized = await providerConfigService.materialize(input.providerConfigId)
    if (materialized.config.capability === 'unavailable') throw Object.assign(new Error('Provider unavailable'), { code: 'PROVIDER_UNAVAILABLE' })
    const provider = await createProviderAdapter(materialized)
    const workspaceService = createWorkspaceService(input.workspace.root)
    const selection = input.selection ? await normalizeSelectionReference(input.selection, {
      workspaceId: input.workspace.descriptor.id,
      root: input.workspace.root,
      workspace: workspaceService,
    }) : null
    const liveMessages = buildSessionHistory({ messages: messageRepository.list(input.session.id), task: null, activities: [] }).messages
    liveMessages.push({ role: 'user', text: input.prompt })
    const ensureWindow = (): void => {
      if (win.isDestroyed() || win.webContents.isDestroyed()) throw Object.assign(new Error('Window closed'), { code: 'CANCELLED' })
    }
    if (materialized.config.capability === 'chat-only') {
      const chat = new ChatRuntime({ provider, messages: messageRepository })
      const taskId = uuidv7()
      ensureWindow()
      const handle = chat.start({
        taskId, sessionId: input.session.id, prompt: input.prompt,
        currentDocument: input.currentContent, selection: selection?.selectedText ?? null,
      })
      runtimeRegistry.register(taskId, win, handle, { sessionId: input.session.id, mode: 'suggestion', messages: liveMessages })
      return { mode: 'suggestion', taskId, suggestion: null }
    }
    const executor = createToolExecutor({ workspace: workspaceService, approval: approvalBroker })
    const runtime = new AgentRuntime({
      provider, executor, changeSets: changeSetService,
      flush: { flush: async () => {
        const state = windowManager.getState(win)
        if (state.dirty) throw Object.assign(new Error('Unsaved editor state'), { code: 'DOCUMENT_NOT_FLUSHED' })
      } },
      tasks: taskRepository, messages: messageRepository, activities: toolActivityRepository,
      approvalBroker,
    })
    const taskId = uuidv7()
    const files = await workspaceService.list()
    let currentRelativePath: string | null = null
    if (input.currentPath) {
      const candidate = relative(input.workspace.root.canonicalPath, input.currentPath)
      if (candidate && candidate !== '..' && !candidate.startsWith(`..${sep}`) && !isAbsolute(candidate)) {
        currentRelativePath = candidate.split(sep).join('/')
      }
    }
    const history = messageRepository.list(input.session.id).flatMap((message) => {
      const content = message.content.flatMap((block) => block.type === 'text' ? [{ type: 'text' as const, text: block.text }] : [])
      if (message.role !== 'user' && message.role !== 'assistant') return []
      return [{ role: message.role, provider: null, content, providerData: message.modelSwitch }]
    })
    const request = buildProviderRequest({
      task: { text: input.prompt, selection },
      session: { history },
      workspace: {
        id: input.workspace.descriptor.id, files,
        current: currentRelativePath ? { path: currentRelativePath, version: (await workspaceService.read(currentRelativePath)).version, headingPath: [] } : null,
      },
      tools: toolDefinitions,
    })
    ensureWindow()
    const handle = runtime.start({ taskId, sessionId: input.session.id, workspace: {
      id: input.workspace.descriptor.id, name: input.workspace.descriptor.name,
      canonicalPath: input.workspace.root.canonicalPath,
    }, request })
    runtimeRegistry.register(taskId, win, handle, { sessionId: input.session.id, mode: 'agent', messages: liveMessages })
    return { mode: 'agent', taskId, suggestion: null }
  },
})
const taskActions = createTaskActionService({
  workspaceManager,
  tasks: taskRepository,
  sessions: sessionRepository,
  changes: changeSetService,
  undo: undoService,
  now: () => new Date().toISOString(),
})
const bundled = createBundledDocuments({
  windowManager, readFile, writeFile, demoDir, cheatsheetDir,
  releaseNoticePath: join(app.getPath('userData'), 'release-notice.json'),
  appVersion: () => app.getVersion(), isPackaged: app.isPackaged,
})
let currentTheme = 'elegant'
const diagnostics = createDiagnosticsService({
  appVersion: () => app.getVersion(), electronVersion: () => process.versions.electron,
  logsDirectory, database: persistence.database, databaseWarning: persistence.warning?.code ?? null,
  locale, theme: () => currentTheme, providers: () => providerConfigService.listConfigs(),
  log: (entry) => safeLogger.write(entry),
})
let menuControls: ReturnType<typeof buildApplicationMenu> | null = null
const updateService = createUpdateService({ locale, rebuildMenu: () => rebuildMenu(), appVersion: () => app.getVersion(), isPackaged: app.isPackaged, updatesConfigured: buildCapabilities.updatesConfigured })
rebuildMenu = () => {
  menuControls = buildApplicationMenu({
    locale, platform: process.platform, isPackaged: app.isPackaged, updatesConfigured: buildCapabilities.updatesConfigured,
    getFocusedWindow: BrowserWindow.getFocusedWindow, getAllWindows: BrowserWindow.getAllWindows,
    recentWorkspaces: () => recentWorkspaces.get(),
    openWorkspace: () => {
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      if (win) void (async () => {
        const selected = await workspaceManager.openFolder(win)
        if (!selected) return
        rebuildMenu()
      })()
    },
    openRecentWorkspace: (path) => {
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? windowManager.createWindow()
      void (async () => {
        const selected = await workspaceManager.openFolder(win, path)
        if (!selected) return
        rebuildMenu()
      })()
    },
    clearRecentWorkspaces: () => { recentWorkspaces.clear(); rebuildMenu() },
    setAsDefaultApp: () => setAsDefaultApp(locale),
    openBundledDocument: (fileName) => { void bundled.open(fileName) },
    openCheatsheet: (language) => { void bundled.openCheatsheet(language) },
    checkForUpdates: (manual) => { void updateService.check(manual) },
    downloadUpdate: () => { void updateService.download() }, latestVersion: updateService.latestVersion,
    currentTheme: () => currentTheme,
  })
  Menu.setApplicationMenu(menuControls.menu)
}
const loadSystemFonts = createSystemFontLoader(() => app.getLocale())
registerIpcHandlers({
  windowManager, workspaceManager, providerConfigService, diagnostics, locale,
  setLocale: (nextLocale) => { writeSavedLocale(join(app.getPath('userData'), 'settings.json'), nextLocale); rebuildMenu() },
  agentSessionService: {
    sessionHistory: agentSessionService.sessionHistory, listSessions: agentSessionService.listSessions, createSession: agentSessionService.createSession,
    renameSession: agentSessionService.renameSession, deleteSession: agentSessionService.deleteSession,
    switchModel: agentSessionService.switchModel, start: agentSessionService.start,
    stop: (win, taskId) => runtimeRegistry.stop(taskId, win.id),
  },
  taskActions,
  agentActions: {
    respond: (win, decision) => runtimeRegistry.respond(win, decision),
    listInterrupted: async () => { await recoveryReady; return recovery.list() },
    keepInterrupted: (id) => recovery.keepInterruptedTask(id),
    undoInterrupted: (id) => recovery.undoInterruptedTask(id),
  }, writeFile, rebuildMenu,
  testProvider: capabilityTester.testProvider,
  reportTheme: (theme) => { if (theme !== currentTheme) { currentTheme = theme; menuControls?.updateThemeChecks(theme) } },
  loadSystemFonts, downloadUpdate: updateService.download, installUpdate: updateService.install,
})
let pendingFilePaths: string[] = []
let isQuitting = false
app.whenReady().then(() => {
  markStartup('app-ready'); rebuildMenu(); void loadSystemFonts()
  const recoveringTasks = recovery.recover()
  recoveryReady = recoveringTasks.catch(() => [])
  void cleanupSnapshotsAfterRecovery({
    userDataPath: app.getPath('userData'), tasks: taskRepository,
    recovery: recoveringTasks, databaseWarning: persistence.warning,
    log: entry => safeLogger.write(entry),
  })
  const appEntryIndex = app.isPackaged ? 0 : process.argv.findIndex((arg) => arg.endsWith('/dist/main/index.js'))
  const args = process.argv.slice(appEntryIndex >= 0 ? appEntryIndex + 1 : app.isPackaged ? 1 : 2)
    .filter((arg) => !arg.startsWith('-'))
  if (args.length) pendingFilePaths = args
  if (pendingFilePaths.length) {
    pendingFilePaths.forEach((path) => {
      const win = windowManager.createWindow(path)
      void workspaceManager.openFolder(win, dirname(path)).then(() => undefined)
    })
    pendingFilePaths = []
  } else {
    windowManager.createWindow()
  }
  if (!testUpdatesDisabled) updateService.setup()
  if (!testUserData) void bundled.openChangelogOnce()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) windowManager.createWindow() })
})
app.on('before-quit', (event) => {
  if (isQuitting) return
  approvalBroker.cancelAll()
  runtimeRegistry.stopAll()
  event.preventDefault()
  void windowManager.confirmAllWindowsClose().then((ok) => {
    if (!ok) return
    isQuitting = true; windowManager.setQuitting(true); app.quit()
  })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('open-file', (event, path) => {
  event.preventDefault()
  if (app.isReady()) windowManager.openFile(path)
  else pendingFilePaths.push(path)
})
