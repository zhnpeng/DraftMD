import { z } from 'zod'

export const WorkspaceDescriptorSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/),
  name: z.string().min(1).max(1024),
}).strict()

export type WorkspaceDescriptor = z.infer<typeof WorkspaceDescriptorSchema>


export const TextEditSchema = z.object({
  oldText: z.string().min(1),
  newText: z.string(),
  expectedOccurrences: z.literal(1).default(1),
}).strict()

export type TextEdit = z.infer<typeof TextEditSchema>
