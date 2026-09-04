import { expect, it } from 'vitest'
import { createTaskWindowRegistry } from '../../../src/main/agent/task-window-registry'

it('binds each task to one window and releases all tasks on window close', () => {
  const registry = createTaskWindowRegistry()
  registry.register('task-a', 1)
  registry.register('task-b', 1)
  registry.register('task-c', 2)
  expect(registry.owns('task-a', 1)).toBe(true)
  expect(registry.owns('task-a', 2)).toBe(false)
  expect(registry.tasksForWindow(1)).toEqual(['task-a', 'task-b'])
  registry.releaseWindow(1)
  expect(registry.owns('task-a', 1)).toBe(false)
  expect(registry.tasksForWindow(2)).toEqual(['task-c'])
})
