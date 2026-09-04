import { mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { openDraftMDDatabase } from '../../../src/main/persistence/database'
import { createSessionRepository } from '../../../src/main/persistence/session-repository'
import { createWorkspaceRepository } from '../../../src/main/persistence/workspace-repository'

const timestamp = '2026-09-02T00:00:00.000Z'

describe('corrupt database recovery', () => {
  it('isolates malformed SQLite and creates a durable fresh database', async () => {
    const root = await mkdtemp(join(tmpdir(), 'draftmd-corrupt-db-'))
    const path = join(root, 'draftmd.sqlite')
    const malformed = Buffer.from('DRAFTMD malformed database sentinel')
    await writeFile(path, malformed)

    const recovered = openDraftMDDatabase(path)
    expect(recovered.warning).toEqual({ code: 'DATABASE_RECOVERED' })
    const files = await readdir(root)
    const isolated = files.filter((name) => /^draftmd\.corrupt\.\d+\.sqlite$/.test(name))
    expect(isolated).toHaveLength(1)
    expect(await readFile(join(root, isolated[0]))).toEqual(malformed)

    const workspaces = createWorkspaceRepository(recovered.database)
    const sessions = createSessionRepository(recovered.database)
    workspaces.upsert({ id: 'a'.repeat(64), name: 'Workspace', canonicalPath: '/tmp/workspace', updatedAt: timestamp })
    sessions.create({
      id: '01991d5a-1c00-7000-8000-000000000001', workspaceId: 'a'.repeat(64), title: 'Recovered',
      createdAt: timestamp, updatedAt: timestamp,
    })
    expect(sessions.list('a'.repeat(64))).toHaveLength(1)
    expect((await stat(path)).size).toBeGreaterThan(0)
    recovered.database.close()

    const reopened = openDraftMDDatabase(path)
    expect(reopened.warning).toBeNull()
    expect(createSessionRepository(reopened.database).list('a'.repeat(64))[0]?.title).toBe('Recovered')
    reopened.database.close()
  })
})
