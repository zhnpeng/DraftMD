import { UUIDv7Schema, ProviderConfigSchema, type ProviderConfig } from '../../shared/contracts'
import type { CredentialStore } from '../credentials/credential-store'
import type { ProviderConfigRecord } from '../persistence/provider-config-repository'
import { uuidv7 } from '../persistence/ids'
import { validateProviderEndpoint } from './endpoint-policy'

export interface ProviderConfigInput {
  id?: string
  name: string
  kind: ProviderConfig['kind']
  preset: ProviderConfig['preset']
  baseUrl: string
  model: string
  timeoutMs: number
  streamEnabled: boolean
  toolsEnabled: boolean
  insecureHttpApproved: boolean
}

export interface ProviderSecretsInput {
  apiKey?: string
  removeApiKey?: boolean
  headers?: Record<string, string>
  removeHeaders?: string[]
}

export interface ProviderConfigDTO {
  id: string
  name: string
  kind: ProviderConfig['kind']
  preset: ProviderConfig['preset']
  baseUrl: string
  model: string
  timeoutMs: number
  streamEnabled: boolean
  toolsEnabled: boolean
  insecureHttpApproved: boolean
  capability: ProviderConfig['capability']
  lastTestedAt: string | null
  lastTestErrorCode: ProviderConfig['lastTestErrorCode']
  hasCredential: boolean
  headerNames: string[]
  isDefault: boolean
}

interface ProviderConfigRepository {
  save(record: ProviderConfigRecord & { createdAt: string; updatedAt: string }): void
  get(id: string): ProviderConfigRecord | null
  list(): ProviderConfigRecord[]
  delete(id: string): boolean
  setDefault(id: string): void
}

export interface ProviderConfigServiceDependencies {
  repository: ProviderConfigRepository
  credentials: CredentialStore
  createRef?: () => string
  now?: () => string
}

export class ProviderConfigServiceError extends Error {
  constructor(readonly code: 'DUPLICATE_HEADER' | 'CONFIG_NOT_FOUND') {
    super(code)
    this.name = 'ProviderConfigServiceError'
  }
}

function normalizeHeaders(headers: Record<string, string> = {}): Record<string, string> {
  const normalized: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    const key = name.trim().toLowerCase()
    if (!key || key in normalized) throw new ProviderConfigServiceError('DUPLICATE_HEADER')
    normalized[key] = value
  }
  return normalized
}

function dto(config: ProviderConfigRecord): ProviderConfigDTO {
  return {
    id: config.id, name: config.name, kind: config.kind, preset: config.preset,
    baseUrl: config.baseUrl, model: config.model, timeoutMs: config.timeoutMs,
    streamEnabled: config.streamEnabled, toolsEnabled: config.toolsEnabled,
    insecureHttpApproved: config.insecureHttpApproved, capability: config.capability,
    lastTestedAt: config.lastTestedAt, lastTestErrorCode: config.lastTestErrorCode,
    hasCredential: config.credentialRef !== null,
    headerNames: Object.keys(config.headerCredentialRefs).sort(),
    isDefault: config.isDefault,
  }
}

export function createProviderConfigService(deps: ProviderConfigServiceDependencies) {
  const createRef = deps.createRef ?? uuidv7
  const now = deps.now ?? (() => new Date().toISOString())
  return {
    listConfigs(): ProviderConfigDTO[] { return deps.repository.list().map(dto) },
    async saveConfig(input: ProviderConfigInput, secrets: ProviderSecretsInput = {}): Promise<ProviderConfigDTO> {
      validateProviderEndpoint(input.baseUrl, input.insecureHttpApproved)
      const id = input.id ? UUIDv7Schema.parse(input.id) : uuidv7()
      const existing = deps.repository.get(id)
      const normalizedHeaders = normalizeHeaders(secrets.headers)
      const createdRefs: string[] = []
      const replacedRefs: string[] = []
      let credentialRef = existing?.credentialRef ?? null
      const headerCredentialRefs = { ...(existing?.headerCredentialRefs ?? {}) }

      try {
        if (secrets.removeApiKey) {
          if (credentialRef) replacedRefs.push(credentialRef)
          credentialRef = null
        } else if (secrets.apiKey) {
          const next = createRef()
          await deps.credentials.set(next, secrets.apiKey)
          createdRefs.push(next)
          if (credentialRef) replacedRefs.push(credentialRef)
          credentialRef = next
        }
        for (const name of secrets.removeHeaders ?? []) {
          const key = name.trim().toLowerCase()
          if (headerCredentialRefs[key]) replacedRefs.push(headerCredentialRefs[key])
          delete headerCredentialRefs[key]
        }
        for (const [name, value] of Object.entries(normalizedHeaders)) {
          if (!value) continue
          const next = createRef()
          await deps.credentials.set(next, value)
          createdRefs.push(next)
          if (headerCredentialRefs[name]) replacedRefs.push(headerCredentialRefs[name])
          headerCredentialRefs[name] = next
        }

        const timestamp = now()
        const config = ProviderConfigSchema.parse({
          id, name: input.name, kind: input.kind, preset: input.preset, baseUrl: input.baseUrl,
          model: input.model, credentialRef, headerCredentialRefs, timeoutMs: input.timeoutMs,
          streamEnabled: input.streamEnabled, toolsEnabled: input.toolsEnabled,
          insecureHttpApproved: input.insecureHttpApproved,
          capability: existing?.capability ?? 'unavailable',
          lastTestedAt: existing?.lastTestedAt ?? null,
          lastTestErrorCode: existing?.lastTestErrorCode ?? null,
        })
        const record: ProviderConfigRecord & { createdAt: string; updatedAt: string } = {
          ...config, isDefault: existing?.isDefault ?? deps.repository.list().length === 0,
          createdAt: timestamp, updatedAt: timestamp,
        }
        deps.repository.save(record)
        await Promise.allSettled(replacedRefs.filter((ref) => !createdRefs.includes(ref)).map((ref) => deps.credentials.delete(ref)))
        return dto(record)
      } catch (error) {
        await Promise.allSettled(createdRefs.map((ref) => deps.credentials.delete(ref)))
        throw error
      }
    },
    async materialize(id: string): Promise<{ config: ProviderConfigRecord; apiKey: string | null; headers: Record<string, string> }> {
      const config = deps.repository.get(id)
      if (!config) throw new ProviderConfigServiceError('CONFIG_NOT_FOUND')
      const headers: Record<string, string> = {}
      for (const [name, ref] of Object.entries(config.headerCredentialRefs)) {
        const secret = await deps.credentials.get(ref)
        if (secret !== null) headers[name] = secret
      }
      return {
        config,
        apiKey: config.credentialRef ? await deps.credentials.get(config.credentialRef) : null,
        headers,
      }
    },
    setDefault(id: string): void { deps.repository.setDefault(id) },
    async deleteConfig(id: string, deleteSecrets: boolean): Promise<boolean> {
      const config = deps.repository.get(id)
      if (!config) return false
      if (!deps.repository.delete(id)) return false
      if (deleteSecrets) {
        const refs = [config.credentialRef, ...Object.values(config.headerCredentialRefs)].filter((ref): ref is string => ref !== null)
        await Promise.allSettled(refs.map((ref) => deps.credentials.delete(ref)))
      }
      return true
    },
  }
}
