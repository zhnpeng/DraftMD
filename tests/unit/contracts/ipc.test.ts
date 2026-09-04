import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AppBootstrapSchema,
  DocumentSnapshotSchema,
  FileOpenedSchema,
  IpcEventSchemas,
  IpcInvokeSchemas,
  IpcSendSchemas,
  SiblingFileSchema,
} from '../../../src/shared/contracts'

const electron = vi.hoisted(() => {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  return {
    listeners,
    contextBridge: { exposeInMainWorld: vi.fn() },
    ipcRenderer: {
      invoke: vi.fn(),
      send: vi.fn(),
      on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
        const channelListeners = listeners.get(channel) ?? new Set()
        channelListeners.add(listener)
        listeners.set(channel, channelListeners)
      }),
      removeListener: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
        listeners.get(channel)?.delete(listener)
      }),
    },
    webUtils: { getPathForFile: vi.fn(() => '/tmp/drop.md') },
    emit(channel: string, ...payload: unknown[]): void {
      for (const listener of [...(listeners.get(channel) ?? [])]) listener({}, ...payload)
    },
  }
})

vi.mock('electron', () => ({
  contextBridge: electron.contextBridge,
  ipcRenderer: electron.ipcRenderer,
  webUtils: electron.webUtils,
}))

beforeEach(() => {
  electron.contextBridge.exposeInMainWorld.mockClear()
  electron.ipcRenderer.invoke.mockReset()
  electron.ipcRenderer.send.mockReset()
  electron.ipcRenderer.on.mockClear()
  electron.ipcRenderer.removeListener.mockClear()
  electron.listeners.clear()
  vi.resetModules()
})

