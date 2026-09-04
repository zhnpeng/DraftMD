import type { DraftMDAPI, FileOpened } from '../../shared/contracts'
import { msg } from '../../shared/i18n'
import { createAutosaveScheduler } from '../autosave-scheduler'
import type { SourceModeController } from './source-mode-controller'

export interface DocumentController {
  currentPath(): string | null
  currentContent(): string
  currentVersion(): string | null
  revision(): number
  flushSave(): Promise<boolean>
  applyDiskContent(input: FileOpened): void
  dispose(): void
}

export interface DocumentControllerActions extends DocumentController {
  isDirty(): boolean
  markDirty(): void
  saveAs(): Promise<boolean>
  applyExternalSnapshot(change: { path: string; content: string; version: string }): void
  resolveExternalConflict(result: { action: 'keep' } | { action: 'load'; content: string }): void
  pauseAutosaveRetry(): void
  snapshot(): { dirty: boolean; content: string; revision: number }
  generation(): number
}

export function createDocumentController(input: {
  api: DraftMDAPI
  source: SourceModeController
  titleElement: HTMLElement
  saveStatusElement: HTMLElement
  onGenerationChanged?(generation: number): void
  onContentChanged(): void
  onPathChanged(): void
}): DocumentControllerActions {
  let path: string | null = null
  let version: string | null = null
  let dirty = false
  let revision = 0
  let generation = 0
  let saveQueue: Promise<void> = Promise.resolve()
  let statusTimer: ReturnType<typeof setTimeout> | null = null
  let externalConflictPending = false
  const autosave = createAutosaveScheduler(() => { void runAutosave() })

  const showStatus = (state: 'dirty' | 'saved'): void => {
    if (statusTimer) clearTimeout(statusTimer)
    statusTimer = null
    if (state === 'dirty') {
      input.saveStatusElement.textContent = msg('document.edited')
      input.saveStatusElement.classList.add('pending')
    } else {
      input.saveStatusElement.classList.remove('pending')
      statusTimer = setTimeout(() => { input.saveStatusElement.textContent = '' }, 600)
    }
  }
  const clearStatus = (): void => {
    if (statusTimer) clearTimeout(statusTimer)
    statusTimer = null
    input.saveStatusElement.classList.remove('pending', 'saved')
    input.saveStatusElement.textContent = ''
  }
  const reportDirty = (): void => input.api.reportDirty(dirty)
  const clearDirty = (): void => { dirty = false; autosave.cancel(); reportDirty() }
  const resetDirty = (): void => { revision += 1; clearDirty(); clearStatus() }
  const scheduleAutosave = (): void => { if (path && !externalConflictPending) autosave.schedule() }
  const enqueue = (operation: () => Promise<string | null>): Promise<string | null> => {
    const next = saveQueue.then(operation, operation)
    saveQueue = next.then(() => undefined, () => undefined)
    return next
  }
  async function runAutosave(): Promise<void> {
    if (!dirty || !path) return
    const capturedRevision = revision
    const capturedPath = path
    const savedPath = await enqueue(() => input.api.saveFile(input.source.currentContent(), capturedPath, false))
    if (savedPath && revision === capturedRevision && path === capturedPath) {
      path = savedPath
      clearDirty()
      showStatus('saved')
    }
  }
  const save = async (saveAs = false): Promise<boolean> => {
    autosave.rearmForManualSave()
    const capturedRevision = revision
    const expectedPath = path
    const content = input.source.currentContent()
    const savedPath = await enqueue(() => saveAs
      ? input.api.saveFileAs(content, expectedPath ?? undefined)
      : input.api.saveFile(content, expectedPath ?? undefined, true))
    if (!savedPath || path !== expectedPath) return false
    path = savedPath
    updateTitle()
    input.onPathChanged()
    if (capturedRevision === revision) {
      clearDirty()
      showStatus('saved')
      return true
    }
    if (dirty) scheduleAutosave()
    return false
  }
  const updateTitle = (): void => {
    input.titleElement.textContent = path ? path.split(/[\\/]/).pop() || path : msg('document.untitled')
  }
  const advanceGeneration = (): void => { generation += 1; input.onGenerationChanged?.(generation) }
  const setProgrammaticContent = (content: string, preserveMode = false): void => {
    if (preserveMode) input.source.setContentPreservingMode(content)
    else input.source.setContent(content)
    input.onContentChanged()
  }

  return {
    currentPath: () => path,
    currentContent: () => input.source.currentContent(),
    currentVersion: () => version,
    revision: () => revision,
    isDirty: () => dirty,
    markDirty() {
      autosave.rearmForEdit()
      revision += 1
      dirty = true
      reportDirty()
      showStatus('dirty')
      scheduleAutosave()
    },
    flushSave: () => save(false),
    saveAs: () => save(true),
    applyDiskContent(opened) {
      advanceGeneration()
      path = opened.path
      version = opened.version
      externalConflictPending = false
      resetDirty()
      setProgrammaticContent(opened.content)
      updateTitle()
      input.onPathChanged()
    },
    applyExternalSnapshot(change) {
      if (change.path !== path) return
      if (dirty) {
        if (externalConflictPending) return
        externalConflictPending = true
        autosave.pause()
        if (statusTimer) clearTimeout(statusTimer)
        statusTimer = null
        input.saveStatusElement.textContent = msg('document.externalModified')
        input.saveStatusElement.classList.remove('saved')
        input.saveStatusElement.classList.add('pending')
        void input.api.reportExternalConflict()
        return
      }
      advanceGeneration()
      setProgrammaticContent(change.content, true)
      resetDirty()
      version = change.version
      input.api.acknowledgeExternalVersion(change.path, change.version)
    },
    resolveExternalConflict(result) {
      externalConflictPending = false
      if (result.action === 'load') {
        advanceGeneration()
        setProgrammaticContent(result.content)
        resetDirty()
      } else {
        autosave.rearmForManualSave()
        showStatus('dirty')
        if (dirty) scheduleAutosave()
      }
    },
    pauseAutosaveRetry() {
      externalConflictPending = false
      autosave.pause()
      showStatus('dirty')
    },
    snapshot: () => ({ dirty, content: input.source.currentContent(), revision }),
    generation: () => generation,
    dispose() {
      autosave.cancel()
      if (statusTimer) clearTimeout(statusTimer)
    },
  }
}
