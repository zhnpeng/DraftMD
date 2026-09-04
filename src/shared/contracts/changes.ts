import { z } from 'zod'

const VersionSchema = z.string().regex(/^[a-f0-9]{64}$/)
const BaseChangeSchema = z.object({
  path: z.string().min(1),
  oldPath: z.string().min(1).optional(),
  oldVersion: VersionSchema.nullable(),
  newVersion: VersionSchema.nullable(),
  patch: z.string(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  hunks: z.array(z.object({
    oldStart: z.number().int().nonnegative(), oldLines: z.number().int().nonnegative(),
    newStart: z.number().int().nonnegative(), newLines: z.number().int().nonnegative(),
    lines: z.array(z.string()), linedelimiters: z.array(z.string()).optional(),
  }).strict()),
})
export const FileChangeSchema = z.discriminatedUnion('kind', [
  BaseChangeSchema.extend({ kind: z.literal('created') }).strict(),
  BaseChangeSchema.extend({ kind: z.literal('modified') }).strict(),
  BaseChangeSchema.extend({ kind: z.literal('renamed'), oldPath: z.string().min(1) }).strict(),
  BaseChangeSchema.extend({ kind: z.literal('deleted') }).strict(),
])
export const ChangeSetSchema = z.object({
  taskId: z.string().min(1),
  workspaceId: z.string().regex(/^[a-f0-9]{64}$/),
  changes: z.array(FileChangeSchema),
}).strict()

export type FileChange = z.infer<typeof FileChangeSchema>
export type ChangeSet = z.infer<typeof ChangeSetSchema>


const UndoTextSchema = z.string().max(5 * 1024 * 1024)
export const UndoConflictSchema = z.object({
  path: z.string().min(1).max(32_768),
  base: UndoTextSchema,
  taskFinal: UndoTextSchema,
  current: UndoTextSchema,
}).strict()
export const UndoResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('undone'), files: z.array(z.string().min(1).max(32_768)).max(100) }).strict(),
  z.object({ status: z.literal('conflict'), files: z.array(UndoConflictSchema).min(1).max(100) }).strict(),
])
export type UndoResultDTO = z.infer<typeof UndoResultSchema>
