import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { createWatchService } from '../../../src/main/documents/watch-service'

class FakeWatcher extends EventEmitter {
  close = vi.fn()
}

function fakeWindow() {
  return { id: 1, isDestroyed: () => false, webContents: { isDestroyed: () => false } } as never
}

describe('WatchService', () => {
  it('suppresses delayed watcher echoes of the known disk source', async () => {
    vi.useFakeTimers()
    const watcher = new FakeWatcher()
    const send = vi.fn()
    const service = createWatchService({
    loadDocument: vi.fn().mockResolvedValue({ content: '# Disk\n', sourceContent: '# Disk\n', version: 'disk-version' }),
    onExternalDocument: vi.fn(),
      watch: (_path, listener) => { watcher.on('change', listener); return watcher as never },
      readFile: vi.fn().mockResolvedValue('# Disk\n'), existsSync: () => true,
      listSiblings: vi.fn().mockResolvedValue([]), send,
    })
    const win = fakeWindow()

    service.watch(win, { filePath: '/work/a.md', browsePath: '/work', knownSourceContent: '# Disk\n' })
    await vi.advanceTimersByTimeAsync(301)
    watcher.emit('change', 'change', 'a.md')
    await vi.advanceTimersByTimeAsync(101)

    expect(send).not.toHaveBeenCalledWith(win, 'file-changed', expect.anything())
    vi.useRealTimers()
  })

  it('emits resolved display content for an external change', async () => {
    vi.useFakeTimers()
    const watcher = new FakeWatcher()
    const send = vi.fn()
    const service = createWatchService({
    loadDocument: vi.fn().mockResolvedValue({ content: '![x](file:///work/img/a.png)', sourceContent: '![x](./img/a.png)', version: 'changed-version' }),
    onExternalDocument: vi.fn(),
      watch: (_path, listener) => { watcher.on('change', listener); return watcher as never },
      readFile: vi.fn().mockResolvedValue('![x](./img/a.png)'), existsSync: () => true,
      listSiblings: vi.fn().mockResolvedValue([]), send,
    })
    const win = fakeWindow()

    service.watch(win, { filePath: '/work/a.md', browsePath: '/work', knownSourceContent: '# Old' })
    await vi.advanceTimersByTimeAsync(301)
    watcher.emit('change', 'change', 'a.md')
    await vi.advanceTimersByTimeAsync(101)

    expect(send).toHaveBeenCalledWith(win, 'file-changed', expect.stringContaining('file://'))
    expect(send).toHaveBeenCalledWith(win, 'document-snapshot-changed', { path: '/work/a.md', content: expect.stringContaining('file://'), version: expect.any(String) })
    vi.useRealTimers()
  })
})

it('keeps a newer internal write suppressed when an earlier release fires after rewatch', async () => {
  vi.useFakeTimers()
  const watchers: Array<{ watcher: FakeWatcher; listener: (...args: unknown[]) => void }> = []
  const readFile = vi.fn().mockResolvedValue('# External')
  const send = vi.fn()
  const service = createWatchService({
    loadDocument: vi.fn().mockResolvedValue({ content: '# Changed', sourceContent: '# Changed', version: 'changed-version' }),
    onExternalDocument: vi.fn(),
    watch: (_path, listener) => {
      const watcher = new FakeWatcher()
      watchers.push({ watcher, listener: listener as (...args: unknown[]) => void })
      return watcher as never
    },
    readFile, existsSync: () => true, listSiblings: vi.fn().mockResolvedValue([]), send,
  })
  const win = fakeWindow()

  service.watch(win, { filePath: '/work/a.md', browsePath: '/work', knownSourceContent: '# A' })
  const finishA = service.beginInternalWrite(win)
  service.watch(win, { filePath: '/work/b.md', browsePath: '/work', knownSourceContent: '# B' })
  const finishB = service.beginInternalWrite(win)
  finishA()
  await vi.advanceTimersByTimeAsync(301)
  watchers.at(-1)!.listener('change', 'b.md')
  await vi.advanceTimersByTimeAsync(101)

  expect(readFile).not.toHaveBeenCalled()
  expect(send).not.toHaveBeenCalledWith(win, 'file-changed', expect.anything())
  finishB()
  vi.useRealTimers()
})