describe('serializable shared IPC schemas', () => {
  it('rejects a file-open payload with executable content fields', () => {
    expect(() => FileOpenedSchema.parse({ path: '/tmp/a.md', content: '# A', version: null, script: 'x' })).toThrow()
  })

  it('preserves existing support for documents larger than 16 MiB', () => {
    const content = 'x'.repeat(16 * 1024 * 1024 + 1)
    expect(FileOpenedSchema.parse({ path: '/tmp/large.md', content, version: null }).content).toHaveLength(content.length)
    expect(DocumentSnapshotSchema.parse({ dirty: true, content, revision: 1 }).content).toHaveLength(content.length)
  })

  it('requires a finite non-negative document revision', () => {
    for (const revision of [-1, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => DocumentSnapshotSchema.parse({ dirty: false, content: '', revision })).toThrow()
    }
    expect(DocumentSnapshotSchema.parse({ dirty: false, content: '', revision: Number.MAX_SAFE_INTEGER })).toEqual({
      dirty: false,
      content: '',
      revision: Number.MAX_SAFE_INTEGER,
    })
  })

  it('accepts only the exact app bootstrap shape for macOS', () => {
    expect(AppBootstrapSchema.parse({ locale: 'en', platform: 'darwin', appVersion: '0.1.0', databaseWarning: null })).toEqual({
      locale: 'en',
      platform: 'darwin',
      appVersion: '0.1.0',
      databaseWarning: null,
    })
    expect(() => AppBootstrapSchema.parse({ locale: 'en', platform: 'linux', appVersion: '0.1.0', databaseWarning: null })).toThrow()
    expect(() => AppBootstrapSchema.parse({ locale: 'fr', platform: 'darwin', appVersion: '0.1.0', databaseWarning: null })).toThrow()
  })

  it('accepts only finite sibling kinds and exact fields', () => {
    expect(SiblingFileSchema.parse({ name: '..', path: '', kind: 'parent' })).toEqual({ name: '..', path: '', kind: 'parent' })
    expect(() => SiblingFileSchema.parse({ name: 'a.md', path: '', kind: 'file' })).toThrow()
    expect(() => SiblingFileSchema.parse({ name: 'a', path: '/tmp/a', kind: 'symlink' })).toThrow()
    expect(() => SiblingFileSchema.parse({ name: 'a', path: '/tmp/a', kind: 'file', hidden: false })).toThrow()
  })

  it('keeps current main and renderer payload producers compatible with required fields', () => {
    const windowManagerSource = readFileSync('src/main/app/window-manager.ts', 'utf8')
    const ipcSource = readFileSync('src/main/app/ipc.ts', 'utf8')
    const rendererSource = readFileSync('src/renderer/app/bootstrap.ts', 'utf8')

    expect(windowManagerSource).toContain("sendEvent(win, 'app-bootstrap', { locale: deps.locale(), platform: 'darwin', appVersion: deps.appVersion(), databaseWarning: deps.databaseWarning() })")
    expect(windowManagerSource).toContain("sendEvent(win, 'file-opened', opened)")
    expect(windowManagerSource).toContain("sendEvent(win, 'file-opened', { path: null, content: initialContent, version: null })")
    expect(ipcSource).toContain('const parsed = schema.result.safeParse(result)')
    expect(rendererSource).toContain('api.respondDocumentState(requestId, documentController.snapshot())')
  })

  it('redacts provider credentials from every renderer-facing result', () => {
    const result = IpcInvokeSchemas['provider-list'].result.parse([{
      id: '01991d5a-1c00-7000-8000-000000000000', name: 'Local', kind: 'openai-compatible', preset: 'ollama',
      baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen3', timeoutMs: 60000,
      streamEnabled: true, toolsEnabled: true, insecureHttpApproved: false, capability: 'agent',
      lastTestedAt: null, lastTestErrorCode: null, hasCredential: true, headerNames: ['authorization'], isDefault: true,
    }])
    expect(JSON.stringify(result)).not.toContain('credentialRef')
    expect(() => IpcInvokeSchemas['provider-list'].result.parse([{ ...result[0], credentialRef: 'secret-ref' }])).toThrow()
  })

  it('strictly validates task undo results and conflict versions', () => {
    expect(IpcInvokeSchemas['agent-task-undo'].result.parse({ status: 'undone', files: ['a.md'] })).toEqual({ status: 'undone', files: ['a.md'] })
    expect(IpcInvokeSchemas['agent-task-undo'].result.parse({
      status: 'conflict', files: [{ path: 'a.md', base: 'before', taskFinal: 'after', current: 'manual' }],
    })).toBeDefined()
    expect(() => IpcInvokeSchemas['agent-task-undo'].result.parse({ status: 'conflict', files: [{ path: 'a.md', current: 'manual' }] })).toThrow()
  })

  it('accepts only safe persisted session history fields', () => {
    const history = IpcInvokeSchemas['session-history'].result.parse({
      messages: [{ role: 'assistant', text: 'Done.' }],
      latestTask: { id: '01991d5a-1c00-7000-8000-000000000001', status: 'completed', activities: [] },
    })
    expect(history.messages).toEqual([{ role: 'assistant', text: 'Done.' }])
    expect(() => IpcInvokeSchemas['session-history'].result.parse({
      ...history, rawProviderData: { authorization: 'secret' },
    })).toThrow()
  })

  it('validates write-only provider secrets only on save input', () => {
    const args = IpcInvokeSchemas['provider-save'].args.parse([{
      name: 'Local', kind: 'openai-compatible', preset: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1',
      model: 'qwen3', timeoutMs: 60000, streamEnabled: true, toolsEnabled: true, insecureHttpApproved: false,
    }, { apiKey: 'entered-secret', headers: { Authorization: 'entered-header' } }])
    expect(args[1].apiKey).toBe('entered-secret')
    expect(() => IpcInvokeSchemas['provider-save'].args.parse([args[0], { apiKey: 'x', unknown: true }])).toThrow()
  })

  it('requires boolean updater invoke results', () => {
    expect(IpcInvokeSchemas['download-update'].result.parse(false)).toBe(false)
    expect(IpcInvokeSchemas['install-update'].result.parse(true)).toBe(true)
    expect(() => IpcInvokeSchemas['download-update'].result.parse(undefined)).toThrow()
    expect(() => IpcInvokeSchemas['install-update'].result.parse(undefined)).toThrow()
  })

  it('defines runtime schemas for every current invoke, send, and event channel', () => {
    expect(Object.keys(IpcInvokeSchemas).sort()).toEqual([
      'agent-keep-interrupted', 'agent-list-interrupted', 'agent-respond-approval', 'agent-start', 'agent-task-changes', 'agent-task-undo', 'agent-stop', 'agent-undo-interrupted',
      'current-document-version', 'diagnostics-export', 'diagnostics-preview', 'download-update', 'export-html', 'export-pdf', 'install-update', 'list-siblings', 'list-system-fonts',
      'list-workspace-files', 'open-file', 'open-file-path', 'open-sibling', 'open-workspace', 'open-workspace-file',
      'provider-delete', 'provider-list', 'provider-save', 'provider-set-default', 'provider-test',
      'report-external-conflict', 'report-theme', 'save-file',
      'save-file-as', 'save-stream-begin', 'save-stream-chunk', 'save-stream-commit', 'session-create', 'session-history', 'session-delete', 'session-list', 'session-rename', 'session-switch-model', 'set-app-locale', 'set-editor-font',
    ].sort())
    expect(Object.keys(IpcSendSchemas).sort()).toEqual([
      'acknowledge-external-version', 'document-state-response', 'open-external', 'renderer-ready', 'set-dirty',
    ].sort())
    expect(Object.keys(IpcEventSchemas).sort()).toEqual([
      'agent-activity', 'agent-task-event', 'app-bootstrap', 'autosave-retry-paused', 'editor-font-changed', 'editor:math', 'editor:search',
      'document-snapshot-changed', 'external-conflict-result', 'file-changed', 'file-opened', 'focus-agent-dock', 'menu-export-html', 'menu-export-pdf',
      'menu-open', 'menu-save', 'menu-save-as', 'open-diagnostics', 'open-font-settings', 'open-onboarding', 'open-provider-settings', 'request-document-state',
      'set-theme', 'siblings-changed', 'toggle-file-panel', 'toggle-source-mode', 'update-available',
      'update-downloaded', 'workspace:files-changed', 'workspace:opened',
    ].sort())
  })
})

