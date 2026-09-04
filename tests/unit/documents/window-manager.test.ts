import { beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  showSaveDialog: vi.fn(),
  showMessageBox: vi.fn(),
  fromId: vi.fn(),
  getAllWindows: vi.fn(() => []),
  constructedWindow: null as unknown,
}))

vi.mock('electron', () => {
  const BrowserWindow = Object.assign(vi.fn(function () { return electron.constructedWindow }), {
    fromId: electron.fromId,
    getAllWindows: electron.getAllWindows,
  })
  return {
  BrowserWindow,
  dialog: {
    showSaveDialog: electron.showSaveDialog,
    showMessageBox: electron.showMessageBox,
  },
}})

import { createWindowManager } from '../../../src/main/app/window-manager'

function fakeWindow() {
  return {
    id: 1,
    isDestroyed: () => false,
    setTitle: vi.fn(),
    focus: vi.fn(),
    webContents: { id: 11, isDestroyed: () => false, send: vi.fn() },
  } as never
}

function setup(input: { stat?: ReturnType<typeof vi.fn> } = {}) {
  const documentService = {
    load: vi.fn().mockResolvedValue({ content: '# Disk display', version: 'disk-version' }),
    save: vi.fn().mockImplementation(async ({ path }: { path: string }) => ({ path, version: 'saved-version' })),
  }
  const snapshotLoader = {
    loadSnapshot: vi.fn().mockResolvedValue({ content: '# Disk display', sourceContent: '# Disk raw', version: 'disk-version' }),
  }
  const watchService = {
    watch: vi.fn(), stop: vi.fn(), beginInternalWrite: vi.fn(() => vi.fn()),
    setKnownSourceContent: vi.fn(), updateBrowsePath: vi.fn(), reseedKnownSourceContent: vi.fn().mockResolvedValue(undefined),
  }
  const recentStore = {
    get: vi.fn(() => ({ recent: [], restoreOnLaunch: true })), add: vi.fn(() => false),
    clear: vi.fn(), setRestoreOnLaunch: vi.fn(),
  }
  const manager = createWindowManager({
    documentService, snapshotLoader, watchService, recentStore, locale: () => 'en', appVersion: () => '0.1.0',
    preloadPath: '/preload.js', rendererPath: '/renderer.html', readdir: vi.fn().mockResolvedValue([]),
    stat: input.stat ?? vi.fn(), rebuildMenu: vi.fn(), addRecentDocument: vi.fn(), platform: 'darwin',
  } as never)
  return { manager, documentService, snapshotLoader, watchService }
}

beforeEach(() => {
  electron.showSaveDialog.mockReset()
  electron.showMessageBox.mockReset()
})

