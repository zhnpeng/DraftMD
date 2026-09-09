import { createEditor, getMarkdown, getVisualSelectionMarkdown, setMarkdown, showMathModal } from '../editor/editor'
import { SearchPanel } from '../editor/search-panel'
import { applyTheme, loadSavedTheme } from '../themes/theme-manager'
import { applyEditorFont, loadSavedEditorFont, showFontSettingsModal } from '../editor/font-settings'
import { detectLocale, msg, setLocale, type Locale, type MessageKey, type MessageVars } from '../../shared/i18n'
import type { DraftMDAPI, Unsubscribe } from '../../shared/contracts'
import { createDocumentController } from './document-controller'
import { createFilePanelController } from './file-panel-controller'
import { createLargeSourceSurface } from '../editor/large-source-loader'
import { createSourceModeController, runVisualExport } from './source-mode-controller'
import { createUpdateBannerController } from './update-banner-controller'
import { createAgentDockApp } from '../agent/agent-dock-app'
import { createProviderSettings } from '../settings/provider-settings'
import { captureSourceSelection, captureVisualSelection } from '../editor/selection-reference'
import { createOnboarding } from './onboarding'
import { setMermaidGeneration, waitForMermaidReady } from '../editor/mermaid-readiness'
import { createDiagnosticsDialog } from './diagnostics'
import { createDatabaseWarningController } from './database-warning'

function required<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id)
  if (!element) throw new Error(`Missing renderer element #${id}`)
  return element as T
}

function applyLocale(locale: Locale): void {
  setLocale(locale)
  document.documentElement.lang = locale
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((element) => {
    const key = element.dataset.i18n as MessageKey
    const vars = element.dataset.i18nVars ? JSON.parse(element.dataset.i18nVars) as MessageVars : undefined
    element.textContent = msg(key, vars)
  })
  document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-i18n-placeholder]').forEach((element) => {
    element.placeholder = msg(element.dataset.i18nPlaceholder as MessageKey)
  })
  document.querySelectorAll<HTMLElement>('[data-i18n-aria-label]').forEach((element) => {
    element.setAttribute('aria-label', msg(element.dataset.i18nAriaLabel as MessageKey))
  })
}

