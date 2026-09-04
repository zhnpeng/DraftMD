import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  checkForUpdates: vi.fn(), downloadUpdate: vi.fn(), quitAndInstall: vi.fn(), on: vi.fn(),
  showMessageBox: vi.fn().mockResolvedValue({ response: 0 }),
}))
vi.mock('electron-updater', () => ({ autoUpdater: {
  checkForUpdates: mocks.checkForUpdates, downloadUpdate: mocks.downloadUpdate,
  quitAndInstall: mocks.quitAndInstall, on: mocks.on,
}}))
vi.mock('electron', () => ({
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  dialog: { showMessageBox: mocks.showMessageBox },
}))

import { createUpdateService } from '../../../src/main/app/update-service'

beforeEach(() => Object.values(mocks).forEach((mock) => mock.mockClear()))

it('never contacts or promises an updater when releases are unconfigured', async () => {
  vi.useFakeTimers()
  const service = createUpdateService({
    locale: () => 'en', rebuildMenu: vi.fn(), appVersion: () => '0.1.0',
    isPackaged: true, updatesConfigured: false,
  })

  service.setup()
  await vi.advanceTimersByTimeAsync(10_000)
  await expect(service.check()).resolves.toBe(false)
  await expect(service.check(true)).resolves.toBe(false)
  await expect(service.download()).resolves.toBe(false)
  expect(service.install()).toBe(false)

  expect(mocks.checkForUpdates).not.toHaveBeenCalled()
  expect(mocks.downloadUpdate).not.toHaveBeenCalled()
  expect(mocks.quitAndInstall).not.toHaveBeenCalled()
  vi.useRealTimers()
})

it('retains the configured updater path behind the explicit capability', async () => {
  mocks.checkForUpdates.mockResolvedValue({})
  mocks.downloadUpdate.mockResolvedValue([])
  const service = createUpdateService({
    locale: () => 'en', rebuildMenu: vi.fn(), appVersion: () => '0.1.0',
    isPackaged: true, updatesConfigured: true,
  })

  expect(await service.check()).toBe(true)
  await service.download()
  expect(service.install()).toBe(true)

  expect(mocks.checkForUpdates).toHaveBeenCalledOnce()
  expect(mocks.downloadUpdate).toHaveBeenCalledOnce()
  expect(mocks.quitAndInstall).toHaveBeenCalledWith(false, true)
})