describe('WindowManager version coordination', () => {
  it('passes the active disk version when saving the same path', async () => {
    const { manager, documentService } = setup()
    const win = fakeWindow()
    Object.assign(manager.getState(win), { filePath: '/work/a.md', browsePath: '/work', version: 'version-a' })

    expect(await manager.save(win, '# Edit', '/work/a.md')).toBe('/work/a.md')
    expect(documentService.save).toHaveBeenCalledWith({
      path: '/work/a.md', content: '# Edit', expectedVersion: 'version-a',
    })
  })

  it('does not reuse the source version for Save As to another path', async () => {
    electron.showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/work/b.md' })
    const { manager, documentService } = setup()
    const win = fakeWindow()
    Object.assign(manager.getState(win), { filePath: '/work/a.md', browsePath: '/work', version: 'version-a' })

    expect(await manager.saveAs(win, '# Edit', '/work/a.md')).toBe('/work/b.md')
    expect(documentService.save).toHaveBeenCalledWith({
      path: '/work/b.md', content: '# Edit', expectedVersion: undefined,
    })
  })

  it('returns safe failure when a same-path version check rejects', async () => {
    const { manager, documentService } = setup()
    documentService.save.mockRejectedValueOnce(new Error('version mismatch'))
    const win = fakeWindow()
    Object.assign(manager.getState(win), { filePath: '/work/a.md', browsePath: '/work', version: 'version-a' })

    expect(await manager.save(win, '# Edit', '/work/a.md')).toBeNull()
    expect(manager.getState(win).version).toBe('version-a')
  })

  it('does not adopt a clean watcher version before renderer acknowledgment', () => {
    const { manager } = setup()
    const win = fakeWindow()
    Object.assign(manager.getState(win), { filePath: '/work/a.md', version: 'old' })

    manager.stageExternalDocument(win, '/work/a.md', {
      content: '# New', sourceContent: '# New', version: 'new',
    })

    expect(manager.getState(win).version).toBe('old')
  })

  it('updates version and reseeds raw watcher content after Load Disk', async () => {
    electron.showMessageBox.mockResolvedValue({ response: 1 })
    const { manager, watchService } = setup()
    const win = fakeWindow()
    Object.assign(manager.getState(win), { filePath: '/work/a.md', browsePath: '/work', version: 'old' })

    await manager.reportExternalConflict(win)

    expect(manager.getState(win).version).toBe('disk-version')
    expect(watchService.setKnownSourceContent).toHaveBeenCalledWith(win, '# Disk raw')
    expect(watchService.reseedKnownSourceContent).not.toHaveBeenCalled()
    expect(win.webContents.send).toHaveBeenCalledWith('external-conflict-result', { action: 'load', content: '# Disk display' })
  })
})


it('routes a same-path version mismatch into conflict flow without overwriting disk', async () => {
  const { DocumentVersionMismatchError } = await import('../../../src/main/documents/document-service')
  const { manager, documentService, snapshotLoader } = setup()
  documentService.save.mockRejectedValueOnce(new DocumentVersionMismatchError('/work/a.md'))
  snapshotLoader.loadSnapshot.mockResolvedValueOnce({
    content: '# External display', sourceContent: '# External raw', version: 'external-version',
  })
  const win = fakeWindow()
  Object.assign(manager.getState(win), {
    filePath: '/work/a.md', browsePath: '/work', version: 'version-a', dirty: true,
  })

  expect(await manager.save(win, '# Mine', '/work/a.md')).toBeNull()

  expect(documentService.save).toHaveBeenCalledTimes(1)
  expect(snapshotLoader.loadSnapshot).toHaveBeenCalledWith('/work/a.md')
  expect(win.webContents.send).toHaveBeenCalledWith('file-changed', '# External display')
  expect(win.webContents.send).toHaveBeenCalledWith('document-snapshot-changed', { path: '/work/a.md', content: '# External display', version: 'external-version' })
  expect(manager.getState(win).version).toBe('version-a')
})

it('uses the pending mismatch snapshot for Keep Mine and advances the expected version', async () => {
  const { DocumentVersionMismatchError } = await import('../../../src/main/documents/document-service')
  electron.showMessageBox.mockResolvedValue({ response: 0 })
  const { manager, documentService, snapshotLoader, watchService } = setup()
  documentService.save.mockRejectedValueOnce(new DocumentVersionMismatchError('/work/a.md'))
  snapshotLoader.loadSnapshot.mockResolvedValueOnce({
    content: '# External display', sourceContent: '# External raw', version: 'external-version',
  })
  const win = fakeWindow()
  Object.assign(manager.getState(win), { filePath: '/work/a.md', browsePath: '/work', version: 'base-version' })

  expect(await manager.save(win, '# Mine', '/work/a.md')).toBeNull()
  await manager.reportExternalConflict(win)

  expect(snapshotLoader.loadSnapshot).toHaveBeenCalledTimes(1)
  expect(manager.getState(win).version).toBe('external-version')
  expect(watchService.setKnownSourceContent).toHaveBeenCalledWith(win, '# External raw')
  expect(win.webContents.send).toHaveBeenCalledWith('external-conflict-result', { action: 'keep' })
})

