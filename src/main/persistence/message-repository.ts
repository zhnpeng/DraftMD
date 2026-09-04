import type Database from 'better-sqlite3'
import { ModelSwitchSchema, type MessageContent } from '../../shared/contracts/session'

export interface MessageRecord {
  id: string
  sessionId: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: MessageContent
  modelSwitch: unknown | null
  createdAt: string
}
interface MessageRow { id: string; session_id: string; role: MessageRecord['role']; content_json: string; model_switch_json: string | null; created_at: string }
const fromRow = (row: MessageRow): MessageRecord => ({
  id: row.id, sessionId: row.session_id, role: row.role,
  content: JSON.parse(row.content_json) as MessageContent,
  modelSwitch: row.model_switch_json === null ? null : JSON.parse(row.model_switch_json),
  createdAt: row.created_at,
})

export function createMessageRepository(database: Database.Database) {
  const create = database.prepare(`insert into messages
    (id, session_id, role, content_json, model_switch_json, created_at)
    values (@id, @sessionId, @role, @contentJson, @modelSwitchJson, @createdAt)`)
  const list = database.prepare('select * from messages where session_id = ? order by created_at, id')
  const modelSwitches = database.prepare(`select model_switch_json from messages
    where session_id = ? and model_switch_json is not null order by created_at desc, id desc`)
  return {
    create(record: MessageRecord): void {
      create.run({
        id: record.id, sessionId: record.sessionId, role: record.role,
        contentJson: JSON.stringify(record.content),
        modelSwitchJson: record.modelSwitch === null ? null : JSON.stringify(record.modelSwitch),
        createdAt: record.createdAt,
      })
    },
    list(sessionId: string): MessageRecord[] { return (list.all(sessionId) as MessageRow[]).map(fromRow) },
    latestModelSwitch(sessionId: string): string | null {
      const rows = modelSwitches.all(sessionId) as Array<{ model_switch_json: string }>
      for (const row of rows) {
        try {
          const parsed = ModelSwitchSchema.pick({ providerConfigId: true }).safeParse(JSON.parse(row.model_switch_json))
          if (parsed.success) return parsed.data.providerConfigId
        } catch { /* Ignore malformed legacy rows. */ }
      }
      return null
    },
  }
}