it.each(['active', 'cooldown'] as const)('reports idle when retargeting a watcher in %s state', async (phase) => {
  vi.useFakeTimers()
  const watchers: Array<{ watcher: FakeWatcher; listener: (...args: unknown[]) => void }> = []
  const send = vi.fn()
  let clock = 1_000
  const service = createWatchService({
    loadDocument: vi.fn().mockResolvedValue({ content: '# Changed', sourceContent: '# Changed', version: 'changed-version' }),
    onExternalDocument: vi.fn(),
    watch: (_path, listener) => {
      const watcher = new FakeWatcher()
      watchers.push({ watcher, listener: listener as (...args: unknown[]) => void })
      return watcher as never
    },
    readFile: vi.fn().mockResolvedValue('# External'), existsSync: () => true,
    listSiblings: vi.fn().mockResolvedValue([]), send, now: () => clock,
  })
  const win = fakeWindow()

  service.watch(win, { filePath: '/work/a.md', browsePath: '/work', knownSourceContent: '# A' })
  await vi.advanceTimersByTimeAsync(301)
  watchers.at(-1)!.listener('change', 'a.md')
  clock += 500
  watchers.at(-1)!.listener('change', 'a.md')
  expect(send).toHaveBeenCalledWith(win, 'agent-activity', 'active')
  if (phase === 'cooldown') {
    await vi.advanceTimersByTimeAsync(3000)
    expect(send).toHaveBeenCalledWith(win, 'agent-activity', 'cooldown')
  }
  send.mockClear()

  service.watch(win, { filePath: '/work/a.md', browsePath: '/work', knownSourceContent: '# Saved' })

  expect(send).toHaveBeenCalledWith(win, 'agent-activity', 'idle')
  vi.useRealTimers()
})

it('records the disk-byte version before emitting a clean external reload', async () => {
  vi.useFakeTimers()
  const watcher = new FakeWatcher()
  const onExternalVersion = vi.fn()
  const send = vi.fn()
  const service = createWatchService({
    watch: (_path, listener) => { watcher.on('change', listener); return watcher as never },
    readFile: vi.fn().mockResolvedValue('# External'), loadDocument: vi.fn().mockResolvedValue({ content: '# External', sourceContent: '# External', version: 'sha256-version' }),
    onExternalDocument: (win, path, document) => onExternalVersion(win, path, document.version), existsSync: () => true, listSiblings: vi.fn().mockResolvedValue([]), send,
  })
  const win = fakeWindow()

  service.watch(win, { filePath: '/work/a.md', browsePath: '/work', knownSourceContent: '# Old' })
  await vi.advanceTimersByTimeAsync(301)
  watcher.emit('change', 'change', 'a.md')
  await vi.advanceTimersByTimeAsync(101)

  expect(onExternalVersion).toHaveBeenCalledWith(win, '/work/a.md', 'sha256-version')
  expect(onExternalVersion.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[0])
  vi.useRealTimers()
})

it('seeds the exact raw Load Disk snapshot so a coalesced duplicate event is suppressed', async () => {
  vi.useFakeTimers()
  const watcher = new FakeWatcher()
  const readFile = vi.fn().mockResolvedValue('# Loaded from disk\n')
  const send = vi.fn()
  const service = createWatchService({
    watch: (_path, listener) => { watcher.on('change', listener); return watcher as never },
    readFile, loadDocument: vi.fn().mockResolvedValue({ content: '# Loaded from disk\n', sourceContent: '# Loaded from disk\n', version: 'version' }), onExternalDocument: vi.fn(),
    existsSync: () => true, listSiblings: vi.fn().mockResolvedValue([]), send,
  })
  const win = fakeWindow()

  service.watch(win, { filePath: '/work/a.md', browsePath: '/work', knownSourceContent: '# Old' })
  service.setKnownSourceContent(win, '# Loaded from disk\n')
  readFile.mockClear()
  await vi.advanceTimersByTimeAsync(301)
  watcher.emit('change', 'change', 'a.md')
  await vi.advanceTimersByTimeAsync(101)

  expect(readFile).not.toHaveBeenCalled()
  expect(send).not.toHaveBeenCalledWith(win, 'file-changed', expect.anything())
  vi.useRealTimers()
})


it('emits content and version from one external disk snapshot', async () => {
  vi.useFakeTimers()
  const watcher = new FakeWatcher()
  const onExternalVersion = vi.fn()
  const send = vi.fn()
  const service = createWatchService({
    watch: (_path, listener) => { watcher.on('change', listener); return watcher as never },
    readFile: vi.fn().mockResolvedValue('# Different read'),
    loadDocument: vi.fn().mockResolvedValue({ content: '# One snapshot', version: 'one-version' }),
    onExternalDocument: (win, path, document) => onExternalVersion(win, path, document.version), existsSync: () => true, listSiblings: vi.fn().mockResolvedValue([]), send,
  })
  const win = fakeWindow()

  service.watch(win, { filePath: '/work/a.md', browsePath: '/work', knownSourceContent: '# Old' })
  await vi.advanceTimersByTimeAsync(301)
  watcher.emit('change', 'change', 'a.md')
  await vi.advanceTimersByTimeAsync(101)

  expect(onExternalVersion).toHaveBeenCalledWith(win, '/work/a.md', 'one-version')
  expect(send).toHaveBeenCalledWith(win, 'file-changed', '# One snapshot')
  expect(send).toHaveBeenCalledWith(win, 'document-snapshot-changed', { path: '/work/a.md', content: '# One snapshot', version: 'one-version' })
  vi.useRealTimers()
})

