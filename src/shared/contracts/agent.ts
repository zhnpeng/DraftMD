import { z } from 'zod'
import { ChangeSetSchema } from './changes'
import { UUIDv7Schema } from './session'


const MAX_SELECTION_BYTES = 20 * 1024
const BoundedSelectionTextSchema = z.string().min(1).refine(
  (value) => new TextEncoder().encode(value).byteLength <= MAX_SELECTION_BYTES,
  { message: 'Selection exceeds 20 KiB' },
)

export const SelectionReferenceSchema = z.object({
  workspaceId: z.string().regex(/^[a-f0-9]{64}$/),
  path: z.string().min(1).max(32_768),
  headingPath: z.array(z.string().min(1).max(1_024)).max(32),
  selectedText: BoundedSelectionTextSchema,
  beforeAnchor: z.string().max(200),
  afterAnchor: z.string().max(200),
  sourceMode: z.boolean(),
  version: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()
export type SelectionReference = z.infer<typeof SelectionReferenceSchema>

export const TaskStatusSchema = z.enum([
  'preparing', 'running', 'waiting-approval', 'completed', 'partial-complete',
  'stopped', 'failed', 'undone', 'undo-conflict',
])

const SequenceSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const EventBase = { taskId: UUIDv7Schema, sequence: SequenceSchema }
const SafeSummarySchema = z.string().min(1).max(1_024)
const SafeCodeSchema = z.string().min(1).max(128).regex(/^[A-Z0-9_]+$/)

export const TaskEventSchema = z.discriminatedUnion('type', [
  z.object({ ...EventBase, type: z.literal('status'), status: TaskStatusSchema }).strict(),
  z.object({ ...EventBase, type: z.literal('assistant-text-delta'), text: z.string() }).strict(),
  z.object({
    ...EventBase, type: z.literal('tool-start'), callId: z.string().min(1).max(512),
    tool: z.string().min(1).max(256), action: z.string().min(1).max(128),
    path: z.string().min(1).max(32_768).nullable(), summary: SafeSummarySchema,
  }).strict(),
  z.object({
    ...EventBase, type: z.literal('tool-result'), callId: z.string().min(1).max(512),
    tool: z.string().min(1).max(256), ok: z.boolean(), code: SafeCodeSchema.nullable(),
    summary: SafeSummarySchema,
  }).strict(),
  z.object({
    ...EventBase, type: z.literal('approval-request'), approvalId: z.string().min(1).max(512),
    path: z.string().min(1).max(32_768), reason: SafeSummarySchema,
    expectedVersion: z.string().regex(/^[a-f0-9]{64}$/), stale: z.boolean(),
  }).strict(),
  z.object({
    ...EventBase, type: z.literal('usage'), inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(), cachedInputTokens: z.number().int().nonnegative().optional(),
  }).strict(),
  z.object({
    ...EventBase, type: z.literal('error'), code: SafeCodeSchema, retryable: z.boolean(),
  }).strict(),
  z.object({ ...EventBase, type: z.literal('change-set'), changeSet: ChangeSetSchema }).strict(),
])

export type TaskStatus = z.infer<typeof TaskStatusSchema>
export type TaskEvent = z.infer<typeof TaskEventSchema>



export const SessionHistorySchema = z.object({
  liveTask: z.object({
    taskId: UUIDv7Schema,
    mode: z.enum(['agent', 'suggestion']),
    events: z.array(TaskEventSchema).max(100_000),
  }).strict().optional(),
  messages: z.array(z.discriminatedUnion('role', [
    z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(5 * 1024 * 1024) }).strict(),
    z.object({ role: z.literal('model-switch'), providerConfigId: UUIDv7Schema }).strict(),
  ])).max(10_000),
  latestTask: z.object({
    id: UUIDv7Schema,
    status: TaskStatusSchema,
    activities: z.array(z.object({
      callId: z.string().min(1).max(512),
      tool: z.string().min(1).max(256),
      action: z.string().min(1).max(128),
      path: z.string().min(1).max(32_768).nullable(),
      summary: z.string().min(1).max(1_024),
      status: z.enum(['running', 'success', 'error']),
      code: z.string().min(1).max(128).regex(/^[A-Z0-9_]+$/).nullable(),
    }).strict()).max(10_000),
  }).strict().nullable(),
}).strict()
export type SessionHistoryDTO = z.infer<typeof SessionHistorySchema>

export const ApprovalDecisionSchema = z.object({
  taskId: UUIDv7Schema,
  approvalId: z.string().min(1).max(512),
  decision: z.enum(['approve', 'deny']),
}).strict()

export const InterruptedTaskSummarySchema = z.object({
  taskId: UUIDv7Schema,
  status: z.enum(['partial-complete', 'stopped']),
  changeSet: ChangeSetSchema.nullable(),
}).strict()

export type InterruptedTaskSummaryDTO = z.infer<typeof InterruptedTaskSummarySchema>


export const AgentStartInputSchema = z.object({
  workspaceId: z.string().regex(/^[a-f0-9]{64}$/),
  sessionId: UUIDv7Schema.optional(),
  providerConfigId: UUIDv7Schema,
  prompt: z.string().trim().min(1).max(100_000),
  currentPath: z.string().max(32_768).nullable(),
  currentContent: z.string().max(5 * 1024 * 1024).nullable(),
  selection: SelectionReferenceSchema.nullable(),
}).strict()
export const AgentStartResultSchema = z.object({
  mode: z.enum(['agent', 'suggestion']),
  taskId: UUIDv7Schema.nullable(),
  sessionId: UUIDv7Schema,
  suggestion: z.string().nullable(),
}).strict()