function updateWordCount(element: HTMLElement, content: string, reduced = false): void {
  const tip = element.querySelector('.word-count-tip')
  if (reduced) { if (tip) tip.textContent = msg('document.statsReduced'); return }
  const characters = content.replace(/\s/g, '').length
  const words = content.match(/[㐀-䶿一-鿿豈-﫿぀-ヿ가-힯]|[A-Za-z]+(?:['’\\-][A-Za-z]+)*|\d+(?:[.,]\d+)*/g)?.length ?? 0
  const normalized = content.replace(/\r\n?/g, '\n').trim()
  const paragraphs = normalized ? normalized.split(/\n\s*\n+/).filter((block) => block.trim()).length : 0
  if (tip) tip.textContent = msg('document.stats', { characters, words, paragraphs })
}

function exportSnapshot(editorElement: HTMLElement, content: string) {
  let styles = ''
  for (const sheet of Array.from(document.styleSheets)) {
    try { styles += Array.from(sheet.cssRules).map((rule) => rule.cssText).join('\n') + '\n' } catch { /* inaccessible stylesheet */ }
  }
  return {
    content,
    html: editorElement.querySelector('.ProseMirror')?.innerHTML ?? '',
    styles,
    bodyClass: Array.from(document.body.classList).filter((name) => name !== 'show-file-panel').join(' '),
    background: getComputedStyle(document.body).backgroundColor,
  }
}

export async function bootstrapRenderer(api: DraftMDAPI = window.draftmd): Promise<() => void> {
  const subscriptions: Unsubscribe[] = []
  const listeners: Array<() => void> = []
  applyLocale(detectLocale(navigator.language))
  const appBootstrap = await new Promise<Parameters<Parameters<DraftMDAPI['onAppBootstrap']>[0]>[0]>((resolve) => subscriptions.push(api.onAppBootstrap(resolve)))
  applyLocale(appBootstrap.locale)
  document.documentElement.dataset.platform = appBootstrap.platform
  if (appBootstrap.platform === 'win32') {
    const shortcut = document.querySelector<HTMLElement>('[data-i18n="files.toggleShortcut"]')
    if (shortcut) shortcut.textContent = msg('files.toggleShortcutWindows')
  }
  applyTheme(loadSavedTheme())
  applyEditorFont(loadSavedEditorFont())

  const editorElement = required<HTMLElement>('editor')
  const sourceElement = required<HTMLTextAreaElement>('source-editor')
  const wordCountElement = required<HTMLElement>('word-count')
  let sourceForUpdates: ReturnType<typeof createSourceModeController> | null = null
  let documentController: ReturnType<typeof createDocumentController>
  let filePanel: ReturnType<typeof createFilePanelController>
  let currentWorkspaceId: string | null = null

  await createEditor('editor', (markdown) => updateWordCount(wordCountElement, markdown), (origin) => {
    if (origin === 'user') { sourceForUpdates?.notifyVisualUserEdit(); documentController?.markDirty() }
    filePanel?.scheduleOutlineUpdate()
  })
  const source = createSourceModeController({
    createLargeSurface: (content, onInput) => createLargeSourceSurface(required('large-source-editor'), content, onInput),
    editorElement, sourceElement, toggleButton: required('source-toggle-btn'),
    editor: { getMarkdown, setMarkdown },
    documentGeneration: () => documentController?.generation() ?? 0,
    onReducedRenderingChanged: (reduced) => {
      required<HTMLElement>('reduced-rendering-banner').hidden = !reduced
      required<HTMLButtonElement>('file-panel-outline').disabled = reduced
    },
  })
  sourceForUpdates = source
  documentController = createDocumentController({
    api, source, titleElement: required('file-title'), saveStatusElement: required('save-status'),
    onGenerationChanged: setMermaidGeneration,
    onContentChanged: () => { updateWordCount(wordCountElement, source.isReducedRendering() ? '' : source.currentContent(), source.isReducedRendering()); filePanel?.scheduleOutlineUpdate() },
    onPathChanged: () => { filePanel?.updateVisibility(); void filePanel?.refresh() },
  })
  setMermaidGeneration(documentController.generation())
  filePanel = createFilePanelController({
    api, source, editorElement, sourceElement,
    panelElement: required('file-panel'), fileListElement: required('file-list'), outlineListElement: required('outline-list'),
    filesTab: required('file-panel-files'), outlineTab: required('file-panel-outline'), toggleButton: required('file-toggle-btn'),
    currentPath: documentController.currentPath,
    beforeOpenFile: () => documentController.isDirty() ? documentController.flushSave() : Promise.resolve(true),
  })
  listeners.push(source.onSourceInput(() => {
    documentController.markDirty()
    updateWordCount(wordCountElement, source.isReducedRendering() ? '' : source.currentContent(), source.isReducedRendering())
    filePanel.scheduleOutlineUpdate()
  }))
  updateWordCount(wordCountElement, source.currentContent())
  await filePanel.refresh()

  const providerSettings = createProviderSettings({
    api, dialog: required<HTMLDialogElement>('provider-settings'),
  })
  const agentDock = createAgentDockApp({
    api, document: documentController, currentWorkspaceId: () => currentWorkspaceId,
    storage: localStorage, onConfigureModel: () => { void providerSettings.show() },
    captureSelection: async () => {
      const workspaceId = currentWorkspaceId
      const path = documentController.currentPath()
      if (!workspaceId || !path) return null
      if (documentController.isDirty() && !await documentController.flushSave()) return null
      const version = await api.currentDocumentVersion()
      if (!version) return null
      const markdown = source.currentContent()
      if (source.isSourceMode()) return captureSourceSelection({
        workspaceId, path, version, content: markdown,
        start: source.selection().anchor, end: source.selection().head,
      })
      const visual = getVisualSelectionMarkdown()
      if (!visual) return null
      return captureVisualSelection({ workspaceId, path, version, markdown, ...visual })
    },
  })
  const onboarding = createOnboarding({
    api,
    storage: localStorage,
    currentWorkspaceId: () => currentWorkspaceId,
    applyLocale,
    configureModel: () => { void providerSettings.show() },
  })
  const diagnostics = createDiagnosticsDialog({ api })
  const databaseWarning = createDatabaseWarningController({
    banner: required('database-warning'), text: required('database-warning-text'), dismiss: required('database-warning-dismiss'),
  })
  if (appBootstrap.databaseWarning) databaseWarning.show(appBootstrap.databaseWarning)
  listeners.push(() => agentDock.dispose())
  listeners.push(() => providerSettings.dispose())
  listeners.push(() => onboarding.dispose())
  listeners.push(() => diagnostics.dispose())
  listeners.push(() => databaseWarning.dispose())
  const searchPanel = new SearchPanel()
  subscriptions.push(
    api.onSearch(() => searchPanel.show()), api.onMathModal(() => showMathModal()),
    api.onOpenOnboarding(() => onboarding.show(true)),
    api.onOpenDiagnostics(() => { void diagnostics.show() }),
    api.onOpenProviderSettings(() => { void providerSettings.show() }),
    api.onFocusAgentDock(() => agentDock.dock.focusInput()),
    api.onToggleFilePanel(() => filePanel.toggle()), api.onToggleSourceMode(() => { source.toggle(); updateWordCount(wordCountElement, source.isReducedRendering() ? '' : source.currentContent(), source.isReducedRendering()); filePanel.scheduleOutlineUpdate() }),
    api.onWorkspaceOpened((workspace) => { currentWorkspaceId = workspace.id; void filePanel.workspaceOpened(); void agentDock.refreshWorkspace(workspace.id) }),
    api.onWorkspaceFilesChanged(() => { void filePanel.refresh() }),
    api.onMenuOpen(() => { void api.openFile() }),
    api.onMenuSave(() => { void documentController.flushSave() }), api.onMenuSaveAs(() => { void documentController.saveAs() }),
    api.onMenuExportPDF(() => {
      void runVisualExport(source, () => api.exportPDF(), (state) => waitForMermaidReady({
        generation: state.documentGeneration,
        isCurrent: () => documentController.generation() === state.documentGeneration,
      }))
    }),
    api.onFileOpened((opened) => documentController.applyDiskContent(opened)),
    api.onDocumentSnapshotChanged((change) => documentController.applyExternalSnapshot(change)),
    api.onExternalConflictResult((result) => documentController.resolveExternalConflict(result)),
    api.onAutosaveRetryPaused(() => documentController.pauseAutosaveRetry()),
    api.onRequestDocumentState((requestId) => api.respondDocumentState(requestId, documentController.snapshot())),
    api.onSetTheme((theme) => applyTheme(theme)),
    api.onOpenFontSettings(() => showFontSettingsModal()),
    api.onEditorFontChanged((prefs) => applyEditorFont(prefs.family || prefs.size ? prefs : null)),
  )

  subscriptions.push(api.onMenuExportHTML(() => {
    void runVisualExport(source, async () => {
      await api.exportHTML(exportSnapshot(editorElement, source.currentContent()))
    }, (state) => waitForMermaidReady({
      generation: state.documentGeneration,
      isCurrent: () => documentController.generation() === state.documentGeneration,
    }))
  }))

  const updateBanner = createUpdateBannerController({
    banner: required('update-banner'), text: required('update-banner-text'), action: required('update-banner-action'),
    dismiss: required('update-banner-dismiss'), download: api.downloadUpdate, install: api.installUpdate,
  })
  subscriptions.push(
    api.onUpdateAvailable((version) => updateBanner.showAvailable(version)),
    api.onUpdateDownloaded((version) => updateBanner.showDownloaded(version)),
  )
  listeners.push(() => updateBanner.dispose())

  const agentDot = required<HTMLElement>('agent-dot')
  subscriptions.push(api.onAgentActivity((state) => {
    agentDot.className = state === 'idle' ? '' : state
    const label = msg(state === 'active' ? 'agent.active' : state === 'cooldown' ? 'agent.cooldown' : 'agent.state')
    agentDot.setAttribute('aria-label', label)
    const tip = agentDot.querySelector('.toolbar-tip'); if (tip) tip.textContent = label
  }))
  const dragover = (event: DragEvent): void => event.preventDefault()
  const drop = async (event: DragEvent): Promise<void> => {
    event.preventDefault()
    const file = event.dataTransfer?.files[0]; if (!file) return
    const path = api.getPathForFile(file); if (path) await api.openFilePath(path)
  }
  document.addEventListener('dragover', dragover)
  document.addEventListener('drop', drop)
  listeners.push(() => document.removeEventListener('dragover', dragover), () => document.removeEventListener('drop', drop))

  api.reportRendererReady()
  onboarding.show()
  return () => {
    subscriptions.splice(0).forEach((unsubscribe) => unsubscribe())
    listeners.splice(0).forEach((remove) => remove())
    searchPanel.dispose(); filePanel.dispose(); documentController.dispose(); source.dispose()
  }
}
