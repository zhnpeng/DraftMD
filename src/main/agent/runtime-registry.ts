import type { BrowserWindow } from 'electron'
import type { SessionHistoryDTO, TaskEvent } from '../../shared/contracts/agent'
import type { AgentTaskResult } from './agent-runtime'
import { createTaskWindowRegistry } from './task-window-registry'

export interface TaskHandle {
  events: AsyncIterable<TaskEvent>
  stop(): void
  respondToApproval(id: string, decision: 'approve' | 'deny'): boolean
  done: Promise<AgentTaskResult>
}

interface SessionContext {
  sessionId: string
  mode: 'agent' | 'suggestion'
  messages: SessionHistoryDTO['messages']
}

export function createRuntimeRegistry(input: {
  send(win: BrowserWindow, event: TaskEvent): void
}) {
  const windows = createTaskWindowRegistry()
  const handles = new Map<string, TaskHandle>()
  const browserWindows = new Map<number, BrowserWindow>()
  const sessions = new Map<string, SessionContext & { events: TaskEvent[] }>()
  return {
    hasActiveSession(sessionId: string): boolean {
      return [...sessions.values()].some(context => context.sessionId === sessionId)
    },
    hasActiveWindow(windowId: number): boolean { return windows.tasksForWindow(windowId).length > 0 },
    sessionSnapshot(sessionId: string, windowId: number): SessionHistoryDTO | null {
      for (const [taskId, context] of sessions) {
        if (context.sessionId === sessionId && windows.owns(taskId, windowId)) return structuredClone({
          messages: context.messages, latestTask: null,
          liveTask: { taskId, mode: context.mode, events: context.events },
        })
      }
      return null
    },
    register(taskId: string, win: BrowserWindow, handle: TaskHandle, context?: SessionContext): void {
      windows.register(taskId, win.id)
      browserWindows.set(win.id, win)
      handles.set(taskId, handle)
      if (context) sessions.set(taskId, { ...context, events: [] })
      void (async () => {
        try {
          for await (const event of handle.events) {
            const history = sessions.get(taskId)?.events
            if (history) {
              const previous = history.at(-1)
              if (event.type === 'assistant-text-delta' && previous?.type === 'assistant-text-delta') {
                history[history.length - 1] = { ...event, text: previous.text + event.text }
              } else history.push(event)
            }
            if (windows.owns(taskId, win.id)) input.send(win, event)
          }
          await handle.done
        } finally {
          handles.delete(taskId)
          sessions.delete(taskId)
          windows.releaseTask(taskId)
        }
      })()
    },
    respond(win: BrowserWindow, decision: { taskId: string; approvalId: string; decision: 'approve' | 'deny' }): boolean {
      if (!windows.owns(decision.taskId, win.id)) return false
      const accepted = handles.get(decision.taskId)?.respondToApproval(decision.approvalId, decision.decision) ?? false
      const context = sessions.get(decision.taskId)
      if (accepted && context) context.events = context.events.filter(event => event.type !== 'approval-request' || event.approvalId !== decision.approvalId)
      return accepted
    },
    stop(taskId: string, windowId: number): boolean {
      if (!windows.owns(taskId, windowId)) return false
      const handle = handles.get(taskId)
      if (!handle) return false
      handle.stop()
      return true
    },
    closeWindow(win: BrowserWindow): void {
      for (const taskId of windows.tasksForWindow(win.id)) handles.get(taskId)?.stop()
      windows.releaseWindow(win.id)
      browserWindows.delete(win.id)
    },
    stopAll(): void { for (const handle of handles.values()) handle.stop() },
  }
}
