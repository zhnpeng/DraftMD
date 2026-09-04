import { msg } from '../../shared/i18n'
import type { AppBootstrap } from '../../shared/contracts/app'

type DatabaseWarning = AppBootstrap['databaseWarning']

export function createDatabaseWarningController(input: {
  banner: HTMLElement
  text: HTMLElement
  dismiss: HTMLButtonElement
}) {
  const dismiss = (): void => { input.banner.hidden = true }
  input.dismiss.addEventListener('click', dismiss)
  return {
    show(warning: Exclude<DatabaseWarning, null>): void {
      input.text.textContent = msg(warning === 'DATABASE_RECOVERED' ? 'database.recovered' : 'database.memoryFallback')
      input.banner.hidden = false
    },
    dispose(): void { input.dismiss.removeEventListener('click', dismiss) },
  }
}