it('does not carry delayed write suppression to a different document', async () => {
  vi.useFakeTimers()
  const watchers: Array<{ listener: (...args: unknown[]) => void }> = []
  const send = vi.fn()
  const service = createWatchService({
    loadDocument: vi.fn().mockResolvedValue({ content: '# B changed', sourceContent: '# B changed', version: 'b-version' }),
    onExternalDocument: vi.fn(),
    watch: (_path, listener) => {
      watchers.push({ listener: listener as (...args: unknown[]) => void })
      return new FakeWatcher() as never
    },
    readFile: vi.fn().mockResolvedValue('# B changed'), existsSync: () => true,
    listSiblings: vi.fn().mockResolvedValue([]), send,
  })
  const win = fakeWindow()

  service.watch(win, { filePath: '/work/a.md', browsePath: '/work', knownSourceContent: '# A' })
  const finishA = service.beginInternalWrite(win)
  service.watch(win, { filePath: '/work/b.md', browsePath: '/work', knownSourceContent: '# B' })
  await vi.advanceTimersByTimeAsync(301)
  finishA()
  watchers.at(-1)!.listener('change', 'b.md')
  await vi.advanceTimersByTimeAsync(101)

  expect(send).toHaveBeenCalledWith(win, 'file-changed', '# B changed')
  expect(send).toHaveBeenCalledWith(win, 'document-snapshot-changed', { path: '/work/b.md', content: '# B changed', version: expect.any(String) })
  vi.useRealTimers()
})

it('delivers V2 after initial open seeds the exact V1 baseline', async () => {
  vi.useFakeTimers()
  const watcher = new FakeWatcher()
  const send = vi.fn()
  const service = createWatchService({
    watch: (_path, listener) => { watcher.on('change', listener); return watcher as never },
    readFile: vi.fn(), existsSync: () => true, listSiblings: vi.fn().mockResolvedValue([]),
    loadDocument: vi.fn().mockResolvedValue({ content: '# V2 display', sourceContent: '# V2 raw', version: 'v2-version' }),
    onExternalDocument: vi.fn(), send,
  })
  const win = fakeWindow()

  service.watch(win, { filePath: '/work/a.md', browsePath: '/work', knownSourceContent: '# V1 raw' })
  await vi.advanceTimersByTimeAsync(301)
  watcher.emit('change', 'change', 'a.md')
  await vi.advanceTimersByTimeAsync(101)

  expect(send).toHaveBeenCalledWith(win, 'file-changed', '# V2 display')
  expect(send).toHaveBeenCalledWith(win, 'document-snapshot-changed', {
    path: '/work/a.md', content: '# V2 display', version: 'v2-version',
  })
  vi.useRealTimers()
})

it('publishes only the newest generation when async reloads resolve out of order', async () => {
  vi.useFakeTimers()
  const watcher = new FakeWatcher()
  let resolveV2!: (snapshot: { content: string; sourceContent: string; version: string }) => void
  let resolveV3!: (snapshot: { content: string; sourceContent: string; version: string }) => void
  const loadDocument = vi.fn()
    .mockImplementationOnce(() => new Promise((resolve) => { resolveV2 = resolve }))
    .mockImplementationOnce(() => new Promise((resolve) => { resolveV3 = resolve }))
  const onExternalDocument = vi.fn()
  const send = vi.fn()
  const service = createWatchService({
    watch: (_path, listener) => { watcher.on('change', listener); return watcher as never },
    readFile: vi.fn(), existsSync: () => true, listSiblings: vi.fn().mockResolvedValue([]),
    loadDocument, onExternalDocument, send,
  })
  const win = fakeWindow()

  service.watch(win, { filePath: '/work/a.md', browsePath: '/work', knownSourceContent: '# V1' })
  await vi.advanceTimersByTimeAsync(301)
  watcher.emit('change', 'change', 'a.md')
  await vi.advanceTimersByTimeAsync(101)
  watcher.emit('change', 'change', 'a.md')
  await vi.advanceTimersByTimeAsync(101)
  expect(loadDocument).toHaveBeenCalledTimes(2)

  resolveV3({ content: '# V3', sourceContent: '# V3', version: 'v3-version' })
  await Promise.resolve()
  resolveV2({ content: '# V2', sourceContent: '# V2', version: 'v2-version' })
  await Promise.resolve()
  await Promise.resolve()

  expect(onExternalDocument).toHaveBeenCalledOnce()
  expect(onExternalDocument).toHaveBeenCalledWith(win, '/work/a.md', {
    content: '# V3', sourceContent: '# V3', version: 'v3-version',
  })
  expect(send).toHaveBeenCalledWith(win, 'document-snapshot-changed', {
    path: '/work/a.md', content: '# V3', version: 'v3-version',
  })
  expect(send).not.toHaveBeenCalledWith(win, 'document-snapshot-changed', expect.objectContaining({ version: 'v2-version' }))
  vi.useRealTimers()
})

