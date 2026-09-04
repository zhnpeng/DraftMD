import type { BrowserWindow } from 'electron'
import type { TaskEvent } from '../../shared/contracts/agent'
import type { AgentTaskResult } from './agent-runtime'
import { createTaskWindowRegistry } from './task-window-registry'

interface TaskHandle {
  events: AsyncIterable<TaskEvent>
  stop(): void
  respondToApproval(id: string, decision: 'approve' | 'deny'): boolean
  done: Promise<AgentTaskResult>
}

export function createRuntimeRegistry(input: {
  send(win: BrowserWindow, event: TaskEvent): void
}) {
  const windows = createTaskWindowRegistry()
  const handles = new Map<string, TaskHandle>()
  const browserWindows = new Map<number, BrowserWindow>()
  return {
    register(taskId: string, win: BrowserWindow, handle: TaskHandle): void {
      windows.register(taskId, win.id)
      browserWindows.set(win.id, win)
      handles.set(taskId, handle)
      void (async () => {
        try {
          for await (const event of handle.events) if (windows.owns(taskId, win.id)) input.send(win, event)
          await handle.done
        } finally {
          handles.delete(taskId)
          windows.releaseTask(taskId)
        }
      })()
    },
    respond(win: BrowserWindow, decision: { taskId: string; approvalId: string; decision: 'approve' | 'deny' }): boolean {
      if (!windows.owns(decision.taskId, win.id)) return false
      return handles.get(decision.taskId)?.respondToApproval(decision.approvalId, decision.decision) ?? false
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
