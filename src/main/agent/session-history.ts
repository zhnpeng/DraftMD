import { z } from 'zod'
import { ModelSwitchSchema } from '../../shared/contracts/session'
import {
  SessionHistorySchema,
  type SessionHistoryDTO,
  type TaskStatus,
} from '../../shared/contracts/agent'
import type { MessageRecord } from '../persistence/message-repository'
import type { TaskRecord } from '../persistence/task-repository'
import type { ToolActivityRecord } from '../persistence/tool-activity-repository'

const SafeCodeSchema = z.string().min(1).max(128).regex(/^[A-Z0-9_]+$/)
const ToolStartPayloadSchema = z.object({
  callId: z.string().min(1).max(512),
  tool: z.string().min(1).max(256),
  action: z.string().min(1).max(128),
  path: z.string().min(1).max(32_768).nullable(),
  summary: z.string().min(1).max(1_024).optional(),
}).passthrough()
const ToolResultPayloadSchema = z.object({
  callId: z.string().min(1).max(512),
  tool: z.string().min(1).max(256),
  ok: z.boolean(),
  code: SafeCodeSchema.nullable(),
}).passthrough()

export function buildSessionHistory(input: {
  messages: MessageRecord[]
  task: TaskRecord | null
  activities: ToolActivityRecord[]
}): SessionHistoryDTO {
  const messages: SessionHistoryDTO['messages'] = []
  for (const message of input.messages) {
    if (message.role === 'system') {
      const marker = ModelSwitchSchema.pick({ providerConfigId: true }).safeParse(message.modelSwitch)
      if (marker.success) messages.push({ role: 'model-switch', providerConfigId: marker.data.providerConfigId })
      continue
    }
    if (message.role !== 'user' && message.role !== 'assistant') continue
    const text = message.content
      .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
      .map((block) => block.text)
      .join('')
    if (text) messages.push({ role: message.role, text })
  }

  let latestTask: SessionHistoryDTO['latestTask'] = null
  if (input.task) {
    const starts = new Map<string, {
      callId: string
      tool: string
      action: string
      path: string | null
      summary: string
      status: 'running' | 'success' | 'error'
      code: string | null
    }>()
    for (const activity of input.activities) {
      if (activity.kind === 'tool-start') {
        const parsed = ToolStartPayloadSchema.safeParse(activity.payload)
        if (!parsed.success) continue
        starts.set(parsed.data.callId, {
          callId: parsed.data.callId,
          tool: parsed.data.tool,
          action: parsed.data.action,
          path: parsed.data.path,
          summary: parsed.data.summary ?? `${parsed.data.action} ${parsed.data.path ?? 'workspace'}`,
          status: 'running',
          code: null,
        })
      } else if (activity.kind === 'tool-result') {
        const parsed = ToolResultPayloadSchema.safeParse(activity.payload)
        if (!parsed.success) continue
        const started = starts.get(parsed.data.callId)
        if (!started || started.tool !== parsed.data.tool) continue
        started.status = parsed.data.ok ? 'success' : 'error'
        started.code = parsed.data.code
      }
    }
    latestTask = {
      id: input.task.id,
      status: input.task.status as TaskStatus,
      activities: [...starts.values()],
    }
  }
  return SessionHistorySchema.parse({ messages, latestTask })
}
