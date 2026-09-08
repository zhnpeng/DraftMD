import { dialog, shell } from 'electron'
import { execFile } from 'node:child_process'
import { DEFAULT_APP_SCRIPT, formatDefaultAppResultDetails, logDefaultAppExecFailure, parseDefaultAppResults } from '../default-app'
import { t, type Locale } from '../../shared/i18n'

export function setAsDefaultApp(locale: () => Locale, platform: NodeJS.Platform = process.platform): void {
  if (platform === 'win32') {
    void shell.openExternal('ms-settings:defaultapps').catch(() => {
      void dialog.showMessageBox({ type: 'error', message: t(locale(), 'defaultApp.failed'), detail: t(locale(), 'defaultApp.failedDetail') })
    })
    return
  }
  if (platform !== 'darwin') {
    void dialog.showMessageBox({ type: 'info', message: t(locale(), 'defaultApp.macOnly') })
    return
  }
  execFile('osascript', ['-l', 'JavaScript', '-e', DEFAULT_APP_SCRIPT], (error, stdout, stderr) => {
    if (error) {
      logDefaultAppExecFailure(error, stderr)
      void dialog.showMessageBox({
        type: 'error', message: t(locale(), 'defaultApp.failed'), detail: t(locale(), 'defaultApp.failedDetail'),
      })
      return
    }
    try {
      const results = parseDefaultAppResults(stdout)
      const current = locale()
      void dialog.showMessageBox({
        type: 'info', message: t(current, results.every(({ ok }) => ok) ? 'defaultApp.success' : 'defaultApp.partial'),
        detail: formatDefaultAppResultDetails(current, results),
      })
    } catch {
      void dialog.showMessageBox({ type: 'info', message: t(locale(), 'defaultApp.requestSent') })
    }
  })
}
