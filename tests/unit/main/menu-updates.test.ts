import { expect, it, vi } from 'vitest'

const captured = vi.hoisted(() => ({ template: [] as Array<Record<string, unknown>> }))
vi.mock('electron', () => ({
  Menu: {
    buildFromTemplate: vi.fn((template) => {
      captured.template = template
      return { getMenuItemById: () => null }
    }),
  },
}))

import { buildApplicationMenu } from '../../../src/main/app/menu'

it('offers model settings on Windows without a macOS application menu', () => {
  const send = vi.fn()
  buildApplicationMenu({
    locale: () => 'en', platform: 'win32', isPackaged: true, updatesConfigured: false,
    getFocusedWindow: () => ({ isDestroyed: () => false, webContents: { isDestroyed: () => false, send } }) as never,
    getAllWindows: () => [], recentWorkspaces: () => [],
    openWorkspace: vi.fn(), openRecentWorkspace: vi.fn(), clearRecentWorkspaces: vi.fn(),
    setAsDefaultApp: vi.fn(), openBundledDocument: vi.fn(), openCheatsheet: vi.fn(),
    checkForUpdates: vi.fn(), downloadUpdate: vi.fn(), latestVersion: () => null, currentTheme: () => 'light',
  })
  expect(captured.template[0].label).toBe('File')
  const items = captured.template.find(item => item.label === 'Edit')!.submenu as Array<{ label: string; click?: () => void }>
  items.find(item => item.label.startsWith('Model Settings'))!.click!()
  expect(send).toHaveBeenCalledWith('open-provider-settings')
})

it('shows truthful disabled copy when no update provider is configured', () => {
  buildApplicationMenu({
    locale: () => 'en', platform: 'darwin', isPackaged: true, updatesConfigured: false,
    getFocusedWindow: () => null, getAllWindows: () => [], recentWorkspaces: () => [],
    openWorkspace: vi.fn(), openRecentWorkspace: vi.fn(), clearRecentWorkspaces: vi.fn(),
    setAsDefaultApp: vi.fn(), openBundledDocument: vi.fn(), openCheatsheet: vi.fn(),
    checkForUpdates: vi.fn(), downloadUpdate: vi.fn(), latestVersion: () => '9.9.9', currentTheme: () => 'light',
  })
  const help = captured.template.find((item) => item.label === 'Help')
  const items = help?.submenu as Array<{ label?: string; enabled?: boolean }>

  expect(items).toContainEqual(expect.objectContaining({
    label: 'Updates unavailable (no release provider configured)', enabled: false,
  }))
  expect(items.some((item) => item.label?.includes('9.9.9'))).toBe(false)
})

it('uses explicit folder workspaces without restore-on-launch behavior', () => {
  const openWorkspace = vi.fn()
  const openRecentWorkspace = vi.fn()
  buildApplicationMenu({
    locale: () => 'en', platform: 'darwin', isPackaged: true, updatesConfigured: true,
    getFocusedWindow: () => null, getAllWindows: () => [], recentWorkspaces: () => ['/work/project'],
    openWorkspace, openRecentWorkspace, clearRecentWorkspaces: vi.fn(),
    setAsDefaultApp: vi.fn(), openBundledDocument: vi.fn(), openCheatsheet: vi.fn(),
    checkForUpdates: vi.fn(), downloadUpdate: vi.fn(), latestVersion: () => null, currentTheme: () => 'light',
  } as never)
  const file = captured.template.find((item) => item.label === 'File')
  const items = file?.submenu as Array<{ label?: string; click?: () => void; type?: string }>

  expect(items.some((item) => item.label === 'Reopen last document at launch')).toBe(false)
  expect(items.some((item) => item.label === 'Open Folder…')).toBe(true)
  const recent = items.find((item) => item.label === 'Open Recent Workspace') as { submenu?: Array<{ label?: string; click?: () => void }> }
  expect(recent.submenu?.[0]?.label).toContain('project')
  recent.submenu?.[0]?.click?.()
  expect(openRecentWorkspace).toHaveBeenCalledWith('/work/project')
})

it('opens provider settings from the native DraftMD menu', () => {
  const win = { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: vi.fn() } }
  buildApplicationMenu({
    locale: () => 'en', platform: 'darwin', isPackaged: true, updatesConfigured: true,
    getFocusedWindow: () => win, getAllWindows: () => [win], recentWorkspaces: () => [],
    openWorkspace: vi.fn(), openRecentWorkspace: vi.fn(), clearRecentWorkspaces: vi.fn(),
    setAsDefaultApp: vi.fn(), openBundledDocument: vi.fn(), openCheatsheet: vi.fn(),
    checkForUpdates: vi.fn(), downloadUpdate: vi.fn(), latestVersion: () => null, currentTheme: () => 'light',
  } as never)
  const appMenu = captured.template.find((item) => item.label === 'DraftMD')
  const settings = (appMenu?.submenu as Array<{ label?: string; click?: () => void }>).find((item) => item.label === 'Model Settings…')
  settings?.click?.()
  expect(win.webContents.send).toHaveBeenCalledWith('open-provider-settings')
})

it('opens diagnostics preview from the Help menu through a strict event', () => {
  const win = { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: vi.fn() } }
  buildApplicationMenu({
    locale: () => 'en', platform: 'darwin', isPackaged: true, updatesConfigured: true,
    getFocusedWindow: () => win, getAllWindows: () => [win], recentWorkspaces: () => [],
    openWorkspace: vi.fn(), openRecentWorkspace: vi.fn(), clearRecentWorkspaces: vi.fn(),
    setAsDefaultApp: vi.fn(), openBundledDocument: vi.fn(), openCheatsheet: vi.fn(),
    checkForUpdates: vi.fn(), downloadUpdate: vi.fn(), latestVersion: () => null, currentTheme: () => 'light',
  } as never)
  const help = captured.template.find((item) => item.label === 'Help')
  const diagnostics = (help?.submenu as Array<{ label?: string; click?: () => void }>).find((item) => item.label === 'Export Diagnostics…')
  diagnostics?.click?.()
  expect(win.webContents.send).toHaveBeenCalledWith('open-diagnostics')
})
