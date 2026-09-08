import { createHash } from 'node:crypto'

export function workspaceId(canonicalRoot: string, isWindows = process.platform === 'win32'): string {
  const identityPath = isWindows ? canonicalRoot.normalize('NFC').toLowerCase() : canonicalRoot
  return createHash('sha256')
    .update(`draftmd-workspace\0${identityPath}`)
    .digest('hex')
}