it('uses the exact pending mismatch snapshot for Load Disk without rereading', async () => {
  const { DocumentVersionMismatchError } = await import('../../../src/main/documents/document-service')
  electron.showMessageBox.mockResolvedValue({ response: 1 })
  const { manager, documentService, snapshotLoader, watchService } = setup()
  documentService.save.mockRejectedValueOnce(new DocumentVersionMismatchError('/work/a.md'))
  snapshotLoader.loadSnapshot.mockResolvedValueOnce({
    content: '# V1 display', sourceContent: '# V1 raw', version: 'v1-version',
  })
  const win = fakeWindow()
  Object.assign(manager.getState(win), { filePath: '/work/a.md', browsePath: '/work', version: 'base-version' })

  expect(await manager.save(win, '# Mine', '/work/a.md')).toBeNull()
  await manager.reportExternalConflict(win)

  expect(snapshotLoader.loadSnapshot).toHaveBeenCalledTimes(1)
  expect(manager.getState(win).version).toBe('v1-version')
  expect(watchService.setKnownSourceContent).toHaveBeenCalledWith(win, '# V1 raw')
  expect(win.webContents.send).toHaveBeenCalledWith('external-conflict-result', { action: 'load', content: '# V1 display' })
})

it('opens from one snapshot and seeds its exact raw watcher baseline', async () => {
  const { manager, watchService } = setup()
  const win = fakeWindow()

  await manager.loadFileInWindow(win, '/work/a.md')

  expect(win.webContents.send).toHaveBeenCalledWith('file-opened', {
    path: '/work/a.md', content: '# Disk display', version: 'disk-version',
  })
  expect(watchService.watch).toHaveBeenCalledWith(win, {
    filePath: '/work/a.md', browsePath: '/work', knownSourceContent: '# Disk raw',
  })
})


it('stages a clean external version until the matching renderer acknowledgment', () => {
  const { manager } = setup()
  const win = fakeWindow()
  Object.assign(manager.getState(win), { filePath: '/work/a.md', version: 'base-version' })
  manager.stageExternalDocument(win, '/work/a.md', {
    content: '# V2 display', sourceContent: '# V2 raw', version: 'v2-version',
  })

  expect(manager.getState(win).version).toBe('base-version')
  manager.acknowledgeExternalVersion(win, '/work/a.md', 'wrong-version')
  expect(manager.getState(win).version).toBe('base-version')
  manager.acknowledgeExternalVersion(win, '/work/a.md', 'v2-version')
  expect(manager.getState(win).version).toBe('v2-version')
})

it('ignores a stale external acknowledgment after the active path changes', () => {
  const { manager } = setup()
  const win = fakeWindow()
  Object.assign(manager.getState(win), { filePath: '/work/a.md', version: 'base-version' })
  manager.stageExternalDocument(win, '/work/a.md', {
    content: '# V2 display', sourceContent: '# V2 raw', version: 'v2-version',
  })
  Object.assign(manager.getState(win), { filePath: '/work/b.md', version: 'b-version' })

  manager.acknowledgeExternalVersion(win, '/work/a.md', 'v2-version')

  expect(manager.getState(win).version).toBe('b-version')
})

it('shows one localized safe error and pauses automatic retry when mismatch snapshot loading fails', async () => {
  const { DocumentVersionMismatchError } = await import('../../../src/main/documents/document-service')
  electron.showMessageBox.mockResolvedValue({ response: 0 })
  const { manager, documentService, snapshotLoader } = setup()
  documentService.save.mockRejectedValueOnce(new DocumentVersionMismatchError('/work/a.md'))
  snapshotLoader.loadSnapshot.mockRejectedValueOnce(new Error('deleted'))
  const win = fakeWindow()
  Object.assign(manager.getState(win), { filePath: '/work/a.md', version: 'base-version', dirty: true })

  expect(await manager.save(win, '# Mine', '/work/a.md')).toBeNull()

  expect(documentService.save).toHaveBeenCalledTimes(1)
  expect(electron.showMessageBox).toHaveBeenCalledWith(win, expect.objectContaining({ type: 'warning' }))
  expect(win.webContents.send).toHaveBeenCalledWith('autosave-retry-paused')
  expect(win.webContents.send).not.toHaveBeenCalledWith('external-conflict-result', expect.anything())
  expect(manager.getState(win).dirty).toBe(true)
  expect(manager.getState(win).version).toBe('base-version')
})

