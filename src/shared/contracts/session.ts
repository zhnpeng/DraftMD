import { z } from 'zod'

export const UUIDv7Schema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
export const ISODateTimeSchema = z.string().datetime({ offset: true })
export const SessionSchema = z.object({
  id: UUIDv7Schema,
  workspaceId: z.string().regex(/^[a-f0-9]{64}$/),
  title: z.string().min(1).max(512),
  createdAt: ISODateTimeSchema,
  updatedAt: ISODateTimeSchema,
}).strict()

export const MessageContentSchema = z.array(z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }).strict(),
  z.object({ type: z.literal('tool-call'), id: z.string(), name: z.string(), input: z.unknown() }).strict(),
  z.object({ type: z.literal('tool-result'), id: z.string(), content: z.unknown() }).strict(),
]))

export type Session = z.infer<typeof SessionSchema>
export type MessageContent = z.infer<typeof MessageContentSchema>

export const SessionDTOSchema = SessionSchema.extend({
  providerConfigId: UUIDv7Schema.nullable(),
}).strict()
export type SessionDTO = z.infer<typeof SessionDTOSchema>
export const SessionCreateSchema = z.object({
  workspaceId: z.string().regex(/^[a-f0-9]{64}$/),
  title: z.string().min(1).max(512),
}).strict()
export const SessionRenameSchema = z.object({
  id: UUIDv7Schema,
  title: z.string().min(1).max(512),
}).strict()
export const ModelSwitchSchema = z.object({
  sessionId: UUIDv7Schema,
  providerConfigId: UUIDv7Schema,
}).strict()
