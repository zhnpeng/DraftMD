import type Database from 'better-sqlite3'
import type { TaskStatus } from '../../shared/contracts/agent'

export interface InterruptedTaskContext {
  task: TaskRecord
  workspace: { id: string; name: string; canonicalPath: string }
}

export interface TaskRecord {
  id: string
  sessionId: string
  status: TaskStatus
  createdAt: string
  updatedAt: string
}
interface TaskRow { id: string; session_id: string; status: TaskStatus; created_at: string; updated_at: string }
const fromRow = (row: TaskRow): TaskRecord => ({
  id: row.id, sessionId: row.session_id, status: row.status,
  createdAt: row.created_at, updatedAt: row.updated_at,
})

export function createTaskRepository(database: Database.Database) {
  const create = database.prepare(`insert into tasks (id, session_id, status, created_at, updated_at)
    values (@id, @sessionId, @status, @createdAt, @updatedAt)`)
  const get = database.prepare('select * from tasks where id = ?')
  const listIds = database.prepare('select id from tasks')
  const latestForSession = database.prepare('select * from tasks where session_id = ? order by created_at desc, id desc limit 1')
  const listInterrupted = database.prepare("select * from tasks where status in ('preparing', 'running', 'waiting-approval') order by created_at")
  const listInterruptedContexts = database.prepare(`select
    t.id, t.session_id, t.status, t.created_at, t.updated_at,
    w.id as workspace_id, w.name as workspace_name, w.canonical_path
    from tasks t join sessions s on s.id = t.session_id join workspaces w on w.id = s.workspace_id
    where t.status in ('preparing', 'running', 'waiting-approval') order by t.created_at`)
  const transition = database.prepare('update tasks set status = ?, updated_at = ? where id = ? and status = ?')
  return {
    create(record: TaskRecord): void { create.run(record) },
    listIds(): string[] { return (listIds.all() as Array<{ id: string }>).map(row => row.id) },
    get(id: string): TaskRecord | null {
      const row = get.get(id) as TaskRow | undefined
      return row ? fromRow(row) : null
    },
    latestForSession(sessionId: string): TaskRecord | null {
      const row = latestForSession.get(sessionId) as TaskRow | undefined
      return row ? fromRow(row) : null
    },
    listInterrupted(): TaskRecord[] { return (listInterrupted.all() as TaskRow[]).map(fromRow) },
    listInterruptedContexts(): InterruptedTaskContext[] {
      return (listInterruptedContexts.all() as Array<TaskRow & { workspace_id: string; workspace_name: string; canonical_path: string }>).map((row) => ({
        task: fromRow(row), workspace: { id: row.workspace_id, name: row.workspace_name, canonicalPath: row.canonical_path },
      }))
    },
    transition(id: string, from: TaskStatus, to: TaskStatus, updatedAt: string): boolean {
      return transition.run(to, updatedAt, id, from).changes === 1
    },
  }
}
