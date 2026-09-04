import { expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
  handle: vi.fn((channel: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown>) => {
    electron.handlers.set(channel, handler)
  }),
}))

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: vi.fn(), getAllWindows: vi.fn(() => []) },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn(), showMessageBox: vi.fn() },
  ipcMain: { handle: electron.handle, on: vi.fn() },
  shell: { openExternal: vi.fn(), showItemInFolder: vi.fn() },
}))

import { registerIpcHandlers } from '../../../src/main/app/ipc'

it('returns updater booleans from the validated main invoke wrappers', async () => {
  const downloadUpdate = vi.fn().mockResolvedValue(false)
  const installUpdate = vi.fn(() => false)
  registerIpcHandlers({
    windowManager: {}, locale: () => 'en', writeFile: vi.fn(), rebuildMenu: vi.fn(),
    reportTheme: vi.fn(), loadSystemFonts: vi.fn().mockResolvedValue([]), downloadUpdate, installUpdate,
  } as never)

  await expect(electron.handlers.get('download-update')?.({ sender: {} })).resolves.toBe(false)
  await expect(electron.handlers.get('install-update')?.({ sender: {} })).resolves.toBe(false)
  expect(downloadUpdate).toHaveBeenCalledOnce()
  expect(installUpdate).toHaveBeenCalledOnce()
})


it('routes workspace operations through validated main handlers', async () => {
  electron.handlers.clear()
  const win = { id: 1, webContents: {} }
  const { BrowserWindow } = await import('electron')
  vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(win as never)
  const workspaceManager = {
    openFolder: vi.fn().mockResolvedValue({ id: 'a'.repeat(64), name: 'Project' }),
    list: vi.fn().mockResolvedValue([{ name: 'docs', path: 'docs', kind: 'directory' }]),
    resolveFile: vi.fn().mockResolvedValue('/work/project/docs/spec.md'),
  }
  const windowManager = { openFile: vi.fn() }
  registerIpcHandlers({
    windowManager, workspaceManager, locale: () => 'en', writeFile: vi.fn(), rebuildMenu: vi.fn(),
    reportTheme: vi.fn(), loadSystemFonts: vi.fn().mockResolvedValue([]),
    downloadUpdate: vi.fn().mockResolvedValue(false), installUpdate: vi.fn(() => false),
  } as never)

  await expect(electron.handlers.get('open-workspace')?.({ sender: win.webContents })).resolves.toEqual({
    id: 'a'.repeat(64), name: 'Project',
  })
  await expect(electron.handlers.get('list-workspace-files')?.({ sender: win.webContents }, 'docs')).resolves.toEqual([
    { name: 'docs', path: 'docs', kind: 'directory' },
  ])
  await expect(electron.handlers.get('open-workspace-file')?.({ sender: win.webContents }, 'docs/spec.md')).resolves.toBe(true)
  expect(workspaceManager.list).toHaveBeenCalledWith(1, 'docs')
  expect(windowManager.openFile).toHaveBeenCalledWith('/work/project/docs/spec.md', win)
})


it('routes provider operations without exposing materialized secrets', async () => {
  electron.handlers.clear()
  const providerConfigService = {
    listConfigs: vi.fn(() => []),
    saveConfig: vi.fn().mockResolvedValue({
      id: '01991d5a-1c00-7000-8000-000000000000', name: 'Local', kind: 'openai-compatible', preset: 'ollama',
      baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen3', timeoutMs: 60000,
      streamEnabled: true, toolsEnabled: true, insecureHttpApproved: false, capability: 'unavailable',
      lastTestedAt: null, lastTestErrorCode: null, hasCredential: true, headerNames: [], isDefault: true,
    }),
    setDefault: vi.fn(), deleteConfig: vi.fn().mockResolvedValue(true),
  }
  const testProvider = vi.fn().mockResolvedValue({
    capability: 'agent', cancelled: false, latencyMs: 10, model: 'qwen3', errorCode: null, warning: null,
  })
  registerIpcHandlers({
    windowManager: {}, workspaceManager: {}, providerConfigService, testProvider,
    locale: () => 'en', writeFile: vi.fn(), rebuildMenu: vi.fn(), reportTheme: vi.fn(),
    loadSystemFonts: vi.fn().mockResolvedValue([]), downloadUpdate: vi.fn(), installUpdate: vi.fn(),
  } as never)

  await expect(electron.handlers.get('provider-list')?.({ sender: {} })).resolves.toEqual([])
  await expect(electron.handlers.get('provider-save')?.({ sender: {} }, {
    name: 'Local', kind: 'openai-compatible', preset: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'qwen3', timeoutMs: 60000, streamEnabled: true, toolsEnabled: true, insecureHttpApproved: false,
  }, { apiKey: 'write-only-secret' })).resolves.toMatchObject({ hasCredential: true })
  await expect(electron.handlers.get('provider-test')?.({ sender: {} }, '01991d5a-1c00-7000-8000-000000000000')).resolves.toMatchObject({ capability: 'agent' })
  expect(providerConfigService.saveConfig).toHaveBeenCalledWith(expect.any(Object), { apiKey: 'write-only-secret' })
  expect(providerConfigService).not.toHaveProperty('materialize.mock')
})

