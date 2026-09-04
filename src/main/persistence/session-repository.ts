import type Database from 'better-sqlite3'
import type { Session } from '../../shared/contracts/session'

interface SessionRow { id: string; workspace_id: string; title: string; created_at: string; updated_at: string }
const fromRow = (row: SessionRow): Session => ({
  id: row.id, workspaceId: row.workspace_id, title: row.title,
  createdAt: row.created_at, updatedAt: row.updated_at,
})

export function createSessionRepository(database: Database.Database) {
  const create = database.prepare(`insert into sessions (id, workspace_id, title, created_at, updated_at)
    values (@id, @workspaceId, @title, @createdAt, @updatedAt)`)
  const get = database.prepare('select * from sessions where id = ?')
  const rename = database.prepare('update sessions set title = ?, updated_at = ? where id = ?')
  const remove = database.prepare('delete from sessions where id = ?')
  const list = database.prepare('select * from sessions where workspace_id = ? order by updated_at desc, id desc')
  return {
    create(record: Session): void { create.run(record) },
    get(id: string): Session | null { const row = get.get(id) as SessionRow | undefined; return row ? fromRow(row) : null },
    rename(id: string, title: string, updatedAt: string): boolean { return rename.run(title, updatedAt, id).changes === 1 },
    delete(id: string): boolean { return remove.run(id).changes === 1 },
    list(workspaceId: string): Session[] { return (list.all(workspaceId) as SessionRow[]).map(fromRow) },
  }
}
