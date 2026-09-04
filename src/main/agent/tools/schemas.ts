import { z } from 'zod'
import type { ToolCall } from '../../../shared/contracts/provider'

const MAX_CONTENT_BYTES = 5 * 1024 * 1024
const RelativeMarkdownPathSchema = z.string().min(1).max(32_768)
  .refine((path) => !path.includes('\0') && !path.includes('\\') && !path.startsWith('/')
    && !path.split('/').some((part) => !part || part === '.' || part === '..')
    && /\.(?:md|markdown)$/i.test(path), 'Invalid relative Markdown path')
const VersionSchema = z.string().regex(/^[a-f0-9]{64}$/)
const ContentSchema = z.string().refine((value) => Buffer.byteLength(value, 'utf8') <= MAX_CONTENT_BYTES, 'Content exceeds 5 MiB')

export const toolInputSchemas = {
  list_markdown_files: z.object({}).strict(),
  search_markdown: z.object({ query: z.string().trim().min(1).max(1_024), limit: z.number().int().min(1).max(50).optional() }).strict(),
  read_markdown: z.object({
    path: RelativeMarkdownPathSchema,
    heading: z.string().trim().min(1).max(1_024).optional(),
    startLine: z.number().int().positive().optional(),
    endLine: z.number().int().positive().optional(),
  }).strict().refine((value) => value.startLine === undefined || value.endLine === undefined || value.startLine <= value.endLine, 'startLine must not exceed endLine'),
  create_markdown: z.object({ path: RelativeMarkdownPathSchema, content: ContentSchema }).strict(),
  edit_markdown: z.object({
    path: RelativeMarkdownPathSchema, oldText: z.string().min(1), newText: ContentSchema,
    expectedVersion: VersionSchema,
  }).strict(),
  rename_markdown: z.object({ from: RelativeMarkdownPathSchema, to: RelativeMarkdownPathSchema, expectedVersion: VersionSchema }).strict(),
  delete_markdown: z.object({
    path: RelativeMarkdownPathSchema, expectedVersion: VersionSchema,
    reason: z.string().trim().min(1).max(1_024),
  }).strict(),
} as const

export type ToolName = keyof typeof toolInputSchemas
export type ParsedToolCall = {
  [Name in ToolName]: { id: string; name: Name; input: z.infer<(typeof toolInputSchemas)[Name]> }
}[ToolName]

export class ToolCallValidationError extends Error {
  readonly code = 'INVALID_TOOL_CALL'
  constructor(readonly tool: string) {
    super('INVALID_TOOL_CALL')
    this.name = 'ToolCallValidationError'
  }
}

export function parseToolCall(call: ToolCall): ParsedToolCall {
  if (!(call.name in toolInputSchemas)) throw new ToolCallValidationError(call.name)
  const name = call.name as ToolName
  const parsed = toolInputSchemas[name].safeParse(call.input)
  if (!parsed.success) throw new ToolCallValidationError(name)
  return { id: call.id, name, input: parsed.data } as ParsedToolCall
}
