import { createHash } from 'node:crypto'

export function workspaceId(canonicalRoot: string): string {
  return createHash('sha256')
    .update(`draftmd-workspace\0${canonicalRoot}`)
    .digest('hex')
}