it.each([
  ['different external content', '# External', true],
  ['pure internal echo', '# Saved', false],
] as const)('reconciles a suppressed watcher event: %s', async (_label, diskSource, shouldEmit) => {
  vi.useFakeTimers()
  const watcher = new FakeWatcher()
  const send = vi.fn()
  const loadDocument = vi.fn().mockResolvedValue({ content: diskSource, sourceContent: diskSource, version: 'disk-version' })
  const service = createWatchService({
    watch: (_path, listener) => { watcher.on('change', listener); return watcher as never },
    readFile: vi.fn(), existsSync: () => true, listSiblings: vi.fn().mockResolvedValue([]),
    loadDocument, onExternalDocument: vi.fn(), send,
  })
  const win = fakeWindow()
  service.watch(win, { filePath: '/work/a.md', browsePath: '/work', knownSourceContent: '# Before' })
  await vi.advanceTimersByTimeAsync(301)
  const finish = service.beginInternalWrite(win)
  service.setKnownSourceContent(win, '# Saved')
  watcher.emit('change', 'change', 'a.md')
  finish()
  await vi.advanceTimersByTimeAsync(201)

  expect(loadDocument).toHaveBeenCalledOnce()
  if (!shouldEmit) {
    expect(send).not.toHaveBeenCalledWith(win, 'file-changed', expect.anything())
    expect(send).not.toHaveBeenCalledWith(win, 'document-snapshot-changed', expect.anything())
  } else {
    expect(send).toHaveBeenCalledWith(win, 'file-changed', diskSource)
    expect(send).toHaveBeenCalledWith(win, 'document-snapshot-changed', { path: '/work/a.md', content: diskSource, version: 'disk-version' })
  }
  vi.useRealTimers()
})

it('reconciles a genuine external edit received during watcher establishment', async () => {
  vi.useFakeTimers()
  const watcher = new FakeWatcher()
  const send = vi.fn()
  const loadDocument = vi.fn().mockResolvedValue({ content: '# External', sourceContent: '# External', version: 'external-version' })
  const service = createWatchService({
    watch: (_path, listener) => { watcher.on('change', listener); return watcher as never },
    readFile: vi.fn(), existsSync: () => true, listSiblings: vi.fn().mockResolvedValue([]),
    loadDocument, onExternalDocument: vi.fn(), send,
  })
  const win = fakeWindow()
  service.watch(win, { filePath: '/work/a.md', browsePath: '/work', knownSourceContent: '# Opened' })

  await vi.advanceTimersByTimeAsync(50)
  watcher.emit('change', 'change', 'a.md')
  await vi.advanceTimersByTimeAsync(351)

  expect(loadDocument).toHaveBeenCalledOnce()
  expect(send).toHaveBeenCalledWith(win, 'document-snapshot-changed', {
    path: '/work/a.md', content: '# External', version: 'external-version',
  })
  vi.useRealTimers()
})

it('reconciles but ignores an initial watcher echo of the opened source', async () => {
  vi.useFakeTimers()
  const watcher = new FakeWatcher()
  const send = vi.fn()
  const loadDocument = vi.fn().mockResolvedValue({ content: '# Opened', sourceContent: '# Opened', version: 'opened-version' })
  const service = createWatchService({
    watch: (_path, listener) => { watcher.on('change', listener); return watcher as never },
    readFile: vi.fn(), existsSync: () => true, listSiblings: vi.fn().mockResolvedValue([]),
    loadDocument, onExternalDocument: vi.fn(), send,
  })
  const win = fakeWindow()
  service.watch(win, { filePath: '/work/a.md', browsePath: '/work', knownSourceContent: '# Opened' })

  watcher.emit('change', 'change', 'a.md')
  await vi.advanceTimersByTimeAsync(401)

  expect(loadDocument).toHaveBeenCalledOnce()
  expect(send).not.toHaveBeenCalledWith(win, 'document-snapshot-changed', expect.anything())
  vi.useRealTimers()
})

it('cancels an establishment reconciliation when the watcher retargets', async () => {
  vi.useFakeTimers()
  const watchers: Array<{ listener: (...args: unknown[]) => void }> = []
  const loadDocument = vi.fn().mockResolvedValue({ content: '# Stale', sourceContent: '# Stale', version: 'stale-version' })
  const service = createWatchService({
    watch: (_path, listener) => { watchers.push({ listener: listener as (...args: unknown[]) => void }); return new FakeWatcher() as never },
    readFile: vi.fn(), existsSync: () => true, listSiblings: vi.fn().mockResolvedValue([]),
    loadDocument, onExternalDocument: vi.fn(), send: vi.fn(),
  })
  const win = fakeWindow()
  service.watch(win, { filePath: '/work/a.md', browsePath: '/work', knownSourceContent: '# A' })
  watchers[0].listener('change', 'a.md')
  service.watch(win, { filePath: '/work/b.md', browsePath: '/work', knownSourceContent: '# B' })

  await vi.advanceTimersByTimeAsync(500)

  expect(loadDocument).not.toHaveBeenCalled()
  vi.useRealTimers()
})

