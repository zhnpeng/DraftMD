import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { openDraftMDDatabase } from '../../../src/main/persistence/database'
import { createMessageRepository } from '../../../src/main/persistence/message-repository'
import { createSessionRepository } from '../../../src/main/persistence/session-repository'
import { createTaskRepository } from '../../../src/main/persistence/task-repository'
import { createWorkspaceRepository } from '../../../src/main/persistence/workspace-repository'
import { uuidv7 } from '../../../src/main/persistence/ids'

async function setup() {
  const path = join(await mkdtemp(join(tmpdir(), 'draftmd-repository-')), 'draftmd.sqlite')
  const opened = openDraftMDDatabase(path)
  return {
    database: opened.database,
    workspaces: createWorkspaceRepository(opened.database),
    sessions: createSessionRepository(opened.database),
    messages: createMessageRepository(opened.database),
    tasks: createTaskRepository(opened.database),
  }
}

const now = '2026-09-01T12:00:00.000Z'

describe('DraftMD persistence repositories', () => {
  it('stores workspace, session, message, and task records through explicit methods', async () => {
    const stores = await setup()
    const workspaceId = 'a'.repeat(64)
    const sessionId = uuidv7(1_788_264_000_000)
    const messageId = uuidv7(1_788_264_000_001)
    const taskId = uuidv7(1_788_264_000_002)
    try {
      stores.workspaces.upsert({ id: workspaceId, name: 'Project', canonicalPath: '/work/project', updatedAt: now })
      stores.sessions.create({ id: sessionId, workspaceId, title: 'First session', createdAt: now, updatedAt: now })
      stores.messages.create({
        id: messageId,
        sessionId,
        role: 'user',
        content: [{ type: 'text', text: 'Update the spec' }],
        modelSwitch: null,
        createdAt: now,
      })
      stores.tasks.create({ id: taskId, sessionId, status: 'preparing', createdAt: now, updatedAt: now })

      expect(stores.workspaces.get(workspaceId)).toEqual({
        id: workspaceId, name: 'Project', canonicalPath: '/work/project', updatedAt: now,
      })
      expect(stores.sessions.list(workspaceId)).toEqual([
        { id: sessionId, workspaceId, title: 'First session', createdAt: now, updatedAt: now },
      ])
      expect(stores.messages.list(sessionId)).toEqual([{
        id: messageId,
        sessionId,
        role: 'user',
        content: [{ type: 'text', text: 'Update the spec' }],
        modelSwitch: null,
        createdAt: now,
      }])
      expect(stores.tasks.get(taskId)?.status).toBe('preparing')
    } finally {
      stores.database.close()
    }
  })

  it('transitions task state only when the expected current state matches', async () => {
    const stores = await setup()
    const workspaceId = 'b'.repeat(64)
    const sessionId = uuidv7(1_788_264_100_000)
    const taskId = uuidv7(1_788_264_100_001)
    try {
      stores.workspaces.upsert({ id: workspaceId, name: 'Project', canonicalPath: '/work/project', updatedAt: now })
      stores.sessions.create({ id: sessionId, workspaceId, title: 'Session', createdAt: now, updatedAt: now })
      stores.tasks.create({ id: taskId, sessionId, status: 'preparing', createdAt: now, updatedAt: now })

      expect(stores.tasks.transition(taskId, 'running', 'completed', now)).toBe(false)
      expect(stores.tasks.transition(taskId, 'preparing', 'running', now)).toBe(true)
      expect(stores.tasks.transition(taskId, 'preparing', 'failed', now)).toBe(false)
      expect(stores.tasks.get(taskId)?.status).toBe('running')
    } finally {
      stores.database.close()
    }
  })

  it('cascades workspace deletion through sessions, messages, and tasks', async () => {
    const stores = await setup()
    const workspaceId = 'c'.repeat(64)
    const sessionId = uuidv7(1_788_264_200_000)
    const messageId = uuidv7(1_788_264_200_001)
    const taskId = uuidv7(1_788_264_200_002)
    try {
      stores.workspaces.upsert({ id: workspaceId, name: 'Project', canonicalPath: '/work/project', updatedAt: now })
      stores.sessions.create({ id: sessionId, workspaceId, title: 'Session', createdAt: now, updatedAt: now })
      stores.messages.create({ id: messageId, sessionId, role: 'assistant', content: [], modelSwitch: null, createdAt: now })
      stores.tasks.create({ id: taskId, sessionId, status: 'preparing', createdAt: now, updatedAt: now })

      expect(stores.workspaces.delete(workspaceId)).toBe(true)
      expect(stores.sessions.list(workspaceId)).toEqual([])
      expect(stores.messages.list(sessionId)).toEqual([])
      expect(stores.tasks.get(taskId)).toBeNull()
    } finally {
      stores.database.close()
    }
  })

  it('rejects invalid task states and never persists provider secret material', async () => {
    const stores = await setup()
    try {
      expect(() => stores.database.prepare(`insert into tasks
        (id, session_id, status, created_at, updated_at)
        values (?, ?, ?, ?, ?)`)
        .run(uuidv7(), uuidv7(), 'unknown', now, now)).toThrow()
      const providerColumns = stores.database.prepare('pragma table_info(provider_configs)').all() as Array<{ name: string }>
      expect(providerColumns.map((column) => column.name)).toContain('credential_ref')
      expect(providerColumns.map((column) => column.name)).not.toContain('api_key')
      expect(providerColumns.map((column) => column.name)).not.toContain('secret')
    } finally {
      stores.database.close()
    }
  })
})

