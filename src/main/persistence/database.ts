import type DatabaseType from 'better-sqlite3'
import { runtimeModule } from '../app/runtime-module-loader'

const Database = runtimeModule('better-sqlite3') as typeof DatabaseType
import { renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { migrateDatabase } from './migrate'

export interface DatabaseRecoveryWarning {
  code: 'DATABASE_RECOVERED' | 'DATABASE_MEMORY_FALLBACK'
}

export interface OpenDatabaseResult {
  database: DatabaseType.Database
  warning: DatabaseRecoveryWarning | null
}

interface OpenDatabaseOptions {
  createDatabase?(path: string): DatabaseType.Database
}

function configure(database: DatabaseType.Database): void {
  database.pragma('journal_mode = WAL')
  database.pragma('foreign_keys = ON')
  database.pragma('busy_timeout = 5000')
  migrateDatabase(database)
}

function create(path: string, factory: (path: string) => DatabaseType.Database): DatabaseType.Database {
  const database = factory(path)
  try {
    configure(database)
    return database
  } catch (error) {
    database.close()
    throw error
  }
}

export function openDraftMDDatabase(path: string, options: OpenDatabaseOptions = {}): OpenDatabaseResult {
  const factory = options.createDatabase ?? ((target: string) => new Database(target))
  try {
    return { database: create(path, factory), warning: null }
  } catch {
    const isolated = join(dirname(path), `draftmd.corrupt.${Date.now()}.sqlite`)
    try {
      renameSync(path, isolated)
    } catch {
      // A missing or locked database still gets one clean creation attempt.
    }
    try {
      return { database: create(path, factory), warning: { code: 'DATABASE_RECOVERED' } }
    } catch {
      return { database: create(':memory:', factory), warning: { code: 'DATABASE_MEMORY_FALLBACK' } }
    }
  }
}
