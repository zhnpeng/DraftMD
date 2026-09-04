import { z } from 'zod'

export const MAX_DOCUMENT_LENGTH = Number.MAX_SAFE_INTEGER
export const MAX_PATH_LENGTH = 32 * 1024

const DocumentContentSchema = z.string().max(MAX_DOCUMENT_LENGTH)
const FilePathSchema = z.string().min(1).max(MAX_PATH_LENGTH)

export const DocumentSnapshotSchema = z.object({
  dirty: z.boolean(),
  content: DocumentContentSchema,
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict()

export const FileOpenedSchema = z.object({
  path: FilePathSchema.nullable(),
  content: DocumentContentSchema,
  version: z.string().min(1).max(256).nullable(),
}).strict()

const SiblingNameSchema = z.string().min(1).max(1024)
export const SiblingFileSchema = z.discriminatedUnion('kind', [
  z.object({ name: SiblingNameSchema, path: FilePathSchema, kind: z.literal('file') }).strict(),
  z.object({ name: SiblingNameSchema, path: FilePathSchema, kind: z.literal('directory') }).strict(),
  z.object({ name: SiblingNameSchema, path: z.string().max(MAX_PATH_LENGTH), kind: z.literal('parent') }).strict(),
])

export type DocumentSnapshot = z.infer<typeof DocumentSnapshotSchema>
export type FileOpened = z.infer<typeof FileOpenedSchema>
export type SiblingFile = z.infer<typeof SiblingFileSchema>