describe('UUIDv7 identifiers', () => {
  it('encode time order and use the RFC version and variant bits', () => {
    const earlier = uuidv7(1_700_000_000_000, new Uint8Array(10).fill(0))
    const later = uuidv7(1_700_000_000_001, new Uint8Array(10).fill(0))

    expect(earlier).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(earlier < later).toBe(true)
  })
})

it('renames and deletes sessions without touching workspace Markdown', async () => {
  const stores = await setup()
  const workspaceId = 'd'.repeat(64)
  const sessionId = uuidv7(1_788_264_300_000)
  try {
    stores.workspaces.upsert({ id: workspaceId, name: 'Project', canonicalPath: '/work/project', updatedAt: now })
    stores.sessions.create({ id: sessionId, workspaceId, title: 'Original', createdAt: now, updatedAt: now })
    expect(stores.sessions.rename(sessionId, 'Renamed', '2026-09-01T12:01:00.000Z')).toBe(true)
    expect(stores.sessions.get(sessionId)?.title).toBe('Renamed')
    expect(stores.sessions.delete(sessionId)).toBe(true)
    expect(stores.sessions.get(sessionId)).toBeNull()
  } finally { stores.database.close() }
})


it('returns the latest persisted model switch for a session', async () => {
  const stores = await setup()
  const workspaceId = 'e'.repeat(64)
  const sessionId = uuidv7(1_788_264_400_000)
  const firstProvider = uuidv7(1_788_264_400_001)
  const secondProvider = uuidv7(1_788_264_400_002)
  try {
    stores.workspaces.upsert({ id: workspaceId, name: 'Project', canonicalPath: '/work/project', updatedAt: now })
    stores.sessions.create({ id: sessionId, workspaceId, title: 'Session', createdAt: now, updatedAt: now })
    expect(stores.messages.latestModelSwitch(sessionId)).toBeNull()
    stores.messages.create({
      id: uuidv7(1_788_264_400_003), sessionId, role: 'system', content: [],
      modelSwitch: { providerConfigId: firstProvider }, createdAt: '2026-09-01T12:01:00.000Z',
    })
    stores.messages.create({
      id: uuidv7(1_788_264_400_004), sessionId, role: 'system', content: [],
      modelSwitch: { providerConfigId: secondProvider }, createdAt: '2026-09-01T12:02:00.000Z',
    })
    expect(stores.messages.latestModelSwitch(sessionId)).toBe(secondProvider)
  } finally { stores.database.close() }
})


it('returns only the latest task for a session', async () => {
  const stores = await setup()
  const workspaceId = 'f'.repeat(64)
  const sessionId = uuidv7(1_788_264_500_000)
  const firstTask = uuidv7(1_788_264_500_001)
  const latestTask = uuidv7(1_788_264_500_002)
  try {
    stores.workspaces.upsert({ id: workspaceId, name: 'Project', canonicalPath: '/work/project', updatedAt: now })
    stores.sessions.create({ id: sessionId, workspaceId, title: 'Session', createdAt: now, updatedAt: now })
    expect(stores.tasks.latestForSession(sessionId)).toBeNull()
    stores.tasks.create({ id: firstTask, sessionId, status: 'completed', createdAt: '2026-09-01T12:01:00.000Z', updatedAt: '2026-09-01T12:01:01.000Z' })
    stores.tasks.create({ id: latestTask, sessionId, status: 'failed', createdAt: '2026-09-01T12:02:00.000Z', updatedAt: '2026-09-01T12:02:01.000Z' })
    expect(stores.tasks.latestForSession(sessionId)).toMatchObject({ id: latestTask, status: 'failed' })
  } finally { stores.database.close() }
})