it('coalesces establishment events with overlapping internal writes until the final release', async () => {
  vi.useFakeTimers()
  const watcher = new FakeWatcher()
  const loadDocument = vi.fn().mockResolvedValue({ content: '# External', sourceContent: '# External', version: 'external-version' })
  const service = createWatchService({
    watch: (_path, listener) => { watcher.on('change', listener); return watcher as never },
    readFile: vi.fn(), existsSync: () => true, listSiblings: vi.fn().mockResolvedValue([]),
    loadDocument, onExternalDocument: vi.fn(), send: vi.fn(),
  })
  const win = fakeWindow()
  service.watch(win, { filePath: '/work/a.md', browsePath: '/work', knownSourceContent: '# Saved' })
  const finishFirst = service.beginInternalWrite(win)
  const finishSecond = service.beginInternalWrite(win)
  watcher.emit('change', 'change', 'a.md')
  watcher.emit('change', 'change', 'a.md')
  finishFirst()
  await vi.advanceTimersByTimeAsync(400)
  expect(loadDocument).not.toHaveBeenCalled()

  finishSecond()
  await vi.advanceTimersByTimeAsync(201)

  expect(loadDocument).toHaveBeenCalledOnce()
  vi.useRealTimers()
})

it('refreshes only the current browse directory after navigation', async () => {
  vi.useFakeTimers()
  const watchers = new Map<string, (...args: unknown[]) => void>()
  const listSiblings = vi.fn().mockResolvedValue([])
  const service = createWatchService({
    watch: (path, listener) => { watchers.set(path, listener as (...args: unknown[]) => void); return new FakeWatcher() as never },
    readFile: vi.fn(), existsSync: () => true, listSiblings,
    loadDocument: vi.fn().mockResolvedValue({ content: '# A', sourceContent: '# A', version: 'a-version' }),
    onExternalDocument: vi.fn(), send: vi.fn(),
  })
  const win = fakeWindow()
  service.watch(win, { filePath: '/old/a.md', browsePath: '/old', knownSourceContent: '# A' })
  service.updateBrowsePath(win, '/new')

  watchers.get('/old')?.('change', 'old-sibling.md')
  await vi.advanceTimersByTimeAsync(301)
  expect(listSiblings).not.toHaveBeenCalled()

  watchers.get('/new')?.('change', 'new-sibling.md')
  await vi.advanceTimersByTimeAsync(301)
  expect(listSiblings).toHaveBeenCalledOnce()
  expect(listSiblings).toHaveBeenCalledWith('/old/a.md', '/new')
  vi.useRealTimers()
})

it('reconciles an event that triggers watcher re-establishment', async () => {
  vi.useFakeTimers()
  const watchers: Array<{ listener: (...args: unknown[]) => void }> = []
  const loadDocument = vi.fn().mockResolvedValue({ content: '# Replaced', sourceContent: '# Replaced', version: 'replaced-version' })
  const service = createWatchService({
    watch: (_path, listener) => { watchers.push({ listener: listener as (...args: unknown[]) => void }); return new FakeWatcher() as never },
    readFile: vi.fn(), existsSync: () => true, listSiblings: vi.fn().mockResolvedValue([]),
    loadDocument, onExternalDocument: vi.fn(), send: vi.fn(),
  })
  const win = fakeWindow()
  service.watch(win, { filePath: '/work/a.md', browsePath: '/work', knownSourceContent: '# Opened' })

  watchers[0].listener('rename', 'a.md')
  expect(watchers).toHaveLength(2)
  await vi.advanceTimersByTimeAsync(401)

  expect(loadDocument).toHaveBeenCalledOnce()
  vi.useRealTimers()
})

it('ignores an error from a stale watcher generation after re-establishment', () => {
  const watchers: FakeWatcher[] = []
  const service = createWatchService({
    watch: () => { const watcher = new FakeWatcher(); watchers.push(watcher); return watcher as never },
    readFile: vi.fn(), existsSync: () => true, listSiblings: vi.fn().mockResolvedValue([]),
    loadDocument: vi.fn(), onExternalDocument: vi.fn(), send: vi.fn(),
  })
  const win = fakeWindow()
  service.watch(win, { filePath: '/work/a.md', browsePath: '/work', knownSourceContent: '# A' })
  watchers[0].emit('error', new Error('replace watcher'))
  expect(watchers).toHaveLength(2)

  watchers[0].emit('error', new Error('stale error'))

  expect(watchers).toHaveLength(2)
})