it('Keep Mine adopts only the snapshot reviewed when the prompt opened', async () => {
  let resolveChoice!: (value: { response: number }) => void
  electron.showMessageBox.mockImplementation(() => new Promise((resolve) => { resolveChoice = resolve }))
  const { manager } = setup()
  const win = fakeWindow()
  Object.assign(manager.getState(win), { filePath: '/work/a.md', version: 'base-version' })
  manager.stageExternalDocument(win, '/work/a.md', {
    content: '# V1', sourceContent: '# V1', version: 'v1-version',
  })

  const decision = manager.reportExternalConflict(win)
  manager.stageExternalDocument(win, '/work/a.md', {
    content: '# V2', sourceContent: '# V2', version: 'v2-version',
  })
  resolveChoice({ response: 0 })
  await decision

  expect(manager.getState(win).version).toBe('v1-version')
})

it('replays a newer pending snapshot after Load Disk resolves the reviewed generation', async () => {
  let resolveChoice!: (value: { response: number }) => void
  electron.showMessageBox.mockImplementation(() => new Promise((resolve) => { resolveChoice = resolve }))
  const { manager } = setup()
  const win = fakeWindow()
  Object.assign(manager.getState(win), { filePath: '/work/a.md', version: 'base-version', dirty: true })
  manager.stageExternalDocument(win, '/work/a.md', {
    content: '# V2', sourceContent: '# V2', version: 'v2-version',
  })

  const decision = manager.reportExternalConflict(win)
  manager.stageExternalDocument(win, '/work/a.md', {
    content: '# V3', sourceContent: '# V3', version: 'v3-version',
  })
  resolveChoice({ response: 1 })
  await decision

  expect(win.webContents.send.mock.calls.slice(-2)).toEqual([
    ['external-conflict-result', { action: 'load', content: '# V2' }],
    ['document-snapshot-changed', { path: '/work/a.md', content: '# V3', version: 'v3-version' }],
  ])
  expect(manager.getState(win).version).toBe('v2-version')
  manager.acknowledgeExternalVersion(win, '/work/a.md', 'v3-version')
  expect(manager.getState(win).version).toBe('v3-version')
})

it('protects a dirty untitled document with the snapshot save/discard/cancel flow before Open replaces it', async () => {
  electron.showMessageBox.mockResolvedValue({ response: 2 })
  const { manager, snapshotLoader } = setup()
  const win = fakeWindow()
  electron.fromId.mockReturnValue(win)
  Object.assign(manager.getState(win), { filePath: null, dirty: true, rendererReady: true })

  const opening = Promise.resolve(manager.openFile('/work/target.md'))
  await Promise.resolve()
  const request = win.webContents.send.mock.calls.find(([channel]) => channel === 'request-document-state')
  expect(request).toBeDefined()
  manager.respondDocumentState(
    { sender: { id: 11 } } as never,
    request![1],
    { dirty: true, content: '# Unsaved draft', revision: 4 },
  )
  await opening

  expect(snapshotLoader.loadSnapshot).not.toHaveBeenCalled()
  expect(win.webContents.send).not.toHaveBeenCalledWith('file-opened', expect.anything())
})