it('previews diagnostics and exports only after a save destination is chosen', async () => {
  electron.handlers.clear()
  const { dialog } = await import('electron')
  const preview = {
    categories: ['Application', 'Safe settings', 'Provider metadata', 'Safe logs', 'Database integrity'],
    app: { version: '0.1.0', electron: '44.0.0', platform: 'darwin', arch: 'arm64', osRelease: '25.0.0' },
    settings: { locale: 'en', theme: 'elegant' }, providers: [], logs: [],
    database: { integrity: 'ok', recoveryWarning: null },
  }
  const diagnostics = { preview: vi.fn(() => preview), export: vi.fn().mockResolvedValue(undefined) }
  registerIpcHandlers({
    windowManager: {}, workspaceManager: {}, diagnostics, locale: () => 'en', writeFile: vi.fn(), rebuildMenu: vi.fn(),
    reportTheme: vi.fn(), loadSystemFonts: vi.fn().mockResolvedValue([]), downloadUpdate: vi.fn(), installUpdate: vi.fn(),
  } as never)

  await expect(electron.handlers.get('diagnostics-preview')?.({ sender: {} })).resolves.toEqual(preview)
  vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({ canceled: true, filePath: undefined })
  await expect(electron.handlers.get('diagnostics-export')?.({ sender: {} })).resolves.toBe(false)
  expect(diagnostics.export).not.toHaveBeenCalled()
  vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({ canceled: false, filePath: '/tmp/DraftMD-diagnostics.json' })
  await expect(electron.handlers.get('diagnostics-export')?.({ sender: {} })).resolves.toBe(true)
  expect(diagnostics.export).toHaveBeenCalledWith('/tmp/DraftMD-diagnostics.json')
})


it('assembles bounded save chunks for one sender and commits through the existing atomic save path', async () => {
  electron.handlers.clear()
  const sender = { id: 41, once: vi.fn() }
  const win = { id: 1, webContents: sender }
  const { BrowserWindow } = await import('electron')
  vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(win as never)
  const windowManager = { save: vi.fn().mockResolvedValue('/tmp/large.md'), saveAs: vi.fn() }
  registerIpcHandlers({
    windowManager, workspaceManager: {}, locale: () => 'en', writeFile: vi.fn(), rebuildMenu: vi.fn(),
    reportTheme: vi.fn(), loadSystemFonts: vi.fn().mockResolvedValue([]), downloadUpdate: vi.fn(), installUpdate: vi.fn(),
  } as never)

  const uploadId = await electron.handlers.get('save-stream-begin')?.({ sender }, {
    mode: 'save', totalLength: 6, expectedPath: '/tmp/large.md', rebuildMenu: true,
  }) as string
  await expect(electron.handlers.get('save-stream-chunk')?.({ sender }, uploadId, 0, 'abc')).resolves.toBe(true)
  await expect(electron.handlers.get('save-stream-chunk')?.({ sender }, uploadId, 1, 'def')).resolves.toBe(true)
  await expect(electron.handlers.get('save-stream-commit')?.({ sender }, uploadId)).resolves.toBe('/tmp/large.md')
  expect(windowManager.save).toHaveBeenCalledOnce()
  expect(windowManager.save).toHaveBeenCalledWith(win, 'abcdef', '/tmp/large.md', true)
  expect(windowManager.saveAs).not.toHaveBeenCalled()
})

it('rejects out-of-order save chunks without writing partial content', async () => {
  electron.handlers.clear()
  const sender = { id: 42, once: vi.fn() }
  const win = { id: 2, webContents: sender }
  const { BrowserWindow } = await import('electron')
  vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(win as never)
  const windowManager = { save: vi.fn(), saveAs: vi.fn() }
  registerIpcHandlers({
    windowManager, workspaceManager: {}, locale: () => 'en', writeFile: vi.fn(), rebuildMenu: vi.fn(),
    reportTheme: vi.fn(), loadSystemFonts: vi.fn().mockResolvedValue([]), downloadUpdate: vi.fn(), installUpdate: vi.fn(),
  } as never)
  const uploadId = await electron.handlers.get('save-stream-begin')?.({ sender }, { mode: 'save', totalLength: 3, rebuildMenu: false }) as string
  await expect(electron.handlers.get('save-stream-chunk')?.({ sender }, uploadId, 1, 'abc')).rejects.toThrow()
  await expect(electron.handlers.get('save-stream-commit')?.({ sender }, uploadId)).rejects.toThrow()
  expect(windowManager.save).not.toHaveBeenCalled()
})