it('ignores a stale fallback watcher error after fallback re-establishment', () => {
  const fallbackWatchers: FakeWatcher[] = []
  let directoryAttempts = 0
  const service = createWatchService({
    watch: (path) => {
      if (path === '/work') { directoryAttempts += 1; throw new Error('directory watch unavailable') }
      const watcher = new FakeWatcher()
      fallbackWatchers.push(watcher)
      return watcher as never
    },
    readFile: vi.fn(), existsSync: () => true, listSiblings: vi.fn().mockResolvedValue([]),
    loadDocument: vi.fn(), onExternalDocument: vi.fn(), send: vi.fn(),
  })
  const win = fakeWindow()
  service.watch(win, { filePath: '/work/a.md', browsePath: '/work', knownSourceContent: '# A' })
  expect({ directoryAttempts, fallbackCount: fallbackWatchers.length }).toEqual({ directoryAttempts: 1, fallbackCount: 1 })

  fallbackWatchers[0].emit('error', new Error('replace fallback'))
  expect({ directoryAttempts, fallbackCount: fallbackWatchers.length }).toEqual({ directoryAttempts: 2, fallbackCount: 2 })

  fallbackWatchers[0].emit('error', new Error('stale fallback'))
  expect({ directoryAttempts, fallbackCount: fallbackWatchers.length }).toEqual({ directoryAttempts: 2, fallbackCount: 2 })
})

it('handles errors from the initially established browse watcher without resurrecting it', () => {
  const watchers = new Map<string, FakeWatcher[]>()
  const service = createWatchService({
    watch: (path) => {
      const watcher = new FakeWatcher()
      watchers.set(path, [...(watchers.get(path) ?? []), watcher])
      return watcher as never
    },
    readFile: vi.fn(), existsSync: () => true, listSiblings: vi.fn().mockResolvedValue([]),
    loadDocument: vi.fn(), onExternalDocument: vi.fn(), send: vi.fn(),
  })
  const win = fakeWindow()
  service.watch(win, { filePath: '/document/a.md', browsePath: '/browse', knownSourceContent: '# A' })
  const browseWatcher = watchers.get('/browse')![0]

  expect(() => browseWatcher.emit('error', new Error('browse directory removed'))).not.toThrow()
  expect(browseWatcher.close).toHaveBeenCalledOnce()
  expect(watchers.get('/browse')).toHaveLength(1)
})

it('handles current browse-path errors and ignores errors from a stale old browse watcher', () => {
  const watchers = new Map<string, FakeWatcher[]>()
  const service = createWatchService({
    watch: (path) => {
      const watcher = new FakeWatcher()
      watchers.set(path, [...(watchers.get(path) ?? []), watcher])
      return watcher as never
    },
    readFile: vi.fn(), existsSync: () => true, listSiblings: vi.fn().mockResolvedValue([]),
    loadDocument: vi.fn(), onExternalDocument: vi.fn(), send: vi.fn(),
  })
  const win = fakeWindow()
  service.watch(win, { filePath: '/document/a.md', browsePath: '/document', knownSourceContent: '# A' })
  service.updateBrowsePath(win, '/old-browse')
  const oldWatcher = watchers.get('/old-browse')![0]
  service.updateBrowsePath(win, '/new-browse')
  const newWatcher = watchers.get('/new-browse')![0]
  oldWatcher.close.mockClear()

  expect(() => oldWatcher.emit('error', new Error('stale old directory'))).not.toThrow()
  expect(oldWatcher.close).not.toHaveBeenCalled()
  expect(newWatcher.close).not.toHaveBeenCalled()
  expect(() => newWatcher.emit('error', new Error('current directory removed'))).not.toThrow()
  expect(newWatcher.close).toHaveBeenCalledOnce()
  expect(watchers.get('/new-browse')).toHaveLength(1)
})

