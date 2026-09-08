export function resolveDefaultBrowsePath(input: {
  explicitPath?: string | null
  documents: string
  desktop: string
  existsSync(path: string): boolean
}): string | null {
  if (input.explicitPath) return input.explicitPath
  if (input.existsSync(input.documents)) return input.documents
  return input.existsSync(input.desktop) ? input.desktop : null
}

export function createDefaultBrowsePathResolver(input: {
  platform?: NodeJS.Platform
  getPath(name: 'documents' | 'desktop'): string
  existsSync(path: string): boolean
}): () => string | null {
  return () => {
    if (!['darwin', 'win32'].includes(input.platform ?? process.platform)) return null
    const documents = input.getPath('documents')
    if (input.existsSync(documents)) return documents
    const desktop = input.getPath('desktop')
    return input.existsSync(desktop) ? desktop : null
  }
}
