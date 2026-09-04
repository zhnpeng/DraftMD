import type { DraftMDAPI } from '../../shared/contracts/ipc'
import { msg, setLocale, type Locale } from '../../shared/i18n'

export type OnboardingStep = 'language' | 'folder' | 'model' | 'permissions' | 'complete'

export function createOnboardingState() {
  let step: OnboardingStep = 'language'
  let completed = false
  return {
    get step(): OnboardingStep { return step },
    get completed(): boolean { return completed },
    next(input: { hasWorkspace?: boolean } = {}): OnboardingStep {
      if (step === 'language') step = 'folder'
      else if (step === 'folder') {
        if (!input.hasWorkspace) return step
        step = 'model'
      } else if (step === 'model') step = 'permissions'
      else if (step === 'permissions') { step = 'complete'; completed = true }
      return step
    },
    complete(): void { step = 'complete'; completed = true },
    reopen(): void { step = 'language' },
  }
}

export function createOnboarding(input: {
  api: DraftMDAPI
  storage?: Storage
  currentWorkspaceId(): string | null
  applyLocale(locale: Locale): void
  configureModel(): void
}) {
  const state = createOnboardingState()
  const dialog = document.createElement('dialog')
  dialog.id = 'onboarding-dialog'
  dialog.className = 'onboarding-dialog'
  dialog.setAttribute('aria-labelledby', 'onboarding-title')
  document.body.appendChild(dialog)

  const readCompleted = (): boolean => {
    try { return input.storage?.getItem('draftmd-onboarding-complete') === '1' } catch { return false }
  }
  const saveCompleted = (): void => {
    try { input.storage?.setItem('draftmd-onboarding-complete', '1') } catch { /* storage is best effort */ }
  }
  const closeCompleted = (): void => {
    state.complete()
    saveCompleted()
    dialog.close()
  }
  const button = (text: string, action: () => void | Promise<void>, className = ''): HTMLButtonElement => {
    const element = document.createElement('button')
    element.type = 'button'
    element.textContent = text
    element.className = className
    element.addEventListener('click', () => { void action() })
    return element
  }
  const render = (): void => {
    dialog.replaceChildren()
    const header = document.createElement('header')
    const title = document.createElement('h2')
    title.id = 'onboarding-title'
    const progress = document.createElement('span')
    progress.className = 'onboarding-progress'
    const stepNumber: Record<Exclude<OnboardingStep, 'complete'>, number> = { language: 1, folder: 2, model: 3, permissions: 4 }
    if (state.step !== 'complete') progress.textContent = msg('onboarding.progress', { current: stepNumber[state.step], total: 4 })
    header.append(title, progress)
    const content = document.createElement('div')
    content.className = 'onboarding-content'
    const actions = document.createElement('div')
    actions.className = 'onboarding-actions'

    if (state.step === 'language') {
      title.textContent = msg('onboarding.languageTitle')
      const text = document.createElement('p'); text.textContent = msg('onboarding.languageBody')
      const choices = document.createElement('div'); choices.className = 'onboarding-language'
      for (const [locale, label] of [['en', 'English'], ['zh-CN', '中文']] as const) {
        choices.append(button(label, async () => {
          await input.api.setAppLocale(locale)
          setLocale(locale)
          input.applyLocale(locale)
          state.next()
          render()
        }))
      }
      content.append(text, choices)
    } else if (state.step === 'folder') {
      title.textContent = msg('onboarding.folderTitle')
      const text = document.createElement('p')
      text.textContent = input.currentWorkspaceId() ? msg('onboarding.folderReady') : msg('onboarding.folderBody')
      content.append(text)
      actions.append(button(
        input.currentWorkspaceId() ? msg('onboarding.continue') : msg('onboarding.openFolder'),
        async () => {
          if (!input.currentWorkspaceId()) await input.api.openWorkspace()
          if (state.next({ hasWorkspace: Boolean(input.currentWorkspaceId()) }) !== 'folder') render()
        }, 'primary',
      ))
    } else if (state.step === 'model') {
      title.textContent = msg('onboarding.modelTitle')
      const text = document.createElement('p'); text.textContent = msg('onboarding.modelBody')
      content.append(text)
      actions.append(
        button(msg('onboarding.configureModel'), () => { dialog.close(); input.configureModel() }),
        button(msg('onboarding.skipModel'), () => { state.next(); render() }, 'primary'),
      )
    } else if (state.step === 'permissions') {
      title.textContent = msg('onboarding.permissionsTitle')
      const list = document.createElement('ul')
      for (const key of ['onboarding.permissionMarkdown', 'onboarding.permissionDelete', 'onboarding.permissionNoShell'] as const) {
        const item = document.createElement('li'); item.textContent = msg(key); list.append(item)
      }
      content.append(list)
      actions.append(button(msg('onboarding.finish'), closeCompleted, 'primary'))
    }
    if (state.step !== 'complete') actions.prepend(button(msg('onboarding.skipGuide'), closeCompleted))
    dialog.append(header, content, actions)
  }
  const show = (force = false): void => {
    if (!force && readCompleted()) return
    if (force) state.reopen()
    render()
    if (!dialog.open) dialog.showModal()
  }
  return {
    show,
    dispose() { dialog.remove() },
  }
}
