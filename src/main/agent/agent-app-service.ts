import type { BrowserWindow } from 'electron'
import { buildSessionHistory } from './session-history'
import type { WorkspaceRoot } from '../workspace/path-guard'
import type { SelectionReference, SessionHistoryDTO } from '../../shared/contracts/agent'
import type { Session, SessionDTO } from '../../shared/contracts/session'

export function initialSessionTitle(prompt: string): string {
  return Array.from(prompt.trim()).slice(0, 40).join('') || 'New conversation'
}

export class AgentAppServiceError extends Error {
  constructor(readonly code: 'WORKSPACE_REQUIRED' | 'WORKSPACE_MISMATCH' | 'SESSION_NOT_FOUND' | 'PROVIDER_UNAVAILABLE' | 'TASK_ACTIVE') {
    super(code)
    this.name = 'AgentAppServiceError'
  }
}

interface ActiveWorkspace {
  descriptor: { id: string; name: string }
  root: WorkspaceRoot
}

export function createAgentAppService(deps: {
  workspaceManager: { current(windowId: number): ActiveWorkspace | null }
  workspaces: { upsert(record: { id: string; name: string; canonicalPath: string; updatedAt: string }): void }
  sessions: {
    list(workspaceId: string): Session[]
    get(id: string): Session | null
    create(session: Session): void
    rename(id: string, title: string, updatedAt: string): boolean
    delete(id: string): boolean
  }
  messages: { create(record: unknown): void; list(sessionId: string): any[]; latestModelSwitch(sessionId: string): string | null }
  tasks: { latestForSession(sessionId: string): any | null }
  activities: { list(taskId: string): any[] }
  providers: { materialize(id: string): Promise<unknown> }
  runtimeFactory: (...args: unknown[]) => unknown
  runtimeRegistry: {
    register(...args: unknown[]): void
    stop?(taskId: string, windowId: number): boolean
    hasActiveSession?(sessionId: string): boolean
    hasActiveWindow?(windowId: number): boolean
    sessionSnapshot?(sessionId: string, windowId: number): SessionHistoryDTO | null
  }
  startTask?(win: BrowserWindow, input: { session: Session; workspace: ActiveWorkspace; providerConfigId: string; prompt: string; currentPath: string | null; currentContent: string | null; selection: SelectionReference | null }): Promise<{ mode: 'agent' | 'suggestion'; taskId: string | null; suggestion: string | null }>
  now(): string
  createId(): string
}) {
  const preparingWindows = new Set<number>()
  const preparingSessions = new Set<string>()
  const sessionBusy = (id: string): boolean => preparingSessions.has(id)
    || !!deps.runtimeRegistry.hasActiveSession?.(id)
    || ['preparing', 'running', 'waiting-approval'].includes(deps.tasks.latestForSession(id)?.status)
  const activeWorkspace = (win: BrowserWindow, expectedId?: string): ActiveWorkspace => {
    const workspace = deps.workspaceManager.current(win.id)
    if (!workspace) throw new AgentAppServiceError('WORKSPACE_REQUIRED')
    if (expectedId && workspace.descriptor.id !== expectedId) throw new AgentAppServiceError('WORKSPACE_MISMATCH')
    return workspace
  }
  const ownedSession = (win: BrowserWindow, id: string): Session => {
    const workspace = activeWorkspace(win)
    const session = deps.sessions.get(id)
    if (!session || session.workspaceId !== workspace.descriptor.id) throw new AgentAppServiceError('SESSION_NOT_FOUND')
    return session
  }
  return {
    listSessions(win: BrowserWindow, workspaceId: string): SessionDTO[] {
      activeWorkspace(win, workspaceId)
      return deps.sessions.list(workspaceId).map((session) => ({
        ...session, providerConfigId: deps.messages.latestModelSwitch(session.id),
      }))
    },
    sessionHistory(win: BrowserWindow, sessionId: string) {
      ownedSession(win, sessionId)
      const live = deps.runtimeRegistry.sessionSnapshot?.(sessionId, win.id)
      if (live) return live
      const task = deps.tasks.latestForSession(sessionId)
      return buildSessionHistory({
        messages: deps.messages.list(sessionId),
        task,
        activities: task ? deps.activities.list(task.id) : [],
      })
    },
    createSession(win: BrowserWindow, input: { workspaceId: string; title: string }): SessionDTO {
      const workspace = activeWorkspace(win, input.workspaceId)
      const timestamp = deps.now()
      deps.workspaces.upsert({
        id: workspace.descriptor.id, name: workspace.descriptor.name,
        canonicalPath: workspace.root.canonicalPath, updatedAt: timestamp,
      })
      const session: Session = {
        id: deps.createId(), workspaceId: input.workspaceId, title: input.title,
        createdAt: timestamp, updatedAt: timestamp,
      }
      deps.sessions.create(session)
      return { ...session, providerConfigId: null }
    },
    renameSession(win: BrowserWindow, input: { id: string; title: string }): boolean {
      ownedSession(win, input.id)
      return deps.sessions.rename(input.id, input.title, deps.now())
    },
    deleteSession(win: BrowserWindow, id: string): boolean {
      ownedSession(win, id)
      if (sessionBusy(id)) return false
      return deps.sessions.delete(id)
    },
    async start(win: BrowserWindow, input: {
      workspaceId: string; sessionId?: string; providerConfigId: string; prompt: string;
      currentPath: string | null; currentContent: string | null; selection: SelectionReference | null
    }): Promise<{ mode: 'agent' | 'suggestion'; taskId: string | null; sessionId: string; suggestion: string | null }> {
      const workspace = activeWorkspace(win, input.workspaceId)
      if (preparingWindows.has(win.id) || deps.runtimeRegistry.hasActiveWindow?.(win.id)) throw new AgentAppServiceError('TASK_ACTIVE')
      let session = input.sessionId ? ownedSession(win, input.sessionId) : null
      if (session && sessionBusy(session.id)) throw new AgentAppServiceError('TASK_ACTIVE')
      if (!session) session = this.createSession(win, {
        workspaceId: input.workspaceId,
        title: initialSessionTitle(input.prompt),
      })
      if (!deps.startTask) throw new AgentAppServiceError('PROVIDER_UNAVAILABLE')
      if (deps.messages.latestModelSwitch(session.id) !== input.providerConfigId) {
        deps.messages.create({
          id: deps.createId(), sessionId: session.id, role: 'system', content: [],
          modelSwitch: { providerConfigId: input.providerConfigId }, createdAt: deps.now(),
        })
      }
      preparingWindows.add(win.id)
      preparingSessions.add(session.id)
      try {
        const result = await deps.startTask(win, {
          session, workspace, providerConfigId: input.providerConfigId, prompt: input.prompt,
          currentPath: input.currentPath, currentContent: input.currentContent, selection: input.selection,
        })
        return { ...result, sessionId: session.id }
      } finally {
        preparingWindows.delete(win.id)
        preparingSessions.delete(session.id)
      }
    },
    switchModel(win: BrowserWindow, input: { sessionId: string; providerConfigId: string }): void {
      ownedSession(win, input.sessionId)
      if (sessionBusy(input.sessionId)) throw new AgentAppServiceError('TASK_ACTIVE')
      deps.messages.create({
        id: deps.createId(), sessionId: input.sessionId, role: 'system', content: [],
        modelSwitch: { providerConfigId: input.providerConfigId }, createdAt: deps.now(),
      })
    },
  }
}
