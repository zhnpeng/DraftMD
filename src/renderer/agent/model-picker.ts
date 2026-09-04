import type { ProviderConfigDTO } from '../../shared/contracts/provider'
import { msg } from '../../shared/i18n'

export function providerLabel(provider: ProviderConfigDTO): string {
  const suffix = provider.capability === 'chat-only'
    ? ` · ${msg('dock.suggestionsOnly')}`
    : provider.capability === 'unavailable' ? ` · ${msg('dock.modelUnavailable')}` : ''
  return `${provider.name} · ${provider.model}${suffix}`
}

export function renderModelMenu(input: {
  container: HTMLElement
  providers: ProviderConfigDTO[]
  currentId: string | null
  onSelect(id: string): Promise<void>
  onConfigure(): void
}): void {
  input.container.replaceChildren()
  for (const provider of input.providers) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'agent-model-option'
    button.textContent = providerLabel(provider)
    button.setAttribute('aria-current', provider.id === input.currentId ? 'true' : 'false')
    if (provider.capability === 'unavailable') {
      button.addEventListener('click', input.onConfigure)
    } else {
      button.addEventListener('click', () => { void input.onSelect(provider.id) })
    }
    input.container.append(button)
  }
  const configure = document.createElement('button')
  configure.type = 'button'
  configure.className = 'agent-menu-configure'
  configure.textContent = msg('dock.configureModels')
  configure.addEventListener('click', input.onConfigure)
  input.container.append(configure)
}
