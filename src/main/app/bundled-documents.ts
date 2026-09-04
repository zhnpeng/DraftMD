import { join } from 'node:path'
import type { WindowManager } from './window-manager'

export function createBundledDocuments(deps: {
  windowManager: WindowManager
  readFile(path: string, encoding: BufferEncoding): Promise<string>
  writeFile(path: string, data: string, encoding: BufferEncoding): Promise<unknown>
  demoDir: string
  cheatsheetDir: string
  releaseNoticePath: string
  appVersion(): string
  isPackaged: boolean
}) {
  return {
    async open(fileName: string): Promise<void> {
      try {
        deps.windowManager.createWindow(undefined, await deps.readFile(join(deps.demoDir, fileName), 'utf-8'), deps.demoDir)
      } catch {
        deps.windowManager.createWindow(undefined, undefined, deps.demoDir)
      }
    },
    async openCheatsheet(language: 'zh' | 'en'): Promise<void> {
      try {
        const fileName = language === 'en' ? 'cheatsheet-en.md' : 'cheatsheet.md'
        deps.windowManager.createWindow(undefined, await deps.readFile(join(deps.cheatsheetDir, fileName), 'utf-8'), deps.cheatsheetDir)
      } catch {
        deps.windowManager.createWindow(undefined, undefined, deps.cheatsheetDir)
      }
    },
    async openChangelogOnce(): Promise<void> {
      if (!deps.isPackaged) return
      const version = deps.appVersion()
      try {
        const saved = JSON.parse(await deps.readFile(deps.releaseNoticePath, 'utf-8')) as { changelogVersion?: unknown }
        if (saved.changelogVersion === version) return
      } catch {}
      try {
        deps.windowManager.createWindow(undefined, await deps.readFile(join(deps.demoDir, 'changelog.md'), 'utf-8'), deps.demoDir)
        await deps.writeFile(deps.releaseNoticePath, JSON.stringify({ changelogVersion: version }), 'utf-8')
      } catch {}
    },
  }
}
