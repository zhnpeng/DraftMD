import { msg } from '../../shared/i18n'

export interface UpdateBannerController {
  showAvailable(version: string): void
  showDownloaded(version: string): void
  dispose(): void
}

export function createUpdateBannerController(input: {
  banner: HTMLElement
  text: HTMLElement
  action: HTMLButtonElement
  dismiss: HTMLButtonElement
  download(): Promise<boolean>
  install(): Promise<boolean>
}): UpdateBannerController {
  let downloaded = false
  let version = ''
  const render = (): void => {
    input.text.textContent = msg(downloaded ? 'update.downloaded' : 'update.available', { version })
    input.action.textContent = msg(downloaded ? 'update.install' : 'update.action')
    input.action.disabled = false
    input.banner.hidden = false
  }
  const showUnavailable = (): void => {
    input.text.textContent = msg('update.downloadFailed')
    input.action.textContent = msg('update.retry')
    input.action.disabled = false
  }
  const click = async (): Promise<void> => {
    if (downloaded) {
      if (!await input.install()) showUnavailable()
      return
    }
    input.action.textContent = msg('update.downloading')
    input.action.disabled = true
    try {
      if (!await input.download()) showUnavailable()
    } catch {
      showUnavailable()
    }
  }
  const dismiss = (): void => { input.banner.hidden = true }
  input.action.addEventListener('click', click)
  input.dismiss.addEventListener('click', dismiss)
  return {
    showAvailable(nextVersion) { downloaded = false; version = nextVersion; render() },
    showDownloaded(nextVersion) { downloaded = true; version = nextVersion; render() },
    dispose() {
      input.action.removeEventListener('click', click)
      input.dismiss.removeEventListener('click', dismiss)
    },
  }
}
