import type { DraftMDAPI, ProviderConfigDTO, ProviderConfigInput, ProviderKind, ProviderPreset, ProviderSecretsInput } from '../../shared/contracts'
import { msg } from '../../shared/i18n'
import { applyProviderPreset, providerSecretState, type SecretAction } from './provider-form'

function required<T extends HTMLElement>(root: ParentNode, selector: string): T {
  const element = root.querySelector(selector)
  if (!element) throw new Error(`Missing provider settings element ${selector}`)
  return element as T
}

export function createProviderSettings(input: { api: DraftMDAPI; dialog: HTMLDialogElement }) {
  const form = required<HTMLFormElement>(input.dialog, 'form')
  const list = required<HTMLElement>(input.dialog, '[data-provider-list]')
  const idInput = required<HTMLInputElement>(form, '[name=id]')
  const nameInput = required<HTMLInputElement>(form, '[name=name]')
  const kindInput = required<HTMLSelectElement>(form, '[name=kind]')
  const presetInput = required<HTMLSelectElement>(form, '[name=preset]')
  const baseUrlInput = required<HTMLInputElement>(form, '[name=baseUrl]')
  const modelInput = required<HTMLInputElement>(form, '[name=model]')
  const apiKeyInput = required<HTMLInputElement>(form, '[name=apiKey]')
  const apiKeyState = required<HTMLElement>(form, '[data-api-key-state]')
  const replaceSecret = required<HTMLButtonElement>(form, '[data-replace-secret]')
  const removeSecret = required<HTMLButtonElement>(form, '[data-remove-secret]')
  const insecureInput = required<HTMLInputElement>(form, '[name=insecureHttpApproved]')
  const headerNameInput = required<HTMLInputElement>(form, '[name=headerName]')
  const headerValueInput = required<HTMLInputElement>(form, '[name=headerValue]')
  const connectionNote = required<HTMLElement>(form, '[data-provider-connection-note]')
  const disclosureInput = required<HTMLInputElement>(form, '[name=privacyDisclosure]')
  const testButton = required<HTMLButtonElement>(form, '[data-provider-test]')
  const status = required<HTMLElement>(form, '[data-provider-status]')
  let configs: ProviderConfigDTO[] = []
  let secretAction: SecretAction = 'retain'

  const current = (): ProviderConfigDTO | null => configs.find((config) => config.id === idInput.value) ?? null
  const renderSecret = (): void => {
    const state = providerSecretState(current()?.hasCredential ?? false, secretAction)
    apiKeyState.textContent = msg(state.status === 'saved' ? 'provider.secret.saved' : state.status === 'removed' ? 'provider.secret.removed' : 'provider.secret.empty')
    apiKeyInput.hidden = !state.inputVisible
    apiKeyInput.value = ''
    replaceSecret.hidden = state.status !== 'saved'
    removeSecret.hidden = state.status !== 'saved'
  }
  const updateConnectionNote = (): void => {
    try {
      const url = new URL(baseUrlInput.value)
      const local = url.hostname === 'localhost' || url.hostname.endsWith('.local') || /^(?:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(url.hostname) || url.hostname === '[::1]'
      connectionNote.textContent = local ? msg('provider.connection.local') : msg('provider.connection.remote', { host: url.host })
    } catch { connectionNote.textContent = '' }
  }
  const fill = (config: ProviderConfigDTO | null): void => {
    idInput.value = config?.id ?? ''
    nameInput.value = config?.name ?? ''
    kindInput.value = config?.kind ?? 'anthropic'
    presetInput.value = config?.preset ?? 'none'
    baseUrlInput.value = config?.baseUrl ?? 'https://api.anthropic.com'
    modelInput.value = config?.model ?? 'claude-opus-5'
    insecureInput.checked = config?.insecureHttpApproved ?? false
    disclosureInput.checked = false
    headerNameInput.value = ''
    headerValueInput.value = ''
    secretAction = 'retain'
    status.textContent = config ? msg(`provider.capability.${config.capability}` as 'provider.capability.agent') : ''
    renderSecret()
    updateConnectionNote()
  }
  const renderList = (): void => {
    list.innerHTML = ''
    for (const config of configs) {
      const button = document.createElement('button')
      button.type = 'button'
      button.dataset.providerId = config.id
      button.className = config.id === idInput.value ? 'active' : ''
      const title = document.createElement('span'); title.textContent = config.name
      const badge = document.createElement('span'); badge.className = `provider-badge ${config.capability}`
      badge.textContent = msg(`provider.capability.${config.capability}` as 'provider.capability.agent')
      button.append(title, badge)
      button.addEventListener('click', () => { fill(config); renderList() })
      list.appendChild(button)
    }
  }
  const refresh = async (): Promise<void> => {
    configs = await input.api.listProviderConfigs()
    const active = current() ?? configs.find((config) => config.isDefault) ?? configs[0] ?? null
    fill(active)
    renderList()
  }
  const save = async (): Promise<ProviderConfigDTO> => {
    const config: ProviderConfigInput = {
      id: idInput.value || undefined,
      name: nameInput.value.trim(), kind: kindInput.value as ProviderKind,
      preset: presetInput.value as ProviderPreset, baseUrl: baseUrlInput.value.trim(),
      model: modelInput.value.trim(), timeoutMs: 60_000, streamEnabled: true,
      toolsEnabled: true, insecureHttpApproved: insecureInput.checked,
    }
    if (!disclosureInput.checked) throw new Error(msg('provider.privacy.required'))
    const secrets: ProviderSecretsInput = {}
    if (headerNameInput.value.trim() && headerValueInput.value) secrets.headers = { [headerNameInput.value.trim()]: headerValueInput.value }
    if (secretAction === 'remove') secrets.removeApiKey = true
    else if (!apiKeyInput.hidden && apiKeyInput.value) secrets.apiKey = apiKeyInput.value
    const saved = await input.api.saveProviderConfig(config, secrets)
    await refresh()
    fill(configs.find((candidate) => candidate.id === saved.id) ?? saved)
    renderList()
    return saved
  }
  const onPreset = (): void => {
    const next = applyProviderPreset({ preset: presetInput.value as ProviderPreset, baseUrl: baseUrlInput.value })
    baseUrlInput.value = next.baseUrl
    if (next.preset !== 'none') kindInput.value = 'openai-compatible'
  }
  const onSubmit = (event: SubmitEvent): void => { event.preventDefault(); void save().catch((error) => { status.textContent = error instanceof Error ? error.message : msg('provider.error.PROVIDER_ERROR') }) }
  const onReplace = (): void => { secretAction = 'replace'; renderSecret(); apiKeyInput.focus() }
  const onRemove = (): void => { secretAction = 'remove'; renderSecret() }
  const onTest = (): void => {
    void (async () => {
      const saved = await save()
      status.textContent = msg('provider.test.running')
      const result = await input.api.testProviderConfig(saved.id)
      status.textContent = result.cancelled ? msg('provider.test.cancelled')
        : result.errorCode ? msg(`provider.error.${result.errorCode}` as 'provider.error.AUTHENTICATION')
          : msg(`provider.capability.${result.capability}` as 'provider.capability.agent')
      await refresh()
    })().catch((error) => { status.textContent = error instanceof Error ? error.message : msg('provider.error.PROVIDER_ERROR') })
  }
  const newButton = required<HTMLButtonElement>(input.dialog, '[data-provider-new]')
  const closeButton = required<HTMLButtonElement>(input.dialog, '[data-provider-close]')
  const deleteButton = required<HTMLButtonElement>(input.dialog, '[data-provider-delete]')
  const defaultButton = required<HTMLButtonElement>(input.dialog, '[data-provider-default]')
  const onNew = (): void => { fill(null); renderList() }
  const onClose = (): void => input.dialog.close()
  const onDelete = (): void => { const id = idInput.value; if (id) void input.api.deleteProviderConfig(id, true).then(refresh) }
  const onDefault = (): void => { const id = idInput.value; if (id) void input.api.setDefaultProvider(id).then(refresh) }
  presetInput.addEventListener('change', onPreset)
  baseUrlInput.addEventListener('input', updateConnectionNote)
  form.addEventListener('submit', onSubmit)
  replaceSecret.addEventListener('click', onReplace)
  removeSecret.addEventListener('click', onRemove)
  testButton.addEventListener('click', onTest)
  newButton.addEventListener('click', onNew)
  closeButton.addEventListener('click', onClose)
  deleteButton.addEventListener('click', onDelete)
  defaultButton.addEventListener('click', onDefault)

  return {
    async show(): Promise<void> { await refresh(); input.dialog.showModal() },
    dispose(): void {
      presetInput.removeEventListener('change', onPreset); baseUrlInput.removeEventListener('input', updateConnectionNote); form.removeEventListener('submit', onSubmit)
      replaceSecret.removeEventListener('click', onReplace); removeSecret.removeEventListener('click', onRemove)
      testButton.removeEventListener('click', onTest); newButton.removeEventListener('click', onNew)
      closeButton.removeEventListener('click', onClose); deleteButton.removeEventListener('click', onDelete)
      defaultButton.removeEventListener('click', onDefault)
    },
  }
}
