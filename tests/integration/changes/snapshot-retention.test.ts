import { mkdtemp, mkdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openDraftMDDatabase } from '../../../src/main/persistence/database'
import { createTaskRepository } from '../../../src/main/persistence/task-repository'
import { createSessionRepository } from '../../../src/main/persistence/session-repository'
import { createWorkspaceRepository } from '../../../src/main/persistence/workspace-repository'
import { cleanupSnapshotsAfterRecovery } from '../../../src/main/changes/snapshot-retention'

const now = new Date('2026-09-05T12:00:00Z')
const old = new Date('2026-07-01T00:00:00Z')
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup() })

async function setup() {
  const userDataPath = await mkdtemp(join(tmpdir(), 'draftmd-retention-'))
  const { database } = openDraftMDDatabase(join(userDataPath, 'draftmd.sqlite'))
  cleanups.push(async () => { database.close(); await rm(userDataPath, { recursive: true, force: true }) })
  const tasks = createTaskRepository(database)
  const sessions = createSessionRepository(database)
  const workspaces = createWorkspaceRepository(database)
  const log = vi.fn()
  async function snapshot(id: string, workspaceId = 'workspace', modified = old) {
    const path = join(userDataPath, 'snapshots', workspaceId, id)
    await mkdir(path, { recursive: true })
    await writeFile(join(path, 'baseline.md'), '# Keep recovery bytes\n')
    await utimes(path, modified, modified)
    return path
  }
  const options = { userDataPath, tasks, recovery: Promise.resolve(), databaseWarning: null, log, now }
  return { database, tasks, sessions, workspaces, log, snapshot, options, userDataPath }
}

describe('startup snapshot retention', () => {
  it('keeps all persisted task references across sessions and statuses, and ages only orphan snapshots', async () => {
    const fixture = await setup()
    const { tasks, sessions, workspaces, snapshot, options, userDataPath } = fixture
    const retained: string[] = []
    for (const [index, status] of ['completed', 'running', 'undone', 'failed', 'preparing', 'waiting-approval', 'stopped', 'partial-complete'].entries()) {
      const workspaceId = `workspace-${index % 2}`
      workspaces.upsert({ id: workspaceId, name: 'Project', canonicalPath: join(userDataPath, workspaceId), updatedAt: now.toISOString() })
      const sessionId = `session-${index}`
      sessions.create({ id: sessionId, workspaceId, title: 'Session', createdAt: old.toISOString(), updatedAt: old.toISOString() })
      for (const suffix of ['older', 'latest']) {
        const id = `task-${index}-${suffix}`
        tasks.create({ id, sessionId, status: status as Parameters<typeof tasks.create>[0]['status'], createdAt: old.toISOString(), updatedAt: old.toISOString() })
        retained.push(await snapshot(id, workspaceId))
      }
    }
    const expired = await snapshot('orphan')
    const recent = await snapshot('recent', 'workspace', now)
    const boundary = await snapshot('boundary', 'workspace', new Date(now.getTime() - 30 * 86_400_000))
    const document = join(userDataPath, 'original.md')
    await writeFile(document, '# Original\n')

    await cleanupSnapshotsAfterRecovery(options)

    for (const path of [...retained, recent, boundary, document]) await expect(stat(path)).resolves.toBeDefined()
    await expect(stat(expired)).rejects.toMatchObject({ code: 'ENOENT' })
    sessions.delete('session-0')
    await cleanupSnapshotsAfterRecovery(options)
    await expect(stat(retained[0])).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(retained[2])).resolves.toBeDefined()
  })

  it('waits for recovery before evaluating references or removing snapshots', async () => {
    const { snapshot, options } = await setup()
    const expired = await snapshot('orphan')
    let finish!: () => void
    const recovery = new Promise<void>((resolve) => { finish = resolve })
    const pending = cleanupSnapshotsAfterRecovery({ ...options, recovery })
    await new Promise((resolve) => setImmediate(resolve))
    await expect(stat(expired)).resolves.toBeDefined()
    finish()
    await pending
    await expect(stat(expired)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each(['DATABASE_RECOVERED', 'DATABASE_MEMORY_FALLBACK'] as const)('preserves snapshots when %s is reported', async (code) => {
    const { snapshot, options, log } = await setup()
    const expired = await snapshot('orphan')
    await cleanupSnapshotsAfterRecovery({ ...options, databaseWarning: { code } })
    await expect(stat(expired)).resolves.toBeDefined()
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ code: 'SNAPSHOT_CLEANUP_SKIPPED_DATABASE' }))
  })

  it('preserves snapshots on later launches while a quarantined database exists', async () => {
    const { snapshot, options, userDataPath, log } = await setup()
    const expired = await snapshot('orphan')
    await writeFile(join(userDataPath, 'draftmd.corrupt.1788609600000.sqlite'), 'unrecovered database')
    await cleanupSnapshotsAfterRecovery(options)
    await expect(stat(expired)).resolves.toBeDefined()
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ code: 'SNAPSHOT_CLEANUP_SKIPPED_DATABASE' }))
  })

  it('logs a safe failure and preserves snapshots when task recovery fails', async () => {
    const { snapshot, options, log } = await setup()
    const expired = await snapshot('orphan')
    await expect(cleanupSnapshotsAfterRecovery({ ...options, recovery: Promise.reject(new Error('/private/document.md')) })).resolves.toBeUndefined()
    await expect(stat(expired)).resolves.toBeDefined()
    expect(log).toHaveBeenCalledWith({ level: 'warn', module: 'snapshots', operation: 'cleanup', code: 'SNAPSHOT_CLEANUP_FAILED' })
  })

  it('tolerates missing snapshots and catches reference-query failures', async () => {
    const { snapshot, options, tasks, log } = await setup()
    await cleanupSnapshotsAfterRecovery(options)
    expect(log).not.toHaveBeenCalled()
    const expired = await snapshot('orphan')
    vi.spyOn(tasks, 'listIds').mockImplementation(() => { throw new Error('private database error') })
    await expect(cleanupSnapshotsAfterRecovery(options)).resolves.toBeUndefined()
    await expect(stat(expired)).resolves.toBeDefined()
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ code: 'SNAPSHOT_CLEANUP_FAILED' }))
  })

  it('does not reject background maintenance if diagnostic storage is unavailable', async () => {
    const { options } = await setup()
    await expect(cleanupSnapshotsAfterRecovery({
      ...options, databaseWarning: { code: 'DATABASE_RECOVERED' },
      log: () => { throw new Error('disk full') },
    })).resolves.toBeUndefined()
  })
})