it('keeps a discarded untitled draft dirty when the selected target fails to load', async () => {
  electron.showMessageBox.mockResolvedValueOnce({ response: 1 }).mockResolvedValueOnce({ response: 2 })
  const { manager, snapshotLoader } = setup()
  snapshotLoader.loadSnapshot.mockRejectedValueOnce(new Error('unreadable target'))
  const win = fakeWindow()
  electron.fromId.mockReturnValue(win)
  Object.assign(manager.getState(win), { filePath: null, dirty: true, rendererReady: true })

  const firstOpen = manager.openFile('/work/unreadable.md', win)
  await Promise.resolve()
  const firstRequest = win.webContents.send.mock.calls.find(([channel]) => channel === 'request-document-state')
  expect(firstRequest).toBeDefined()
  manager.respondDocumentState(
    { sender: { id: 11 } } as never,
    firstRequest![1],
    { dirty: true, content: '# Protected draft', revision: 4 },
  )
  await firstOpen

  expect(manager.getState(win).dirty).toBe(true)
  const requestCount = win.webContents.send.mock.calls.filter(([channel]) => channel === 'request-document-state').length
  const secondOpen = manager.openFile('/work/second.md', win)
  await Promise.resolve()
  const requests = win.webContents.send.mock.calls.filter(([channel]) => channel === 'request-document-state')
  expect(requests).toHaveLength(requestCount + 1)
  manager.respondDocumentState(
    { sender: { id: 11 } } as never,
    requests.at(-1)![1],
    { dirty: true, content: '# Protected draft', revision: 4 },
  )
  await secondOpen

  expect(snapshotLoader.loadSnapshot).toHaveBeenCalledTimes(1)
  expect(win.webContents.send).not.toHaveBeenCalledWith('file-opened', expect.anything())
})

it('keeps a successfully saved untitled document clean when the replacement target fails to load', async () => {
  electron.showMessageBox.mockResolvedValue({ response: 0 })
  electron.showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/work/saved.md' })
  const { manager, snapshotLoader } = setup()
  snapshotLoader.loadSnapshot.mockRejectedValueOnce(new Error('unreadable target'))
  const win = fakeWindow()
  electron.fromId.mockReturnValue(win)
  Object.assign(manager.getState(win), { filePath: null, dirty: true, rendererReady: true })

  const opening = manager.openFile('/work/unreadable.md', win)
  await Promise.resolve()
  const request = win.webContents.send.mock.calls.find(([channel]) => channel === 'request-document-state')
  manager.respondDocumentState(
    { sender: { id: 11 } } as never,
    request![1],
    { dirty: true, content: '# Saved draft', revision: 5 },
  )
  await opening

  expect(manager.getState(win).filePath).toBe('/work/saved.md')
  expect(manager.getState(win).dirty).toBe(false)
})

it('does not restore stale dirty state over a concurrently loaded document', async () => {
  electron.showMessageBox.mockResolvedValue({ response: 1 })
  let rejectOldLoad!: (reason: Error) => void
  const { manager, snapshotLoader } = setup()
  snapshotLoader.loadSnapshot
    .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOldLoad = reject }))
    .mockResolvedValueOnce({ content: '# New document', sourceContent: '# New document', version: 'new-version' })
  const win = fakeWindow()
  electron.fromId.mockReturnValue(win)
  Object.assign(manager.getState(win), { filePath: null, dirty: true, rendererReady: true })

  const oldOpen = manager.openFile('/work/old-target.md', win)
  await Promise.resolve()
  const request = win.webContents.send.mock.calls.find(([channel]) => channel === 'request-document-state')
  manager.respondDocumentState(
    { sender: { id: 11 } } as never,
    request![1],
    { dirty: true, content: '# Old draft', revision: 6 },
  )
  await new Promise((resolve) => setTimeout(resolve, 0))
  const newerLoad = manager.loadFileInWindow(win, '/work/new.md')
  rejectOldLoad(new Error('old target failed'))
  await Promise.all([oldOpen, newerLoad])

  expect(manager.getState(win).filePath).toBe('/work/new.md')
  expect(manager.getState(win).dirty).toBe(false)
})

