import { z } from 'zod'

export const AppBootstrapSchema = z.object({
  locale: z.enum(['zh-CN', 'en']),
  platform: z.literal('darwin'),
  appVersion: z.string().min(1).max(128),
  databaseWarning: z.enum(['DATABASE_RECOVERED', 'DATABASE_MEMORY_FALLBACK']).nullable(),
}).strict()

export type AppBootstrap = z.infer<typeof AppBootstrapSchema>
