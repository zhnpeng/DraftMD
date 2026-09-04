import { z } from 'zod'
import { ISODateTimeSchema, UUIDv7Schema } from './session'

const JsonPrimitiveSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null()])
export const JsonValueSchema: z.ZodType<unknown> = z.lazy(() => z.union([
  JsonPrimitiveSchema,
  z.array(JsonValueSchema),
  z.record(z.string(), JsonValueSchema),
]))

export const ProviderKindSchema = z.enum(['anthropic', 'openai', 'openai-compatible'])
export const ProviderPresetSchema = z.enum(['none', 'ollama', 'lm-studio'])
export const ProviderCapabilitySchema = z.enum(['agent', 'chat-only', 'unavailable'])
export const ProviderErrorCodeSchema = z.enum([
  'AUTHENTICATION', 'RATE_LIMIT', 'INSUFFICIENT_QUOTA', 'MODEL_NOT_FOUND',
  'CONTEXT_LIMIT', 'TIMEOUT', 'CONNECTION', 'BAD_REQUEST', 'REFUSAL',
  'CANCELLED', 'PROVIDER_ERROR',
])

export const ProviderConfigSchema = z.object({
  id: UUIDv7Schema,
  name: z.string().min(1).max(256),
  kind: ProviderKindSchema,
  preset: ProviderPresetSchema,
  baseUrl: z.string().url().max(4096),
  model: z.string().min(1).max(512),
  credentialRef: UUIDv7Schema.nullable(),
  headerCredentialRefs: z.record(z.string().min(1).max(256), UUIDv7Schema),
  timeoutMs: z.number().int().min(1_000).max(3_600_000),
  streamEnabled: z.boolean(),
  toolsEnabled: z.boolean(),
  insecureHttpApproved: z.boolean(),
  capability: ProviderCapabilitySchema,
  lastTestedAt: ISODateTimeSchema.nullable(),
  lastTestErrorCode: ProviderErrorCodeSchema.nullable(),
}).strict()

export const ToolCallSchema = z.object({
  id: z.string().min(1).max(512),
  name: z.string().min(1).max(256),
  input: JsonValueSchema,
}).strict()

const TextContentSchema = z.object({ type: z.literal('text'), text: z.string() }).strict()
const ToolCallContentSchema = z.object({ type: z.literal('tool-call'), call: ToolCallSchema }).strict()
const ToolResultContentSchema = z.object({
  type: z.literal('tool-result'),
  callId: z.string().min(1).max(512),
  content: JsonValueSchema,
  isError: z.boolean().default(false),
}).strict()
const ProviderMessageContentSchema = z.discriminatedUnion('type', [
  TextContentSchema, ToolCallContentSchema, ToolResultContentSchema,
])

export const ProviderMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  provider: ProviderKindSchema.nullable(),
  content: z.array(ProviderMessageContentSchema),
  providerData: JsonValueSchema.nullable(),
}).strict().superRefine((message, context) => {
  const ids = new Set<string>()
  for (let index = 0; index < message.content.length; index += 1) {
    const block = message.content[index]
    if (block.type !== 'tool-call') continue
    if (ids.has(block.call.id)) {
      context.addIssue({ code: 'custom', message: 'Duplicate tool call id', path: ['content', index, 'call', 'id'] })
    }
    ids.add(block.call.id)
  }
})

const ToolInputSchemaSchema = z.object({
  type: z.literal('object'),
  properties: z.record(z.string(), JsonValueSchema),
  required: z.array(z.string()),
  additionalProperties: z.literal(false),
}).strict()

export const ProviderToolSchema = z.object({
  name: z.string().min(1).max(256),
  description: z.string().min(1).max(4096),
  inputSchema: ToolInputSchemaSchema,
}).strict()

export const ProviderRequestSchema = z.object({
  system: z.string(),
  messages: z.array(ProviderMessageSchema).min(1),
  tools: z.array(ProviderToolSchema),
  maxOutputTokens: z.number().int().positive().max(128_000),
}).strict()

