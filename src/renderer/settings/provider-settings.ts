import type { DraftMDAPI, ProviderConfigDTO, ProviderConfigInput, ProviderKind, ProviderPreset, ProviderSecretsInput, ProviderModel } from '../../shared/contracts'
import { msg } from '../../shared/i18n'
import { providerApiMode, type ProviderApiMode } from '../../shared/contracts/provider'
import { applyProviderPreset, providerModelDefaults, providerSecretState, PROVIDER_MODEL_PRESETS_UPDATED_AT, type SecretAction } from './provider-form'
import { reasoningEffortOptions, type ReasoningEffort } from '../../shared/reasoning-effort'

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
  const apiModeInput = required<HTMLSelectElement>(form, '[name=apiMode]')
  const apiModeRow = required<HTMLElement>(form, '[data-provider-api-mode]')
  const baseUrlInput = required<HTMLInputElement>(form, '[name=baseUrl]')
  const modelInput = required<HTMLInputElement>(form, '[name=model]')
  const effortInput = required<HTMLSelectElement>(form, '[name=reasoningEffort]')
  const effortRow = required<HTMLElement>(form, '[data-provider-reasoning]')
  const modelOptions = required<HTMLDataListElement>(form, '#provider-model-options')
  const syncModels = required<HTMLButtonElement>(form, '[data-provider-sync-models]')
  const modelStatus = required<HTMLElement>(form, '[data-model-status]')
  const apiKeyInput = required<HTMLInputElement>(form, '[name=apiKey]')
  const apiKeyState = required<HTMLElement>(form, '[data-api-key-state]')
  const replaceSecret = required<HTMLButtonElement>(form, '[data-replace-secret]')
  const removeSecret = required<HTMLButtonElement>(form, '[data-remove-secret]')
  const insecureInput = required<HTMLInputElement>(form, '[name=insecureHttpApproved]')
  const headerNameInput = required<HTMLInputElement>(form, '[name=headerName]')
  const headerValueInput = required<HTMLInputElement>(form, '[name=headerValue]')
  const connectionNote = required<HTMLElement>(form, '[data-provider-connection-note]')
  const disclosureInput = required<HTMLInputElement>(form, '[name=privacyDisclosure]')
  const testButton = required<HTMLButtonElement>(input.dialog, '[data-provider-test]')
  const status = required<HTMLElement>(form, '[data-provider-status]')
  let configs: ProviderConfigDTO[] = []
  let secretAction: SecretAction = 'retain'
  let modelGeneration = 0

  const renderEffort = (selected = effortInput.value): void => {
    const supported = reasoningEffortOptions({ kind: kindInput.value as ProviderKind, model: modelInput.value, apiMode: apiModeInput.value as ProviderApiMode })
    const options: ReasoningEffort[] = ['default', ...supported]
    effortInput.replaceChildren(...options.map(value => {
      const option = document.createElement('option')
      option.value = value
      option.textContent = msg(`provider.reasoning.${value}`)
      return option
    }))
    effortInput.value = options.includes(selected as ReasoningEffort) ? selected : 'default'
    effortRow.hidden = supported.length === 0
  }
  const onReasoningModel = (): void => { renderEffort() }

  const renderModels = (models: ProviderModel[]): void => {
    modelOptions.replaceChildren(...models.map(model => {
      const option = document.createElement('option')
      option.value = model.id
      if (model.name !== model.id) option.label = model.name
      return option
    }))
  }
  const resetModels = (): void => {
    modelGeneration++
    syncModels.disabled = false
    syncModels.removeAttribute('aria-busy')
    const defaults = providerModelDefaults(kindInput.value as ProviderKind, presetInput.value as ProviderPreset)
    modelStatus.hidden = defaults.models.length === 0
    modelStatus.textContent = defaults.models.length ? msg('provider.models.presets', { date: PROVIDER_MODEL_PRESETS_UPDATED_AT }) : ''
    renderModels(defaults.models.map(id => ({ id, name: id })))
  }

  const current = (): ProviderConfigDTO | null => configs.find((config) => config.id === idInput.value) ?? null
  const sameCredentialDestination = (): boolean => {
    const config = current()
    if (!config) return true
    try { return config.kind === kindInput.value && new URL(config.baseUrl).href.replace(/\/$/, '') === new URL(baseUrlInput.value).href.replace(/\/$/, '') }
    catch { return false }
  }
  const renderSecret = (): void => {
    const state = providerSecretState((current()?.hasCredential ?? false) && sameCredentialDestination(), secretAction)
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
    apiModeInput.value = config ? providerApiMode(config) : 'responses'
    apiModeRow.hidden = kindInput.value === 'anthropic'
    const defaults = providerModelDefaults(kindInput.value as ProviderKind, presetInput.value as ProviderPreset)
    baseUrlInput.value = config?.baseUrl ?? defaults.baseUrl
    modelInput.value = config?.model ?? defaults.model
    renderEffort(config?.reasoningEffort ?? 'default')
    insecureInput.checked = config?.insecureHttpApproved ?? false
    disclosureInput.checked = false
    headerNameInput.value = ''
    headerValueInput.value = ''
    secretAction = 'retain'
    status.textContent = config?.lastTestErrorCode ? msg(`provider.error.${config.lastTestErrorCode}`)
      : config ? msg(`provider.capability.${config.capability}` as 'provider.capability.agent') : ''
    renderSecret()
    updateConnectionNote()
    resetModels()
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
  const readSecrets = (): ProviderSecretsInput => {
    const secrets: ProviderSecretsInput = {}
    if (!sameCredentialDestination()) {
      secrets.removeApiKey = true
      secrets.removeHeaders = current()?.headerNames ?? []
    }
    if (headerNameInput.value.trim() && headerValueInput.value) secrets.headers = { [headerNameInput.value.trim()]: headerValueInput.value }
    if (secretAction === 'remove') secrets.removeApiKey = true
    else if (!apiKeyInput.hidden && apiKeyInput.value) { secrets.apiKey = apiKeyInput.value; secrets.removeApiKey = false }
    return secrets
  }
  const save = async (): Promise<ProviderConfigDTO> => {
    const config: ProviderConfigInput = {
      id: idInput.value || undefined,
      name: nameInput.value.trim(), kind: kindInput.value as ProviderKind,
      apiMode: kindInput.value === 'anthropic' ? undefined : apiModeInput.value as ProviderApiMode,
      preset: presetInput.value as ProviderPreset, baseUrl: baseUrlInput.value.trim(),
      model: modelInput.value.trim(), timeoutMs: 60_000, streamEnabled: true,
      reasoningEffort: effortInput.value as ReasoningEffort,
      toolsEnabled: true, insecureHttpApproved: insecureInput.checked,
    }
    if (!disclosureInput.checked) throw new Error(msg('provider.privacy.required'))
    const saved = await input.api.saveProviderConfig(config, readSecrets())
    await refresh()
    fill(configs.find((candidate) => candidate.id === saved.id) ?? saved)
    renderList()
    return saved
  }
  const onPreset = (): void => {
    const next = applyProviderPreset({ preset: presetInput.value as ProviderPreset, baseUrl: baseUrlInput.value })
    baseUrlInput.value = next.baseUrl
    if (next.preset !== 'none') kindInput.value = 'openai-compatible'
    apiModeInput.value = next.preset === 'none' ? 'responses' : 'chat-completions'
    apiModeRow.hidden = kindInput.value === 'anthropic'
    modelInput.value = ''
    renderEffort('default')
    secretAction = 'retain'
    renderSecret()
    headerValueInput.value = ''
    resetModels()
    updateConnectionNote()
  }
  const onKind = (): void => {
    presetInput.value = 'none'
    apiModeInput.value = 'responses'
    apiModeRow.hidden = kindInput.value === 'anthropic'
    const defaults = providerModelDefaults(kindInput.value as ProviderKind)
    baseUrlInput.value = defaults.baseUrl
    modelInput.value = defaults.model
    renderEffort('default')
    apiKeyInput.value = ''
    headerValueInput.value = ''
    secretAction = 'retain'
    renderSecret()
    resetModels()
    updateConnectionNote()
  }
  const onConnection = (): void => { resetModels(); updateConnectionNote() }
  const onEndpoint = (): void => {
    if (!sameCredentialDestination()) secretAction = 'retain'
    renderSecret(); headerValueInput.value = ''; onConnection()
  }
  const onSyncModels = (): void => {
    if (!baseUrlInput.reportValidity()) return
    const generation = ++modelGeneration
    syncModels.disabled = true
    syncModels.setAttribute('aria-busy', 'true')
    modelStatus.hidden = false
    modelStatus.textContent = msg('provider.models.syncing')
    void input.api.listProviderModels({
      id: idInput.value || undefined, kind: kindInput.value as ProviderKind,
      baseUrl: baseUrlInput.value.trim(), timeoutMs: 15_000, insecureHttpApproved: insecureInput.checked,
    }, readSecrets()).then(result => {
      if (generation !== modelGeneration || !input.dialog.open) return
      if (result.errorCode) {
        modelStatus.textContent = result.errorCode === 'MODEL_LIST_UNSUPPORTED' ? msg('provider.models.unsupported')
          : result.errorCode === 'SAVED_CREDENTIALS_MISMATCH' ? msg('provider.models.credentialsMismatch')
            : msg(`provider.error.${result.errorCode}`)
        return
      }
      renderModels(result.models)
      modelStatus.textContent = !result.models.length ? msg('provider.models.empty')
        : msg(result.truncated ? 'provider.models.truncated' : 'provider.models.synced', { count: result.models.length })
    }).catch(() => {
      if (generation === modelGeneration && input.dialog.open) modelStatus.textContent = msg('provider.error.CONNECTION')
    }).finally(() => {
      if (generation === modelGeneration) { syncModels.disabled = false; syncModels.removeAttribute('aria-busy') }
    })
  }
  const onSubmit = (event: SubmitEvent): void => { event.preventDefault(); void save().catch((error) => { status.textContent = error instanceof Error ? error.message : msg('provider.error.PROVIDER_ERROR') }) }
  const onReplace = (): void => { secretAction = 'replace'; renderSecret(); resetModels(); apiKeyInput.focus() }
  const onRemove = (): void => { secretAction = 'remove'; renderSecret(); resetModels() }
  const onTest = (): void => {
    void (async () => {
      const saved = await save()
      status.textContent = msg('provider.test.running')
      const result = await input.api.testProviderConfig(saved.id)
      await refresh()
      status.textContent = result.cancelled ? msg('provider.test.cancelled')
        : result.errorCode ? msg(`provider.error.${result.errorCode}` as 'provider.error.AUTHENTICATION')
          : msg(`provider.capability.${result.capability}` as 'provider.capability.agent')
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
  kindInput.addEventListener('change', onKind)
  modelInput.addEventListener('input', onReasoningModel)
  apiModeInput.addEventListener('change', onReasoningModel)
  const connectionInputs = [apiKeyInput, headerNameInput, headerValueInput, insecureInput]
  baseUrlInput.addEventListener('input', onEndpoint)
  connectionInputs.forEach(element => element.addEventListener('input', onConnection))
  syncModels.addEventListener('click', onSyncModels)
  input.dialog.addEventListener('close', resetModels)
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
      modelGeneration++
      presetInput.removeEventListener('change', onPreset); kindInput.removeEventListener('change', onKind); form.removeEventListener('submit', onSubmit)
      connectionInputs.forEach(element => element.removeEventListener('input', onConnection))
      baseUrlInput.removeEventListener('input', onEndpoint)
      modelInput.removeEventListener('input', onReasoningModel)
      apiModeInput.removeEventListener('change', onReasoningModel)
      syncModels.removeEventListener('click', onSyncModels); input.dialog.removeEventListener('close', resetModels)
      replaceSecret.removeEventListener('click', onReplace); removeSecret.removeEventListener('click', onRemove)
      testButton.removeEventListener('click', onTest); newButton.removeEventListener('click', onNew)
      closeButton.removeEventListener('click', onClose); deleteButton.removeEventListener('click', onDelete)
      defaultButton.removeEventListener('click', onDefault)
    },
  }
}
