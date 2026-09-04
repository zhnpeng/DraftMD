import { z } from 'zod'
import { ProviderKindSchema } from './provider'
import { TaskStatusSchema } from './agent'

const CredentialLikeValue = /(?:sk-|key-|token-)[A-Za-z0-9_.-]{6,}/i
const SafeNameSchema = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/i)
  .refine((value) => !CredentialLikeValue.test(value), { message: 'Credential-like value is not allowed' })
const SafeCodeSchema = z.string().min(1).max(128).regex(/^[A-Z0-9_]+$/)
const RelativePathSchema = z.string().min(1).max(32_768).refine((path) =>
  !path.includes('\\')
  && !path.includes('\0')
  && !path.startsWith('/')
  && !/^[A-Za-z]:\//.test(path)
  && path.split('/').every((part) => part !== '' && part !== '.' && part !== '..'),
  { message: 'Path must be relative and normalized' },
).refine((value) => !CredentialLikeValue.test(value), { message: 'Credential-like value is not allowed' })

export const SafeLogEntrySchema = z.object({
  timestamp: z.string().datetime({ offset: true }),
  level: z.enum(['debug', 'info', 'warn', 'error']),
  module: SafeNameSchema,
  taskStatus: TaskStatusSchema.optional(),
  providerKind: ProviderKindSchema.optional(),
  code: SafeCodeSchema.optional(),
  path: RelativePathSchema.optional(),
  operation: SafeNameSchema.optional(),
  latencyMs: z.number().int().nonnegative().max(86_400_000).optional(),
  tokenUsage: z.object({
    input: z.number().int().nonnegative(),
    output: z.number().int().nonnegative(),
    cachedInput: z.number().int().nonnegative().optional(),
  }).strict().optional(),
}).strict()

export type SafeLogEntry = z.infer<typeof SafeLogEntrySchema>
export type SafeLogInput = Omit<SafeLogEntry, 'timestamp'>

export const DiagnosticsAppSchema = z.object({
  version: z.string().min(1).max(128),
  electron: z.string().min(1).max(128),
  platform: z.literal('darwin'),
  arch: z.enum(['arm64', 'x64']),
  osRelease: z.string().min(1).max(128),
}).strict()
export const DiagnosticsSettingsSchema = z.object({
  locale: z.enum(['en', 'zh-CN']),
  theme: z.string().min(1).max(128),
}).strict()
export const DiagnosticProviderSchema = z.object({
  name: z.string().min(1).max(256),
  kind: ProviderKindSchema,
  model: z.string().min(1).max(512),
  capability: z.enum(['agent', 'chat-only', 'unavailable']),
  baseHost: z.string().min(1).max(512),
}).strict()
export const DiagnosticsDatabaseSchema = z.object({
  integrity: z.enum(['ok', 'failed', 'unavailable']),
  recoveryWarning: z.enum(['DATABASE_RECOVERED', 'DATABASE_MEMORY_FALLBACK']).nullable(),
}).strict()
export const DiagnosticsBundleSchema = z.object({
  categories: z.tuple([
    z.literal('Application'), z.literal('Safe settings'), z.literal('Provider metadata'),
    z.literal('Safe logs'), z.literal('Database integrity'),
  ]),
  app: DiagnosticsAppSchema,
  settings: DiagnosticsSettingsSchema,
  providers: z.array(DiagnosticProviderSchema).max(100),
  logs: z.array(SafeLogEntrySchema).max(10_000),
  database: DiagnosticsDatabaseSchema,
}).strict()
export type DiagnosticsBundle = z.infer<typeof DiagnosticsBundleSchema>
export type DiagnosticsInput = Omit<DiagnosticsBundle, 'categories'>