it('ignores a stale document-directory listing that resolves after browse navigation', async () => {
  vi.useFakeTimers()
  const listeners = new Map<string, (...args: unknown[]) => void>()
  const pending = new Map<string, (files: Array<{ name: string; path: string; kind: 'file' }>) => void>()
  const listSiblings = vi.fn((_filePath: string, browsePath: string) => new Promise<Array<{ name: string; path: string; kind: 'file' }>>((resolve) => pending.set(browsePath, resolve)))
  const send = vi.fn()
  const service = createWatchService({
    watch: (path, listener) => { listeners.set(path, listener as (...args: unknown[]) => void); return new FakeWatcher() as never },
    readFile: vi.fn(), existsSync: () => true, listSiblings,
    loadDocument: vi.fn().mockResolvedValue({ content: '# A', sourceContent: '# A', version: 'a-version' }),
    onExternalDocument: vi.fn(), send,
  })
  const win = fakeWindow()
  service.watch(win, { filePath: '/old/a.md', browsePath: '/old', knownSourceContent: '# A' })
  listeners.get('/old')?.('change', 'old.md')
  await vi.advanceTimersByTimeAsync(301)
  service.updateBrowsePath(win, '/new')
  listeners.get('/new')?.('change', 'new.md')
  await vi.advanceTimersByTimeAsync(301)

  pending.get('/new')?.([{ name: 'new.md', path: '/new/new.md', kind: 'file' }])
  await Promise.resolve()
  pending.get('/old')?.([{ name: 'old.md', path: '/old/old.md', kind: 'file' }])
  await Promise.resolve()

  expect(send).toHaveBeenCalledOnce()
  expect(send).toHaveBeenCalledWith(win, 'siblings-changed', [{ name: 'new.md', path: '/new/new.md', kind: 'file' }])
  vi.useRealTimers()
})

it('ignores an in-flight old browse-watcher listing after a second navigation', async () => {
  vi.useFakeTimers()
  const listeners = new Map<string, (...args: unknown[]) => void>()
  const pending = new Map<string, (files: Array<{ name: string; path: string; kind: 'file' }>) => void>()
  const listSiblings = vi.fn((_filePath: string, browsePath: string) => new Promise<Array<{ name: string; path: string; kind: 'file' }>>((resolve) => pending.set(browsePath, resolve)))
  const send = vi.fn()
  const service = createWatchService({
    watch: (path, listener) => { listeners.set(path, listener as (...args: unknown[]) => void); return new FakeWatcher() as never },
    readFile: vi.fn(), existsSync: () => true, listSiblings,
    loadDocument: vi.fn(), onExternalDocument: vi.fn(), send,
  })
  const win = fakeWindow()
  service.watch(win, { filePath: '/document/a.md', browsePath: '/document', knownSourceContent: '# A' })
  service.updateBrowsePath(win, '/first')
  listeners.get('/first')?.('change', 'first.md')
  await vi.advanceTimersByTimeAsync(301)
  service.updateBrowsePath(win, '/second')
  listeners.get('/second')?.('change', 'second.md')
  await vi.advanceTimersByTimeAsync(301)

  pending.get('/second')?.([{ name: 'second.md', path: '/second/second.md', kind: 'file' }])
  await Promise.resolve()
  pending.get('/first')?.([{ name: 'first.md', path: '/first/first.md', kind: 'file' }])
  await Promise.resolve()

  expect(send).toHaveBeenCalledOnce()
  expect(send).toHaveBeenCalledWith(win, 'siblings-changed', [{ name: 'second.md', path: '/second/second.md', kind: 'file' }])
  vi.useRealTimers()
})

it('invalidates the initial browse watcher before close and ignores queued or in-flight work after error', async () => {
  vi.useFakeTimers()
  const watchers = new Map<string, { watcher: FakeWatcher; listener: (...args: unknown[]) => void }>()
  let resolveListing!: (files: Array<{ name: string; path: string; kind: 'file' }>) => void
  const listSiblings = vi.fn(() => new Promise<Array<{ name: string; path: string; kind: 'file' }>>((resolve) => { resolveListing = resolve }))
  const send = vi.fn()
  const service = createWatchService({
    watch: (path, listener) => {
      const watcher = new FakeWatcher()
      watchers.set(path, { watcher, listener: listener as (...args: unknown[]) => void })
      return watcher as never
    },
    readFile: vi.fn(), existsSync: () => true, listSiblings,
    loadDocument: vi.fn(), onExternalDocument: vi.fn(), send,
  })
  const win = fakeWindow()
  service.watch(win, { filePath: '/document/a.md', browsePath: '/browse', knownSourceContent: '# A' })
  const browse = watchers.get('/browse')!
  browse.listener('change', 'before-error.md')
  await vi.advanceTimersByTimeAsync(301)
  expect(listSiblings).toHaveBeenCalledOnce()
  let closeCalls = 0
  browse.watcher.close.mockImplementation(() => {
    closeCalls += 1
    if (closeCalls === 1) browse.watcher.emit('error', new Error('reentrant close error'))
  })

  expect(() => browse.watcher.emit('error', new Error('directory removed'))).not.toThrow()
  browse.listener('change', 'queued-after-error.md')
  await vi.advanceTimersByTimeAsync(301)
  resolveListing([{ name: 'stale.md', path: '/browse/stale.md', kind: 'file' }])
  await Promise.resolve()

  expect(closeCalls).toBe(1)
  expect(listSiblings).toHaveBeenCalledOnce()
  expect(send).not.toHaveBeenCalledWith(win, 'siblings-changed', expect.anything())
  vi.useRealTimers()
})

