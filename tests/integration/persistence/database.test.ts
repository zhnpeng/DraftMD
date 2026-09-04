import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { openDraftMDDatabase } from '../../../src/main/persistence/database'
import { migrateDatabase, type Migration } from '../../../src/main/persistence/migrate'

async function databasePath(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), 'draftmd-database-')), 'draftmd.sqlite')
}

describe('DraftMD database bootstrap', () => {
  it('migrates an empty database once with WAL, foreign keys, and busy timeout enabled', async () => {
    const path = await databasePath()
    const first = openDraftMDDatabase(path)
    try {
      expect(first.warning).toBeNull()
      expect(first.database.pragma('journal_mode', { simple: true })).toBe('wal')
      expect(first.database.pragma('foreign_keys', { simple: true })).toBe(1)
      expect(first.database.pragma('busy_timeout', { simple: true })).toBe(5_000)
      expect(first.database.prepare('select version from schema_migrations').all()).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }])
    } finally {
      first.database.close()
    }

    const second = openDraftMDDatabase(path)
    try {
      expect(second.database.prepare('select version from schema_migrations').all()).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }])
    } finally {
      second.database.close()
    }
  })

  it('rolls back every statement in a failed migration', async () => {
    const path = await databasePath()
    const opened = openDraftMDDatabase(path)
    const invalid: Migration[] = [{
      version: 4,
      name: 'invalid',
      sql: 'create table should_rollback (id text); insert into missing_table values (1);',
    }]
    try {
      expect(() => migrateDatabase(opened.database, invalid)).toThrow()
      expect(opened.database.prepare("select name from sqlite_master where name = 'should_rollback'").get()).toBeUndefined()
      expect(opened.database.prepare('select version from schema_migrations where version = 4').get()).toBeUndefined()
    } finally {
      opened.database.close()
    }
  })

  it('isolates a corrupt database and recreates usable persistence', async () => {
    const path = await databasePath()
    await writeFile(path, 'not a sqlite database')

    const opened = openDraftMDDatabase(path)
    try {
      expect(opened.warning).toEqual({ code: 'DATABASE_RECOVERED' })
      expect(opened.database.prepare('select version from schema_migrations').get()).toEqual({ version: 1 })
      const files = await readdir(join(path, '..'))
      const isolated = files.find((name) => /^draftmd\.corrupt\.\d+\.sqlite$/.test(name))
      expect(isolated).toBeDefined()
      expect(await readFile(join(path, '..', isolated!), 'utf8')).toBe('not a sqlite database')
    } finally {
      opened.database.close()
    }
  })
})

it('falls back to an in-memory database when disk open and recovery both fail', async () => {
  const path = await databasePath()
  const { default: Database } = await import('better-sqlite3')
  let diskAttempts = 0
  const factory = (target: string) => {
    if (target !== ':memory:') {
      diskAttempts += 1
      throw new Error('disk unavailable')
    }
    return new Database(':memory:')
  }

  const opened = openDraftMDDatabase(path, { createDatabase: factory })
  try {
    expect(opened.warning).toEqual({ code: 'DATABASE_MEMORY_FALLBACK' })
    expect(diskAttempts).toBe(2)
    expect(opened.database.prepare('select version from schema_migrations order by version').all()).toEqual([
      { version: 1 }, { version: 2 }, { version: 3 },
    ])
  } finally { opened.database.close() }
})
