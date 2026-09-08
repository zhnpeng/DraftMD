import { describe, expect, it, vi } from 'vitest'
import { AppBootstrapSchema, DiagnosticsAppSchema } from '../../../src/shared/contracts'
import { isPrimaryModifier } from '../../../src/shared/platform'
import { launchFiles } from '../../../src/main/app/launch-files'
import { windowChrome } from '../../../src/main/app/window-options'
import { createDefaultBrowsePathResolver } from '../../../src/main/app/default-browse-path'

vi.mock('electron', () => ({ dialog: { showMessageBox: vi.fn() }, shell: { openExternal: vi.fn().mockResolvedValue(undefined) } }))
import { shell } from 'electron'
import { setAsDefaultApp } from '../../../src/main/app/default-app-service'

describe('Windows desktop integration', () => {
  it.each(['darwin', 'win32'])('accepts actual %s platform in validated IPC and diagnostics', platform => {
    expect(AppBootstrapSchema.parse({ locale: 'zh-CN', platform, appVersion: '0.1.0', databaseWarning: null }).platform).toBe(platform)
    expect(DiagnosticsAppSchema.parse({ version: '0.1.0', electron: '44.1.0', platform, arch: 'x64', osRelease: 'test' }).platform).toBe(platform)
  })

  it('keeps unsupported platforms outside the current contract', () => {
    expect(AppBootstrapSchema.safeParse({ locale: 'en', platform: 'linux', appVersion: '0.1.0', databaseWarning: null }).success).toBe(false)
  })

  it('uses native Windows controls and keeps the native menu visible', () => {
    expect(windowChrome('win32')).toEqual({ titleBarStyle: 'default', autoHideMenuBar: false })
    expect(windowChrome('darwin')).toEqual({ titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 14 } })
  })

  it('uses Ctrl on Windows and Command on macOS', () => {
    expect(isPrimaryModifier({ ctrlKey: true, metaKey: false }, 'win32')).toBe(true)
    expect(isPrimaryModifier({ ctrlKey: false, metaKey: true }, 'win32')).toBe(false)
    expect(isPrimaryModifier({ ctrlKey: false, metaKey: true }, 'darwin')).toBe(true)
  })

  it('parses installed and development Windows launch arguments without treating the entry as a document', () => {
    expect(launchFiles(['C:\\Program Files\\DraftMD\\DraftMD.exe', '--user-data-dir=C:\\Profile', 'C:\\Notes\\中文 文档.md', 'relative.markdown', 'ignore.txt'], true, 'C:\\Notes', 'win32'))
      .toEqual(['C:\\Notes\\中文 文档.md', 'C:\\Notes\\relative.markdown'])
    expect(launchFiles(['electron.exe', 'C:\\DraftMD\\dist\\main\\index.js', 'note.md'], false, 'C:\\Notes', 'win32')).toEqual(['C:\\Notes\\note.md'])
  })

  it('resolves the Windows Documents folder lazily', () => {
    const getPath = vi.fn(() => 'C:\\Users\\Test\\Documents')
    const resolve = createDefaultBrowsePathResolver({ platform: 'win32', getPath, existsSync: () => true })
    expect(getPath).not.toHaveBeenCalled()
    expect(resolve()).toBe('C:\\Users\\Test\\Documents')
  })

  it('opens Windows default-app settings without forcing file associations', () => {
    setAsDefaultApp(() => 'en', 'win32')
    expect(shell.openExternal).toHaveBeenCalledWith('ms-settings:defaultapps')
  })
})