it('invalidates an updateBrowsePath watcher before close and ignores its queued callback', async () => {
  vi.useFakeTimers()
  const watchers = new Map<string, { watcher: FakeWatcher; listener: (...args: unknown[]) => void }>()
  const listSiblings = vi.fn().mockResolvedValue([])
  const service = createWatchService({
    watch: (path, listener) => {
      const watcher = new FakeWatcher()
      watchers.set(path, { watcher, listener: listener as (...args: unknown[]) => void })
      return watcher as never
    },
    readFile: vi.fn(), existsSync: () => true, listSiblings,
    loadDocument: vi.fn(), onExternalDocument: vi.fn(), send: vi.fn(),
  })
  const win = fakeWindow()
  service.watch(win, { filePath: '/document/a.md', browsePath: '/document', knownSourceContent: '# A' })
  service.updateBrowsePath(win, '/browse')
  const browse = watchers.get('/browse')!
  let closeCalls = 0
  browse.watcher.close.mockImplementation(() => {
    closeCalls += 1
    if (closeCalls === 1) browse.watcher.emit('error', new Error('reentrant close error'))
  })

  expect(() => browse.watcher.emit('error', new Error('directory removed'))).not.toThrow()
  browse.listener('change', 'queued-after-error.md')
  await vi.advanceTimersByTimeAsync(301)

  expect(closeCalls).toBe(1)
  expect(listSiblings).not.toHaveBeenCalled()
  vi.useRealTimers()
})

it('publishes only the latest same-directory listing from the initially established browse watcher', async () => {
  vi.useFakeTimers()
  const listeners = new Map<string, (...args: unknown[]) => void>()
  const pending: Array<(files: Array<{ name: string; path: string; kind: 'file' }>) => void> = []
  const listSiblings = vi.fn(() => new Promise<Array<{ name: string; path: string; kind: 'file' }>>((resolve) => pending.push(resolve)))
  const send = vi.fn()
  const service = createWatchService({
    watch: (path, listener) => { listeners.set(path, listener as (...args: unknown[]) => void); return new FakeWatcher() as never },
    readFile: vi.fn(), existsSync: () => true, listSiblings,
    loadDocument: vi.fn(), onExternalDocument: vi.fn(), send,
  })
  const win = fakeWindow()
  service.watch(win, { filePath: '/document/a.md', browsePath: '/browse', knownSourceContent: '# A' })

  listeners.get('/browse')?.('change', 'a.md')
  await vi.advanceTimersByTimeAsync(301)
  listeners.get('/browse')?.('change', 'b.md')
  await vi.advanceTimersByTimeAsync(301)
  expect(listSiblings).toHaveBeenCalledTimes(2)
  pending[1]([{ name: 'b.md', path: '/browse/b.md', kind: 'file' }])
  await Promise.resolve()
  pending[0]([{ name: 'a.md', path: '/browse/a.md', kind: 'file' }])
  await Promise.resolve()

  expect(send).toHaveBeenCalledOnce()
  expect(send).toHaveBeenCalledWith(win, 'siblings-changed', [{ name: 'b.md', path: '/browse/b.md', kind: 'file' }])
  vi.useRealTimers()
})

it('publishes only the latest same-directory listing from an updateBrowsePath watcher', async () => {
  vi.useFakeTimers()
  const listeners = new Map<string, (...args: unknown[]) => void>()
  const pending: Array<(files: Array<{ name: string; path: string; kind: 'file' }>) => void> = []
  const listSiblings = vi.fn(() => new Promise<Array<{ name: string; path: string; kind: 'file' }>>((resolve) => pending.push(resolve)))
  const send = vi.fn()
  const service = createWatchService({
    watch: (path, listener) => { listeners.set(path, listener as (...args: unknown[]) => void); return new FakeWatcher() as never },
    readFile: vi.fn(), existsSync: () => true, listSiblings,
    loadDocument: vi.fn(), onExternalDocument: vi.fn(), send,
  })
  const win = fakeWindow()
  service.watch(win, { filePath: '/document/a.md', browsePath: '/document', knownSourceContent: '# A' })
  service.updateBrowsePath(win, '/browse')

  listeners.get('/browse')?.('change', 'a.md')
  await vi.advanceTimersByTimeAsync(301)
  listeners.get('/browse')?.('change', 'b.md')
  await vi.advanceTimersByTimeAsync(301)
  expect(listSiblings).toHaveBeenCalledTimes(2)
  pending[1]([{ name: 'b.md', path: '/browse/b.md', kind: 'file' }])
  await Promise.resolve()
  pending[0]([{ name: 'a.md', path: '/browse/a.md', kind: 'file' }])
  await Promise.resolve()

  expect(send).toHaveBeenCalledOnce()
  expect(send).toHaveBeenCalledWith(win, 'siblings-changed', [{ name: 'b.md', path: '/browse/b.md', kind: 'file' }])
  vi.useRealTimers()
})
