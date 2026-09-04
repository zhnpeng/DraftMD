export function createTaskWindowRegistry() {
  const owners = new Map<string, number>()
  return {
    register(taskId: string, windowId: number): void { owners.set(taskId, windowId) },
    owns(taskId: string, windowId: number): boolean { return owners.get(taskId) === windowId },
    tasksForWindow(windowId: number): string[] {
      return [...owners].filter(([, owner]) => owner === windowId).map(([taskId]) => taskId).sort()
    },
    releaseTask(taskId: string): void { owners.delete(taskId) },
    releaseWindow(windowId: number): void {
      for (const [taskId, owner] of owners) if (owner === windowId) owners.delete(taskId)
    },
  }
}