it.each([
  ['Save', 0, true],
  ["Don't Save", 1, true],
  ['Cancel', 2, false],
] as const)('window close handler authorizes only completed outcome: %s', async (_label, response, expectedClose) => {
  electron.showMessageBox.mockResolvedValue({ response })
  const handlers = new Map<string, (...args: never[]) => void>()
  const win = {
    id: 91,
    isDestroyed: () => false,
    setTitle: vi.fn(),
    focus: vi.fn(),
    close: vi.fn(),
    loadFile: vi.fn(),
    loadURL: vi.fn(),
    on: vi.fn((event: string, handler: (...args: never[]) => void) => { handlers.set(event, handler) }),
    webContents: {
      id: 911, isDestroyed: () => false, send: vi.fn(),
      on: vi.fn(),
    },
  }
  electron.constructedWindow = win
  const { manager } = setup()
  const created = manager.createWindow()
  Object.assign(manager.getState(created), {
    filePath: '/work/close.md', dirty: true, rendererReady: true,
  })
  const event = { preventDefault: vi.fn() }

  handlers.get('close')?.(event as never)
  await Promise.resolve()
  const request = win.webContents.send.mock.calls.find(([channel]) => channel === 'request-document-state')
  expect(request).toBeDefined()
  manager.respondDocumentState(
    { sender: { id: 911 } } as never,
    request![1],
    { dirty: true, content: '# Closing draft', revision: 9 },
  )
  await vi.waitFor(() => expect(electron.showMessageBox).toHaveBeenCalled())
  await vi.waitFor(() => expect(win.close).toHaveBeenCalledTimes(expectedClose ? 1 : 0))

  expect(event.preventDefault).toHaveBeenCalledOnce()
  expect(manager.getState(created).closeAuthorized).toBe(expectedClose)
})


it('synchronizes watcher browse state when navigating directories', async () => {
  const { manager, watchService } = setup({ stat: vi.fn().mockResolvedValue({ isDirectory: () => true }) })
  const win = fakeWindow()
  Object.assign(manager.getState(win), { filePath: '/old/a.md', browsePath: '/old' })

  expect(await manager.openSibling(win, '/new')).toBe(true)

  expect(manager.getState(win).browsePath).toBe('/new')
  expect(watchService.updateBrowsePath).toHaveBeenCalledWith(win, '/new')
})

it('clears a clean document before attaching an unrelated workspace', async () => {
  const { manager, watchService } = setup()
  const win = fakeWindow()
  Object.assign(manager.getState(win), {
    filePath: '/old/a.md', browsePath: '/old', version: 'v1', dirty: false,
  })

  await expect(manager.prepareForWorkspace(win, '/new')).resolves.toBe(true)

  expect(watchService.stop).toHaveBeenCalledWith(win)
  expect(manager.getState(win)).toMatchObject({ filePath: null, browsePath: null, version: null, dirty: false })
  expect(win.webContents.send).toHaveBeenCalledWith('file-opened', { path: null, content: '', version: null })
})

it('keeps a dirty document when workspace replacement is cancelled', async () => {
  electron.showMessageBox.mockResolvedValue({ response: 2 })
  const { manager, watchService } = setup()
  const win = fakeWindow()
  Object.assign(manager.getState(win), {
    filePath: '/old/a.md', browsePath: '/old', version: 'v1', dirty: true, rendererReady: true,
  })

  const preparing = manager.prepareForWorkspace(win, '/new')
  await Promise.resolve()
  const request = win.webContents.send.mock.calls.find(([channel]) => channel === 'request-document-state')
  manager.respondDocumentState(
    { sender: { id: 11 } } as never,
    request![1],
    { dirty: true, content: '# Unsaved', revision: 2 },
  )

  await expect(preparing).resolves.toBe(false)
  expect(watchService.stop).not.toHaveBeenCalled()
  expect(manager.getState(win).filePath).toBe('/old/a.md')
})

it('keeps a document open when it already belongs to the selected workspace', async () => {
  const { manager, watchService } = setup()
  const win = fakeWindow()
  Object.assign(manager.getState(win), { filePath: '/work/docs/a.md', browsePath: '/work/docs', version: 'v1' })

  await expect(manager.prepareForWorkspace(win, '/work')).resolves.toBe(true)

  expect(watchService.stop).not.toHaveBeenCalled()
  expect(manager.getState(win).filePath).toBe('/work/docs/a.md')
})