describe('validated DraftMD preload bridge', () => {
  async function loadAPI() {
    await import('../../../src/preload/index')
    expect(electron.contextBridge.exposeInMainWorld).toHaveBeenCalledWith('draftmd', expect.any(Object))
    return electron.contextBridge.exposeInMainWorld.mock.calls[0][1]
  }

  it('validates workspace operations through the preload bridge', async () => {
    const api = await loadAPI()
    electron.ipcRenderer.invoke
      .mockResolvedValueOnce({ id: 'a'.repeat(64), name: 'Project' })
      .mockResolvedValueOnce([{ name: 'docs', path: 'docs', kind: 'directory' }])
      .mockResolvedValueOnce(true)

    await expect(api.openWorkspace()).resolves.toEqual({ id: 'a'.repeat(64), name: 'Project' })
    await expect(api.listWorkspaceFiles('')).resolves.toEqual([{ name: 'docs', path: 'docs', kind: 'directory' }])
    await expect(api.openWorkspaceFile('docs/spec.md')).resolves.toBe(true)
    expect(electron.ipcRenderer.invoke.mock.calls).toEqual([
      ['open-workspace'],
      ['list-workspace-files', ''],
      ['open-workspace-file', 'docs/spec.md'],
    ])
  })

  it('routes redacted provider configuration operations through preload', async () => {
    const api = await loadAPI()
    electron.ipcRenderer.invoke
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({
        id: '01991d5a-1c00-7000-8000-000000000000', name: 'Local', kind: 'openai-compatible', preset: 'ollama',
        baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen3', timeoutMs: 60000,
        streamEnabled: true, toolsEnabled: true, insecureHttpApproved: false, capability: 'unavailable',
        lastTestedAt: null, lastTestErrorCode: null, hasCredential: false, headerNames: [], isDefault: true,
      })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(true)

    await api.listProviderConfigs()
    await api.saveProviderConfig({
      name: 'Local', kind: 'openai-compatible', preset: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1',
      model: 'qwen3', timeoutMs: 60000, streamEnabled: true, toolsEnabled: true, insecureHttpApproved: false,
    }, {})
    await api.setDefaultProvider('01991d5a-1c00-7000-8000-000000000000')
    await api.deleteProviderConfig('01991d5a-1c00-7000-8000-000000000000', true)
    expect(electron.ipcRenderer.invoke.mock.calls.map((call) => call[0])).toEqual([
      'provider-list', 'provider-save', 'provider-set-default', 'provider-delete',
    ])
  })

  it('streams large saves through bounded chunks instead of one full-string IPC payload', async () => {
    const api = await loadAPI()
    const content = 'x'.repeat(2 * 1024 * 1024)
    electron.ipcRenderer.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'save-stream-begin') return '01991d5a-1c00-7000-8000-000000000099'
      if (channel === 'save-stream-chunk') return true
      if (channel === 'save-stream-commit') return '/tmp/large.md'
      throw new Error(`unexpected channel ${channel}`)
    })

    await expect(api.saveFile(content, '/tmp/large.md', true)).resolves.toBe('/tmp/large.md')
    const calls = electron.ipcRenderer.invoke.mock.calls
    expect(calls[0]).toEqual(['save-stream-begin', { mode: 'save', totalLength: content.length, expectedPath: '/tmp/large.md', rebuildMenu: true }])
    expect(calls.at(-1)).toEqual(['save-stream-commit', '01991d5a-1c00-7000-8000-000000000099'])
    expect(calls.some(([channel]) => channel === 'save-file')).toBe(false)
    const chunks = calls.filter(([channel]) => channel === 'save-stream-chunk')
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every(([, _id, _index, chunk]) => typeof chunk === 'string' && chunk.length <= 256 * 1024)).toBe(true)
    expect(chunks.map(([, , index]) => index)).toEqual(chunks.map((_, index) => index))
  })

  it('returns updater availability booleans through the preload bridge', async () => {
    const api = await loadAPI()
    electron.ipcRenderer.invoke.mockResolvedValueOnce(false).mockResolvedValueOnce(false)

    await expect(api.downloadUpdate()).resolves.toBe(false)
    await expect(api.installUpdate()).resolves.toBe(false)
    expect(electron.ipcRenderer.invoke.mock.calls).toEqual([
      ['download-update'],
      ['install-update'],
    ])
  })

  it('rejects invalid renderer invoke arguments before sending', async () => {
    const api = await loadAPI()
    await expect(api.openFilePath(42)).rejects.toThrow('IPC contract violation: open-file-path')
    expect(electron.ipcRenderer.invoke).not.toHaveBeenCalled()
  })

  it('parses invoke results and rejects malformed main payloads safely', async () => {
    const api = await loadAPI()
    electron.ipcRenderer.invoke.mockResolvedValue({ path: '/tmp/a.md', content: '# secret', version: null, script: 'bad' })
    await expect(api.openFile()).rejects.toThrow('IPC contract violation: open-file')
    await expect(api.openFile()).rejects.not.toThrow('secret')
  })

  it('fails closed without throwing for invalid fire-and-forget send arguments', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const api = await loadAPI()

    expect(() => api.openExternal('file:///tmp/private.md')).not.toThrow()
    expect(() => api.respondDocumentState('1', { dirty: false, content: 'private document body', revision: -1 })).not.toThrow()
    expect(electron.ipcRenderer.send).not.toHaveBeenCalled()
    expect(error.mock.calls).toEqual([
      ['[DraftMD IPC] Invalid send payload: open-external'],
      ['[DraftMD IPC] Invalid send payload: document-state-response'],
    ])
    expect(error.mock.calls.flat().join(' ')).not.toContain('private document body')
    error.mockRestore()
  })

  it('discards invalid events and logs only their channel', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const api = await loadAPI()
    const callback = vi.fn()
    api.onFileChanged(callback)
    electron.emit('file-changed', { content: 'private document body' })
    expect(callback).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith('[DraftMD IPC] Invalid event payload: file-changed')
    expect(error.mock.calls.flat().join(' ')).not.toContain('private document body')
    error.mockRestore()
  })

  it('validates external-version acknowledgments before sending', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const api = await loadAPI()

    api.acknowledgeExternalVersion('/tmp/a.md', 'a'.repeat(64))
    api.acknowledgeExternalVersion('/tmp/a.md', '')

    expect(electron.ipcRenderer.send).toHaveBeenCalledOnce()
    expect(electron.ipcRenderer.send).toHaveBeenCalledWith(
      'acknowledge-external-version', '/tmp/a.md', 'a'.repeat(64),
    )
    expect(error).toHaveBeenCalledWith('[DraftMD IPC] Invalid send payload: acknowledge-external-version')
    error.mockRestore()
  })

  it('preserves the exact legacy conflict-result union and adds pause as a separate event', async () => {
    const contractsSource = readFileSync('src/shared/contracts/ipc.ts', 'utf8')
    const conflictSchemaSource = contractsSource.slice(
      contractsSource.indexOf('const ExternalConflictResultSchema'),
      contractsSource.indexOf('const WebURLSchema'),
    )
    expect(conflictSchemaSource).toContain("z.object({ action: z.literal('keep') }).strict()")
    expect(conflictSchemaSource).toContain("z.object({ action: z.literal('load'), content: ContentSchema }).strict()")
    expect(conflictSchemaSource).not.toContain('retry-paused')
    expect(() => IpcEventSchemas['external-conflict-result'].parse([{ action: 'retry-paused' }])).toThrow()
    expect(IpcEventSchemas['external-conflict-result'].parse([{ action: 'keep' }])).toEqual([{ action: 'keep' }])
    expect(IpcEventSchemas['external-conflict-result'].parse([{ action: 'load', content: '# Disk' }])).toEqual([
      { action: 'load', content: '# Disk' },
    ])

    const api = await loadAPI()
    const pause = vi.fn()
    api.onAutosaveRetryPaused(pause)
    electron.emit('autosave-retry-paused')
    expect(pause).toHaveBeenCalledOnce()
    electron.emit('autosave-retry-paused', 'unexpected')
    expect(pause).toHaveBeenCalledOnce()

    const rendererSource = [
      readFileSync('src/renderer/app/bootstrap.ts', 'utf8'),
      readFileSync('src/renderer/app/document-controller.ts', 'utf8'),
    ].join('\n')
    expect(rendererSource).toContain('api.onAutosaveRetryPaused(() => documentController.pauseAutosaveRetry())')
    expect(rendererSource).toContain('autosave.pause()')
    expect(rendererSource).not.toContain("result.action === 'retry-paused'")
  })

  it('preserves the legacy string file-change API and adds a separate structured subscription', async () => {
    const contractsSource = readFileSync('src/shared/contracts/ipc.ts', 'utf8')
    expect(contractsSource).toMatch(/onFileChanged\(callback: \(content: string\) => void\): Unsubscribe/)

    const api = await loadAPI()
    const legacy = vi.fn<(content: string) => void>()
    const structured = vi.fn()
    api.onFileChanged(legacy)
    api.onDocumentSnapshotChanged(structured)

    electron.emit('file-changed', '# Legacy V2')
    electron.emit('document-snapshot-changed', { path: '/tmp/a.md', content: '# V2', version: 'v2' })

    expect(legacy).toHaveBeenCalledWith('# Legacy V2')
    expect(structured).toHaveBeenCalledWith({ path: '/tmp/a.md', content: '# V2', version: 'v2' })
    expect(legacy).toHaveBeenCalledOnce()
    expect(structured).toHaveBeenCalledOnce()

    const rendererSource = readFileSync('src/renderer/app/bootstrap.ts', 'utf8')
    expect(rendererSource).toContain('api.onDocumentSnapshotChanged((change) => documentController.applyExternalSnapshot(change))')
    expect(rendererSource).not.toContain('api.onFileChanged(')
  })

  it('returns unsubscribe functions that remove the exact wrapper listener', async () => {
    const api = await loadAPI()
    const callback = vi.fn()
    const unsubscribe = api.onMenuSave(callback)
    const wrapper = electron.ipcRenderer.on.mock.calls.find(([channel]) => channel === 'menu-save')?.[1]
    expect(unsubscribe).toEqual(expect.any(Function))
    unsubscribe()
    expect(electron.ipcRenderer.removeListener).toHaveBeenCalledWith('menu-save', wrapper)
    electron.emit('menu-save')
    expect(callback).not.toHaveBeenCalled()
  })

  it('keeps concurrent buffered-channel subscriptions independently unsubscribe-safe', async () => {
    const api = await loadAPI()
    const first = vi.fn()
    const second = vi.fn()
    const stopFirst = api.onFileOpened(first)
    api.onFileOpened(second)
    stopFirst()
    electron.emit('file-opened', { path: null, content: 'live', version: null })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith({ path: null, content: 'live', version: null })
  })

  it('validates early events before buffering and keeps buffered subscriptions unsubscribe-safe', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await import('../../../src/preload/index')
    electron.emit('app-bootstrap', { locale: 'en', platform: 'darwin', appVersion: '0.1.0', databaseWarning: null })
    electron.emit('file-opened', { path: null, content: 'queued', version: null })
    electron.emit('file-opened', { path: null, content: 'private', version: null, script: 'bad' })
    const api = electron.contextBridge.exposeInMainWorld.mock.calls[0][1]
    const bootstrap = vi.fn()
    const opened = vi.fn()
    const stopBootstrap = api.onAppBootstrap(bootstrap)
    const stopOpened = api.onFileOpened(opened)
    expect(bootstrap).toHaveBeenCalledOnce()
    expect(opened).toHaveBeenCalledWith({ path: null, content: 'queued', version: null })
    expect(error).toHaveBeenCalledWith('[DraftMD IPC] Invalid event payload: file-opened')
    const liveFileOpenedWrapper = electron.ipcRenderer.on.mock.calls.filter(([channel]) => channel === 'file-opened').at(-1)?.[1]
    stopBootstrap()
    stopOpened()
    expect(electron.ipcRenderer.removeListener).toHaveBeenCalledWith('file-opened', liveFileOpenedWrapper)
    electron.emit('file-opened', { path: null, content: 'after unsubscribe', version: null })
    expect(opened).toHaveBeenCalledOnce()
    error.mockRestore()
  })
})

it('accepts structured Diff hunks in Agent change-set events', () => {
  const event = {
    taskId: '01991d5a-1c00-7000-8000-000000000000', sequence: 1, type: 'change-set',
    changeSet: {
      taskId: '01991d5a-1c00-7000-8000-000000000000', workspaceId: 'a'.repeat(64),
      changes: [{
        kind: 'modified', path: 'spec.md', oldVersion: 'b'.repeat(64), newVersion: 'c'.repeat(64),
        patch: '--- a/spec.md\n+++ b/spec.md', additions: 1, deletions: 1,
        hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-old', '+new'], linedelimiters: ['\n', '\n'] }],
      }],
    },
  }
  expect(IpcEventSchemas['agent-task-event'].parse([event])).toEqual([event])
})
