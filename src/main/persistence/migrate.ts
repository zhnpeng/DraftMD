import type Database from 'better-sqlite3'
import initialMigration from './migrations/001_initial.sql?raw'
import providerConfigMigration from './migrations/002_provider_configs.sql?raw'
import providerTestMetadataMigration from './migrations/003_provider_test_metadata.sql?raw'

export interface Migration {
  version: number
  name: string
  sql: string
}

export const migrations: Migration[] = [
  { version: 1, name: 'initial', sql: initialMigration },
  { version: 2, name: 'provider-configs', sql: providerConfigMigration },
  { version: 3, name: 'provider-test-metadata', sql: providerTestMetadataMigration },
]

export function migrateDatabase(database: Database.Database, pending: Migration[] = migrations): void {
  database.exec(`create table if not exists schema_migrations (
    version integer primary key,
    name text not null,
    applied_at text not null
  )`)
  const applied = new Set((database.prepare('select version from schema_migrations').all() as Array<{ version: number }>)
    .map(({ version }) => version))
  const apply = database.transaction((migration: Migration) => {
    database.exec(migration.sql)
    database.prepare('insert into schema_migrations (version, name, applied_at) values (?, ?, ?)')
      .run(migration.version, migration.name, new Date().toISOString())
  })
  for (const migration of [...pending].sort((left, right) => left.version - right.version)) {
    if (!applied.has(migration.version)) apply(migration)
  }
}
