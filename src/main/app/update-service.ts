import { BrowserWindow, dialog } from 'electron'
import { autoUpdater } from 'electron-updater'
import { IpcEventSchemas } from '../../shared/contracts'
import { t, type Locale } from '../../shared/i18n'

export interface UpdateService {
  setup(): void
  check(manual?: boolean): Promise<boolean>
  download(): Promise<boolean>
  install(): boolean
  latestVersion(): string | null
}

export function createUpdateService(deps: { locale(): Locale; rebuildMenu(): void; appVersion(): string; isPackaged: boolean; updatesConfigured: boolean }): UpdateService {
  let manualUpdateCheck = false
  let latestVersion: string | null = null
  const showMessage = (options: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> => {
    const win = BrowserWindow.getFocusedWindow()
    return win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options)
  }
  const broadcast = (channel: 'update-available' | 'update-downloaded', version: string): void => {
    const parsed = IpcEventSchemas[channel].safeParse([version])
    if (!parsed.success) return
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, ...parsed.data)
    }
  }
  const check = async (manual = false): Promise<boolean> => {
    if (!deps.isPackaged || !deps.updatesConfigured) return false
    manualUpdateCheck = manual
    try {
      await autoUpdater.checkForUpdates()
      return true
    } catch (error) {
      if (!manualUpdateCheck) return false
      manualUpdateCheck = false
      console.error('Update check failed:', error)
      const locale = deps.locale()
      await showMessage({
        type: 'error', buttons: [t(locale, 'common.ok')], message: t(locale, 'update.checkFailed'),
        detail: t(locale, 'update.checkFailedDetail'),
      })
      return false
    }
  }
  return {
    setup() {
      if (!deps.isPackaged || !deps.updatesConfigured) return
      autoUpdater.autoDownload = false
      autoUpdater.autoInstallOnAppQuit = true
      autoUpdater.on('update-available', (info) => {
        manualUpdateCheck = false
        latestVersion = info.version
        deps.rebuildMenu()
        broadcast('update-available', info.version)
      })
      autoUpdater.on('update-not-available', () => {
        if (!manualUpdateCheck) return
        manualUpdateCheck = false
        const locale = deps.locale()
        void showMessage({
          type: 'info', buttons: [t(locale, 'common.ok')], message: t(locale, 'update.current'),
          detail: t(locale, 'update.currentVersion', { version: deps.appVersion() }),
        })
      })
      autoUpdater.on('update-downloaded', (info) => broadcast('update-downloaded', info.version))
      autoUpdater.on('error', (error) => console.error('autoUpdater:', error.message))
      setTimeout(() => { void check() }, 8000)
    },
    check,
    download: async () => {
      if (!deps.updatesConfigured) return false
      await autoUpdater.downloadUpdate()
      return true
    },
    install: () => {
      if (!deps.updatesConfigured) return false
      autoUpdater.quitAndInstall(false, true)
      return true
    },
    latestVersion: () => latestVersion,
  }
}
