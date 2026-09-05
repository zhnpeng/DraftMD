import { describe, expect, it, vi } from 'vitest'
import { createAgentAppService, initialSessionTitle } from '../../../src/main/agent/agent-app-service'

it('creates deterministic Unicode-safe session titles capped at 40 characters', () => {
  expect(initialSessionTitle('  Update the product specification with offline mode  ')).toBe('Update the product specification with of')
  expect(Array.from(initialSessionTitle('😀'.repeat(50)))).toHaveLength(40)
})

function setup() {
  const workspace = { descriptor: { id: 'a'.repeat(64), name: 'Project' }, root: { canonicalPath: '/work/project', device: 1, inode: 1 } }
  const sessions = {
    list: vi.fn(() => []), get: vi.fn(), create: vi.fn(), rename: vi.fn(() => true), delete: vi.fn(() => true),
  }
  const workspaces = { upsert: vi.fn() }
  const tasks = { latestForSession: vi.fn(() => null) }
  const activities = { list: vi.fn(() => []) }
  const messages = { create: vi.fn(), list: vi.fn(() => []), latestModelSwitch: vi.fn(() => null) }
  const service = createAgentAppService({
    workspaceManager: { current: vi.fn(() => workspace) }, workspaces, sessions, messages, tasks, activities,
    providers: { materialize: vi.fn() }, runtimeFactory: vi.fn(), runtimeRegistry: { register: vi.fn(), stop: vi.fn() },
    now: () => '2026-09-01T12:00:00.000Z', createId: (() => { let i = 0; return () => `01991d5a-1c00-7000-8000-${String(i++).padStart(12, '0')}` })(),
  } as never)
  return { service, workspace, sessions, workspaces, messages, tasks, activities }
}

it('isolates session listing to the active window workspace', () => {
  const test = setup()
  expect(test.service.listSessions({ id: 1 } as never, 'a'.repeat(64))).toEqual([])
  expect(() => test.service.listSessions({ id: 1 } as never, 'b'.repeat(64))).toThrowError(expect.objectContaining({ code: 'WORKSPACE_MISMATCH' }))
  expect(test.sessions.list).toHaveBeenCalledWith('a'.repeat(64))
})

it('lists each session with its latest persisted provider selection', () => {
  const test = setup()
  const session = {
    id: '01991d5a-1c00-7000-8000-000000000020', workspaceId: 'a'.repeat(64), title: 'Persisted',
    createdAt: '2026-09-01T12:00:00.000Z', updatedAt: '2026-09-01T12:00:00.000Z',
  }
  test.sessions.list.mockReturnValue([session])
  test.messages.latestModelSwitch.mockReturnValue('01991d5a-1c00-7000-8000-000000000021')
  expect(test.service.listSessions({ id: 1 } as never, 'a'.repeat(64))).toEqual([{
    ...session, providerConfigId: '01991d5a-1c00-7000-8000-000000000021',
  }])
})

it('loads safe history only for a session owned by the active workspace', () => {
  const test = setup()
  const session = {
    id: '01991d5a-1c00-7000-8000-000000000030', workspaceId: 'a'.repeat(64), title: 'History',
    createdAt: '2026-09-01T12:00:00.000Z', updatedAt: '2026-09-01T12:00:00.000Z',
  }
  test.sessions.get.mockReturnValue(session)
  test.messages.list.mockReturnValue([{ id: 'm', sessionId: session.id, role: 'user', content: [{ type: 'text', text: 'Hello' }], modelSwitch: null, createdAt: session.createdAt }])
  test.tasks.latestForSession.mockReturnValue(null)
  expect(test.service.sessionHistory({ id: 1 } as never, session.id)).toEqual({
    messages: [{ role: 'user', text: 'Hello' }], latestTask: null,
  })
  test.sessions.get.mockReturnValue({ ...session, workspaceId: 'b'.repeat(64) })
  expect(() => test.service.sessionHistory({ id: 1 } as never, session.id)).toThrowError(expect.objectContaining({ code: 'SESSION_NOT_FOUND' }))
})

it('creates the workspace row before a session and never touches Markdown', () => {
  const test = setup()
  const session = test.service.createSession({ id: 1 } as never, { workspaceId: 'a'.repeat(64), title: 'New session' })
  expect(test.workspaces.upsert).toHaveBeenCalledBefore(test.sessions.create)
  expect(session).toMatchObject({ workspaceId: 'a'.repeat(64), title: 'New session' })
  expect(JSON.stringify(test.service)).not.toContain('deleteMarkdown')
})

