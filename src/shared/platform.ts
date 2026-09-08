import { z } from 'zod'

export const DesktopPlatformSchema = z.enum(['darwin', 'win32'])
export type DesktopPlatform = z.infer<typeof DesktopPlatformSchema>

export function isPrimaryModifier(event: { metaKey: boolean; ctrlKey: boolean }, platform: string): boolean {
  return platform === 'darwin' ? event.metaKey : event.ctrlKey
}