export const NormalizedStopReasonSchema = z.enum([
  'end-turn', 'tool-use', 'max-tokens', 'stop-sequence', 'content-filter', 'refusal', 'unknown',
])

const UsageEventSchema = z.object({
  type: z.literal('usage'),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative().optional(),
}).strict()
export const ProviderEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text-delta'), text: z.string() }).strict(),
  z.object({ type: z.literal('tool-call'), call: ToolCallSchema }).strict(),
  UsageEventSchema,
  z.object({
    type: z.literal('completed'),
    stopReason: NormalizedStopReasonSchema,
    assistantMessage: ProviderMessageSchema,
  }).strict(),
])

export type JsonValue = z.infer<typeof JsonValueSchema>
export type ProviderPreset = z.infer<typeof ProviderPresetSchema>
export type ProviderKind = z.infer<typeof ProviderKindSchema>
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>
export type ProviderCapability = z.infer<typeof ProviderCapabilitySchema>
export type ProviderErrorCode = z.infer<typeof ProviderErrorCodeSchema>
export type ProviderMessage = z.infer<typeof ProviderMessageSchema>
export type ProviderRequest = z.infer<typeof ProviderRequestSchema>
export type ProviderEvent = z.infer<typeof ProviderEventSchema>
export type ProviderTool = z.infer<typeof ProviderToolSchema>
export type ToolCall = z.infer<typeof ToolCallSchema>
export type NormalizedStopReason = z.infer<typeof NormalizedStopReasonSchema>

export const ProviderConfigInputSchema = z.object({
  id: UUIDv7Schema.optional(),
  name: z.string().min(1).max(256),
  kind: ProviderKindSchema,
  preset: ProviderPresetSchema,
  baseUrl: z.string().url().max(4096),
  model: z.string().min(1).max(512),
  timeoutMs: z.number().int().min(1_000).max(3_600_000),
  streamEnabled: z.boolean(),
  toolsEnabled: z.boolean(),
  insecureHttpApproved: z.boolean(),
}).strict()

export const ProviderSecretsInputSchema = z.object({
  apiKey: z.string().max(32_768).optional(),
  removeApiKey: z.boolean().optional(),
  headers: z.record(z.string().min(1).max(256), z.string().max(32_768)).optional(),
  removeHeaders: z.array(z.string().min(1).max(256)).optional(),
}).strict()

export const ProviderConfigDTOSchema = z.object({
  id: UUIDv7Schema,
  name: z.string().min(1).max(256),
  kind: ProviderKindSchema,
  preset: ProviderPresetSchema,
  baseUrl: z.string().url().max(4096),
  model: z.string().min(1).max(512),
  timeoutMs: z.number().int().min(1_000).max(3_600_000),
  streamEnabled: z.boolean(),
  toolsEnabled: z.boolean(),
  insecureHttpApproved: z.boolean(),
  capability: ProviderCapabilitySchema,
  lastTestedAt: ISODateTimeSchema.nullable(),
  lastTestErrorCode: ProviderErrorCodeSchema.nullable(),
  hasCredential: z.boolean(),
  headerNames: z.array(z.string().min(1).max(256)),
  isDefault: z.boolean(),
}).strict()

export const CapabilityTestResultSchema = z.object({
  capability: ProviderCapabilitySchema,
  cancelled: z.boolean(),
  latencyMs: z.number().int().nonnegative().nullable(),
  model: z.string().nullable(),
  errorCode: ProviderErrorCodeSchema.nullable(),
  warning: z.string().nullable(),
}).strict()

export type ProviderConfigInput = z.infer<typeof ProviderConfigInputSchema>
export type ProviderSecretsInput = z.infer<typeof ProviderSecretsInputSchema>
export type ProviderConfigDTO = z.infer<typeof ProviderConfigDTOSchema>
export type CapabilityTestResult = z.infer<typeof CapabilityTestResultSchema>