it('rejects rename and delete for a session outside the active workspace', () => {
  const test = setup()
  test.sessions.get.mockReturnValue({ id: 'session', workspaceId: 'b'.repeat(64) })
  expect(() => test.service.renameSession({ id: 1 } as never, { id: 'session', title: 'Nope' })).toThrowError(expect.objectContaining({ code: 'SESSION_NOT_FOUND' }))
  expect(() => test.service.deleteSession({ id: 1 } as never, 'session')).toThrowError(expect.objectContaining({ code: 'SESSION_NOT_FOUND' }))
})

it.each(['preparing', 'running', 'waiting-approval'])('does not delete a session with a %s task', (status) => {
  const test = setup()
  test.sessions.get.mockReturnValue({ id: 'session', workspaceId: test.workspace.descriptor.id })
  test.tasks.latestForSession.mockReturnValue({ id: 'task', status } as never)
  expect(test.service.deleteSession({ id: 1 } as never, 'session')).toBe(false)
  expect(test.sessions.delete).not.toHaveBeenCalled()
  expect(() => test.service.switchModel({ id: 1 } as never, { sessionId: 'session', providerConfigId: 'other' })).toThrowError(expect.objectContaining({ code: 'TASK_ACTIVE' }))
})

it('protects a session and window while provider preparation is pending, then releases a failed start', async () => {
  let rejectStart!: (error: Error) => void
  const workspaceId = 'a'.repeat(64)
  const session = { id: 'session', workspaceId }
  const remove = vi.fn(() => true)
  const startTask = vi.fn(() => new Promise<never>((_resolve, reject) => { rejectStart = reject }))
  const service = createAgentAppService({
    workspaceManager: { current: () => ({ descriptor: { id: workspaceId }, root: {} }) },
    sessions: { get: () => session, delete: remove },
    messages: { latestModelSwitch: () => 'provider' }, tasks: { latestForSession: () => null },
    runtimeRegistry: {}, startTask,
  } as never)
  const input = { workspaceId, sessionId: session.id, providerConfigId: 'provider', prompt: 'Hello', currentPath: null, currentContent: null, selection: null }
  const starting = service.start({ id: 1 } as never, input)
  expect(service.deleteSession({ id: 1 } as never, session.id)).toBe(false)
  await expect(service.start({ id: 1 } as never, input)).rejects.toMatchObject({ code: 'TASK_ACTIVE' })
  await expect(service.start({ id: 2 } as never, input)).rejects.toMatchObject({ code: 'TASK_ACTIVE' })
  expect(startTask).toHaveBeenCalledOnce()
  rejectStart(new Error('Provider unavailable'))
  await expect(starting).rejects.toThrow('Provider unavailable')
  expect(service.deleteSession({ id: 1 } as never, session.id)).toBe(true)
})

it('auto-creates a first session and delegates one authorized task start', async () => {
  const workspace = { descriptor: { id: 'a'.repeat(64), name: 'Project' }, root: { canonicalPath: '/work/project', device: 1, inode: 1 } }
  const sessions = { list: vi.fn(() => []), get: vi.fn(), create: vi.fn(), rename: vi.fn(), delete: vi.fn() }
  const startTask = vi.fn().mockResolvedValue({ mode: 'agent', taskId: '01991d5a-1c00-7000-8000-000000000099', suggestion: null })
  const service = createAgentAppService({
    workspaceManager: { current: () => workspace }, workspaces: { upsert: vi.fn() }, sessions,
    messages: { create: vi.fn(), list: vi.fn(() => []), latestModelSwitch: vi.fn(() => null) }, tasks: { latestForSession: vi.fn(() => null) }, activities: { list: vi.fn(() => []) }, providers: { materialize: vi.fn() },
    runtimeFactory: vi.fn(), runtimeRegistry: { register: vi.fn() }, startTask,
    now: () => '2026-09-01T12:00:00.000Z',
    createId: (() => { let i = 0; return () => `01991d5a-1c00-7000-8000-${String(i++).padStart(12, '0')}` })(),
  } as never)

  await expect(service.start({ id: 7 } as never, {
    workspaceId: workspace.descriptor.id, providerConfigId: '01991d5a-1c00-7000-8000-000000000010',
    prompt: 'Create a detailed technical design for offline mode that covers recovery',
    currentPath: 'spec.md', currentContent: '# Spec', selection: null,
  })).resolves.toEqual({
    mode: 'agent', taskId: '01991d5a-1c00-7000-8000-000000000099',
    sessionId: '01991d5a-1c00-7000-8000-000000000000', suggestion: null,
  })
  expect(sessions.create).toHaveBeenCalledWith(expect.objectContaining({
    id: '01991d5a-1c00-7000-8000-000000000000',
    title: 'Create a detailed technical design for o',
  }))
  expect(startTask).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), expect.objectContaining({
    session: expect.objectContaining({ id: '01991d5a-1c00-7000-8000-000000000000' }),
  }))
})
