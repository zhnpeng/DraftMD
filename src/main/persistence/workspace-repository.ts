import type Database from 'better-sqlite3'

export interface WorkspaceRecord {
  id: string
  name: string
  canonicalPath: string
  updatedAt: string
}

interface WorkspaceRow { id: string; name: string; canonical_path: string; updated_at: string }
const fromRow = (row: WorkspaceRow): WorkspaceRecord => ({
  id: row.id, name: row.name, canonicalPath: row.canonical_path, updatedAt: row.updated_at,
})

export function createWorkspaceRepository(database: Database.Database) {
  const upsert = database.prepare(`insert into workspaces (id, name, canonical_path, updated_at)
    values (@id, @name, @canonicalPath, @updatedAt)
    on conflict(id) do update set name = excluded.name, canonical_path = excluded.canonical_path, updated_at = excluded.updated_at`)
  const get = database.prepare('select * from workspaces where id = ?')
  const remove = database.prepare('delete from workspaces where id = ?')
  return {
    upsert(record: WorkspaceRecord): void { upsert.run(record) },
    get(id: string): WorkspaceRecord | null {
      const row = get.get(id) as WorkspaceRow | undefined
      return row ? fromRow(row) : null
    },
    delete(id: string): boolean { return remove.run(id).changes === 1 },
  }
}
