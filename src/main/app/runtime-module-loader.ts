import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

export function createRuntimeModuleLoader(input: {
  resourcesPath?: string
  currentFile: string
  exists?: (path: string) => boolean
  createRequire?: typeof createRequire
}): NodeJS.Require {
  const runtimeRoot = input.resourcesPath ? join(input.resourcesPath, 'node_modules') : null
  const root = runtimeRoot && (input.exists ?? existsSync)(runtimeRoot)
    ? join(input.resourcesPath!, 'runtime-entry.cjs')
    : input.currentFile
  return (input.createRequire ?? createRequire)(root)
}

export const runtimeModule = createRuntimeModuleLoader({
  resourcesPath: process.resourcesPath,
  currentFile: __filename,
})
