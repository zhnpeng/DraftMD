import type { DraftMDAPI, TaskEvent } from '../../shared/contracts'
import type { SelectionReference } from '../../shared/contracts/agent'
import { messages, msg, type MessageKey } from '../../shared/i18n'
import type { DocumentControllerActions } from '../app/document-controller'
import { createAgentDockController, createPendingStop } from './agent-dock-controller'
import { createSessionController } from './session-controller'
import { providerLabel, renderModelMenu } from './model-picker'
import { renderSessionMenu, renderSessionOptions } from './session-list'
import { createDeltaBatcher, modelSwitchText, renderMessage, renderSystemMessage, shouldAutoScroll } from './message-list'
import { renderActivity, renderPersistedActivity } from './tool-activity-list'
import { createTaskViewState, reduceTaskEvent } from './task-status'
import { createDeleteApprovalQueue, renderDeleteApproval } from './delete-approval'
import { renderChangeSet } from './diff-view'
import { renderRecovery } from './recovery-panel'
import { renderSelectionChip, selectionErrorMessageKey } from './selection-chip'
import { renderUndoConflicts } from './undo-conflict'

function required<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id)
  if (!element) throw new Error(`Missing #${id}`)
  return element as T
}

export function createAgentDockApp(input: {
  api: DraftMDAPI
  document: DocumentControllerActions
  currentWorkspaceId(): string | null
  storage?: Storage
  onConfigureModel(): void
  captureSelection(): Promise<SelectionReference | null>
}) {
  const messageLog = required('agent-message-log')
  const taskContent = required('agent-task-content')
  const activities = required('agent-activity-list')
  const statusElement = required('agent-task-status')
  const approvalPanel = required('agent-approval-panel')
  const changeSummary = required('agent-change-summary')
  const recoveryPanel = required('agent-recovery-panel')
  const sessionButton = required<HTMLButtonElement>('agent-session-button')
  const modelButton = required<HTMLButtonElement>('agent-model-button')
  const sessionMenu = required<HTMLElement>('agent-session-menu')
  const modelMenu = required<HTMLElement>('agent-model-menu')
  const deleteDialog = required<HTMLDialogElement>('agent-session-delete-dialog')
  const deleteCancel = required<HTMLButtonElement>('agent-session-delete-cancel')
  const deleteConfirm = required<HTMLButtonElement>('agent-session-delete-confirm')
  const sessions = createSessionController({ api: input.api })
  let activeTaskId: string | null = null
  let selection: SelectionReference | null = null
  let taskState: ReturnType<typeof createTaskViewState> | null = null
  let pendingDeleteSessionId: string | null = null
  let historyGeneration = 0
  let starting = false
  let startingEvents: TaskEvent[] = []
  let historyEvents: TaskEvent[] | null = null
  let taskMode: 'agent' | 'suggestion' = 'agent'
  const pendingStop = createPendingStop()
  const approvalQueue = createDeleteApprovalQueue()

  const dock = createAgentDockController({
    root: required('agent-dock'), expanded: required('agent-dock-expanded'), resize: required('agent-dock-resize'),
    textarea: required('agent-input'), collapseButton: required('agent-collapse-button'),
    expandButton: required('agent-expand-button'),
    sendButton: required('agent-send-button'), stopButton: required('agent-stop-button'),
    storage: input.storage,
    onSend: (text) => send(text),
    onStop: () => { const taskId = pendingStop.request(activeTaskId); if (taskId) void input.api.stopAgentTask(taskId) },
  })

  const deltaBatcher = createDeltaBatcher({
    requestFrame: callback => requestAnimationFrame(callback),
    cancelFrame: id => cancelAnimationFrame(id),
    render: (text) => {
      if (!taskState) return
      const nearBottom = shouldAutoScroll(taskContent)
      let assistant = messageLog.querySelector<HTMLElement>('.agent-message.assistant[data-streaming]')
      if (!assistant) { assistant = renderMessage(messageLog, 'assistant', ''); assistant.dataset.streaming = 'true' }
      assistant.textContent = `${assistant.textContent ?? ''}${text}`
      if (nearBottom) taskContent.scrollTop = taskContent.scrollHeight
    },
  })
  const undoTask = async (taskId: string): Promise<void> => {
    const result = await input.api.undoAgentTask(taskId)
    if (result.status === 'undone') {
      statusElement.textContent = msg('dock.status.undone')
    } else {
      statusElement.textContent = msg('dock.status.undo-conflict')
      renderUndoConflicts({
        container: recoveryPanel, files: result.files,
        onOpen: (path) => {
          void (async () => {
            if (input.document.isDirty() && !await input.document.flushSave()) return
            if (!await input.api.openWorkspaceFile(path)) statusElement.textContent = msg('dock.openFileFailed')
          })().catch(() => { statusElement.textContent = msg('dock.openFileFailed') })
        },
        onDismiss: () => { recoveryPanel.hidden = true },
      })
      dock.open()
    }
  }
  const showTaskChanges = async (taskId: string, undoable: boolean): Promise<void> => {
    const generation = historyGeneration
    try {
      const changeSet = await input.api.getAgentTaskChanges(taskId)
      if (generation !== historyGeneration) return
      if (!changeSet.changes.length) return
      renderChangeSet(changeSummary, changeSet, undoable ? () => undoTask(taskId) : () => {})
      const button = changeSummary.querySelector<HTMLButtonElement>('.agent-undo-task')
      if (button && !undoable) button.hidden = true
    } catch { if (generation === historyGeneration) changeSummary.hidden = true }
  }

  const loadHistory = async (sessionId: string | null): Promise<void> => {
    const generation = ++historyGeneration
    deltaBatcher.flush()
    historyEvents = []
    approvalQueue.clear()
    renderCurrentApproval()
    taskState = null
    messageLog.replaceChildren()
    activities.replaceChildren()
    changeSummary.replaceChildren(); changeSummary.hidden = true
    statusElement.textContent = msg('dock.ready')
    if (!sessionId) { historyEvents = null; return }
    let history
    try { history = await input.api.getSessionHistory(sessionId) }
    catch {
      if (generation === historyGeneration) { historyEvents = null; statusElement.textContent = msg('dock.historyFailed') }
      return
    }
    if (generation !== historyGeneration || sessions.state().currentSessionId !== sessionId) return
    const buffered = historyEvents ?? []
    historyEvents = null
    const providers = sessions.state().providers
    for (const message of history.messages) {
      if (message.role === 'model-switch') renderSystemMessage(messageLog, modelSwitchText(message.providerConfigId, providers))
      else renderMessage(messageLog, message.role, message.text)
    }
    if (history.liveTask) {
      activeTaskId = history.liveTask.taskId
      taskMode = history.liveTask.mode
      taskState = createTaskViewState(activeTaskId)
      dock.setBusy(true)
      modelButton.disabled = true
      for (const event of [...history.liveTask.events, ...buffered]) onTaskEvent(event)
      deltaBatcher.flush()
      return
    }
    if (history.latestTask) {
      for (const activity of history.latestTask.activities) renderPersistedActivity(activities, activity)
      statusElement.textContent = msg(`dock.status.${history.latestTask.status}` as 'dock.status.running')
      const status = history.latestTask.status
      if (['completed', 'partial-complete', 'undone', 'undo-conflict'].includes(status)) {
        await showTaskChanges(history.latestTask.id, status === 'completed' || status === 'partial-complete')
      }
    }
  }

  const refreshHeader = (): void => {
    const state = sessions.state()
    renderSessionOptions(sessionButton, state.sessions, state.currentSessionId)
    const provider = state.providers.find((candidate) => candidate.id === state.providerId)
    modelButton.textContent = provider ? providerLabel(provider) : msg('dock.configureModel')
  }
  const refreshWorkspace = async (workspaceId: string): Promise<void> => {
    await sessions.refresh(workspaceId)
    refreshHeader()
    await loadHistory(sessions.state().currentSessionId)
  }
  const selectionChip = required<HTMLElement>('agent-selection-chip')
  const setSelection = (value: SelectionReference | null): void => {
    selection = value
    renderSelectionChip({
      container: selectionChip, reference: selection, removeLabel: msg('dock.removeSelection'),
      onRemove: () => { setSelection(null); dock.focusInput() },
    })
  }
  const showSendFeedback = (message: string, configureModel = false): void => {
    messageLog.querySelector('.agent-send-feedback')?.remove()
    const feedback = document.createElement('div')
    feedback.className = 'agent-send-feedback'
    feedback.setAttribute('role', 'alert')
    const description = document.createElement('p')
    description.textContent = message
    feedback.append(description)
    if (configureModel) {
      const configure = document.createElement('button')
      configure.type = 'button'
      configure.textContent = msg('dock.configureModel')
      configure.addEventListener('click', () => input.onConfigureModel())
      feedback.append(configure)
    }
    messageLog.append(feedback)
    dock.open()
    taskContent.scrollTop = taskContent.scrollHeight
  }
  const send = async (text: string): Promise<boolean> => {
    if (starting || activeTaskId) return false
    let accepted = false
    starting = true
    startingEvents = []
    pendingStop.clear()
    closeMenus()
    messageLog.querySelector('.agent-send-feedback')?.remove()
    dock.setBusy(true)
    sessionButton.disabled = true
    modelButton.disabled = true
    try {
      const workspaceId = input.currentWorkspaceId()
      await sessions.refreshProviders()
      const state = sessions.state()
      refreshHeader()
      if (!state.providerId) {
        statusElement.textContent = msg('dock.configureModel')
        showSendFeedback(msg('dock.modelRequired'), true)
        return false
      }
      if (!workspaceId) {
        statusElement.textContent = msg('dock.openWorkspace')
        showSendFeedback(msg('dock.openWorkspace'))
        return false
      }
      if (input.document.isDirty() && !await input.document.flushSave()) return false
      ++historyGeneration
      historyEvents = null
      deltaBatcher.flush()
      taskState = null
      approvalQueue.clear()
      renderCurrentApproval()
      activities.replaceChildren()
      changeSummary.replaceChildren(); changeSummary.hidden = true
      dock.setBusy(true); dock.open(); statusElement.textContent = msg('dock.preparing')
      const result = await input.api.startAgentTask({
        workspaceId, sessionId: state.currentSessionId ?? undefined, providerConfigId: state.providerId,
        prompt: text, currentPath: input.document.currentPath(), currentContent: input.document.currentContent(), selection,
      })
      accepted = true
      renderMessage(messageLog, 'user', text)
      taskMode = result.mode
      if (result.taskId) {
        activeTaskId = result.taskId
        taskState = createTaskViewState(result.taskId)
        const stopTaskId = pendingStop.attach(result.taskId)
        if (stopTaskId) void input.api.stopAgentTask(stopTaskId)
      } else if (result.mode === 'suggestion') {
        renderMessage(messageLog, 'assistant', result.suggestion ?? '')
        statusElement.textContent = msg('dock.suggestion')
      }
      const refreshed = input.currentWorkspaceId(); if (refreshed) await sessions.setWorkspace(refreshed)
      sessions.selectSession(result.sessionId)
      refreshHeader()
      starting = false
      for (const event of startingEvents) onTaskEvent(event)
      startingEvents = []
    } catch (error) {
      const key = selectionErrorMessageKey(error)
      if (key) setSelection(null)
      statusElement.textContent = msg(key ?? 'dock.startFailed')
      showSendFeedback(msg(key ?? 'dock.startFailed'))
      pendingStop.clear()
    } finally {
      starting = false
      startingEvents = []
      sessionButton.disabled = false
      modelButton.disabled = activeTaskId !== null
      dock.setBusy(activeTaskId !== null)
    }
    return accepted
  }
  const renderCurrentApproval = (): void => {
    const event = approvalQueue.current()
    if (!event) {
      approvalPanel.hidden = true
      approvalPanel.replaceChildren()
      dock.waitingApproval(false)
      return
    }
    dock.waitingApproval(true)
    renderDeleteApproval({
      container: approvalPanel, api: input.api, event,
      position: { current: 1, total: approvalQueue.size },
      onDecision: () => { approvalQueue.resolve(event.approvalId); renderCurrentApproval() },
    })
  }

  const onTaskEvent = (event: TaskEvent): void => {
    if (starting) { startingEvents.push(event); return }
    const terminal = event.type === 'status' && ['completed', 'partial-complete', 'stopped', 'failed', 'undone', 'undo-conflict'].includes(event.status)
    if (event.taskId === activeTaskId && terminal) {
      activeTaskId = null
      pendingStop.clear()
      dock.setBusy(false)
      modelButton.disabled = false
    }
    if (historyEvents) { historyEvents.push(event); return }
    if (!taskState || event.taskId !== taskState.taskId) return
    const previous = taskState
    taskState = reduceTaskEvent(taskState, event)
    if (taskState === previous) return
    if (event.type === 'assistant-text-delta') deltaBatcher.push(event.text)
    else if (event.type === 'error' && event.code !== 'CANCELLED') {
      deltaBatcher.flush()
      const key = `provider.error.${event.code}`
      showSendFeedback(msg(Object.hasOwn(messages.en, key) ? key as MessageKey : 'provider.error.PROVIDER_ERROR'),
        ['EMPTY_RESPONSE', 'AUTHENTICATION', 'MODEL_NOT_FOUND', 'API_UNSUPPORTED'].includes(event.code))
    }
    else if (event.type === 'tool-start' || event.type === 'tool-result') renderActivity(activities, event)
    else if (event.type === 'approval-request') {
      approvalQueue.add(event)
      renderCurrentApproval()
    } else if (event.type === 'change-set') {
      renderChangeSet(changeSummary, event.changeSet, () => undoTask(event.taskId))
    } else if (event.type === 'status') {
      if (terminal) { approvalQueue.clear(); renderCurrentApproval(); deltaBatcher.flush(); messageLog.querySelector<HTMLElement>('.agent-message.assistant[data-streaming]')?.removeAttribute('data-streaming') }
      statusElement.textContent = taskMode === 'suggestion' && event.status === 'completed'
        ? msg('dock.suggestion') : msg(`dock.status.${event.status}` as 'dock.status.running')
      dock.setBusy(activeTaskId !== null)
      dock.waitingApproval(event.status === 'waiting-approval')
    }
  }
  const captureSelection = async (): Promise<void> => {
    try {
      setSelection(await input.captureSelection())
      if (selection) dock.focusInput()
    } catch (error) {
      const key = selectionErrorMessageKey(error)
      statusElement.textContent = msg(key ?? 'dock.startFailed')
      setSelection(null)
      dock.open()
    }
  }
  const closeMenus = (): void => {
    sessionMenu.hidden = true
    modelMenu.hidden = true
    sessionButton.setAttribute('aria-expanded', 'false')
    modelButton.setAttribute('aria-expanded', 'false')
  }
  const openSessionMenu = (): void => {
    const state = sessions.state()
    renderSessionMenu({
      container: sessionMenu, sessions: state.sessions, currentId: state.currentSessionId,
      onNew: () => { sessions.selectSession(null); closeMenus(); refreshHeader(); void loadHistory(null); dock.focusInput() },
      onSelect: (id) => { sessions.selectSession(id); closeMenus(); refreshHeader(); void loadHistory(id); dock.focusInput() },
      onRename: async (id, title) => { await sessions.rename(id, title); closeMenus(); refreshHeader() },
      onDelete: (id) => { pendingDeleteSessionId = id; deleteError.hidden = true; closeMenus(); deleteDialog.showModal(); deleteCancel.focus() },
    })
    modelMenu.hidden = true
    sessionMenu.hidden = false
    sessionButton.setAttribute('aria-expanded', 'true')
    modelButton.setAttribute('aria-expanded', 'false')
  }
  const openModelMenu = (): void => {
    if (starting || activeTaskId) return
    const state = sessions.state()
    renderModelMenu({
      container: modelMenu, providers: state.providers, currentId: state.providerId,
      onSelect: async (id) => { await sessions.selectProvider(id); closeMenus(); refreshHeader(); const provider = sessions.state().providers.find((candidate) => candidate.id === id); if (sessions.state().currentSessionId && provider) renderSystemMessage(messageLog, msg('dock.switchedModel', { name: provider.name })); dock.focusInput() },
      onConfigure: () => { closeMenus(); input.onConfigureModel() },
    })
    sessionMenu.hidden = true
    modelMenu.hidden = false
    sessionButton.setAttribute('aria-expanded', 'false')
    modelButton.setAttribute('aria-expanded', 'true')
  }
  const selectionShortcut = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') closeMenus()
    if (event.metaKey && event.shiftKey && event.key.toLowerCase() === 'j') { event.preventDefault(); void captureSelection() }
  }
  const outsideMenus = (event: PointerEvent): void => {
    const target = event.target as Node
    if (!sessionMenu.contains(target) && !sessionButton.contains(target) && !modelMenu.contains(target) && !modelButton.contains(target)) closeMenus()
  }
  const modelClick = (): void => { modelMenu.hidden ? openModelMenu() : closeMenus() }
  const sessionClick = (): void => { sessionMenu.hidden ? openSessionMenu() : closeMenus() }
  const cancelDelete = (): void => { pendingDeleteSessionId = null; deleteDialog.close() }
  const deleteError = required<HTMLElement>('agent-session-delete-error')
  const confirmDelete = (): void => {
    const id = pendingDeleteSessionId
    if (!id) { deleteDialog.close(); return }
    deleteConfirm.disabled = true
    void sessions.delete(id).then((deleted) => {
      if (!deleted) { deleteError.textContent = msg('dock.sessionActive'); deleteError.hidden = false; return }
      pendingDeleteSessionId = null
      deleteDialog.close(); refreshHeader(); void loadHistory(sessions.state().currentSessionId); openSessionMenu()
    }).catch(() => {
      deleteError.textContent = msg('dock.deleteSessionFailed'); deleteError.hidden = false
    }).finally(() => { deleteConfirm.disabled = false })
  }
  document.addEventListener('keydown', selectionShortcut)
  document.addEventListener('pointerdown', outsideMenus)
  modelButton.addEventListener('click', modelClick)
  sessionButton.addEventListener('click', sessionClick)
  deleteCancel.addEventListener('click', cancelDelete)
  deleteConfirm.addEventListener('click', confirmDelete)
  const disposeTask = input.api.onAgentTaskEvent(onTaskEvent)
  void input.api.listInterruptedTasks().then((items) => renderRecovery(recoveryPanel, input.api, items, (summary) => {
    if (summary.changeSet) renderChangeSet(changeSummary, summary.changeSet, () => { void input.api.undoInterruptedTask(summary.taskId) })
    dock.open()
  }))
  return {
    dock,
    refreshWorkspace,
    dispose() {
      disposeTask(); deltaBatcher.dispose(); dock.dispose(); document.removeEventListener('keydown', selectionShortcut)
      document.removeEventListener('pointerdown', outsideMenus)
      modelButton.removeEventListener('click', modelClick); sessionButton.removeEventListener('click', sessionClick)
      deleteCancel.removeEventListener('click', cancelDelete); deleteConfirm.removeEventListener('click', confirmDelete)
    },
  }
}
