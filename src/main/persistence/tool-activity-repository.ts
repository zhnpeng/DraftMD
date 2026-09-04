import type Database from 'better-sqlite3'

export interface ToolActivityRecord {
  id: string
  taskId: string
  kind: string
  payload: unknown
  createdAt: string
}

export function createToolActivityRepository(database: Database.Database) {
  const create = database.prepare(`insert into tool_activities (id, task_id, kind, payload_json, created_at)
    values (@id, @taskId, @kind, @payloadJson, @createdAt)`)
  const list = database.prepare('select * from tool_activities where task_id = ? order by created_at, id')
  return {
    create(record: ToolActivityRecord): void {
      create.run({ ...record, payloadJson: JSON.stringify(record.payload) })
    },
    list(taskId: string): ToolActivityRecord[] {
      return (list.all(taskId) as Array<{ id: string; task_id: string; kind: string; payload_json: string; created_at: string }>).map((row) => ({
        id: row.id, taskId: row.task_id, kind: row.kind, payload: JSON.parse(row.payload_json), createdAt: row.created_at,
      }))
    },
  }
}
