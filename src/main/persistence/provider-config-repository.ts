import type Database from 'better-sqlite3'
import { ProviderConfigSchema, type ProviderConfig } from '../../shared/contracts/provider'
import { sameProviderConnection } from '../providers/provider-connection'

interface CapabilityTestRecord {
  capability: ProviderConfig['capability']
  testedAt: string
  testedModel: string
  latencyMs: number
  errorCode: ProviderConfig['lastTestErrorCode']
}

export interface ProviderConfigRecord extends ProviderConfig {
  isDefault: boolean
  lastTestedModel?: string | null
  lastTestLatencyMs?: number | null
}

interface ProviderRow {
  id: string; name: string; provider_type: ProviderConfig['kind']; endpoint: string | null; model: string
  credential_ref: string | null; settings_json: string; created_at: string; updated_at: string
  preset: ProviderConfig['preset']; header_credential_refs_json: string; timeout_ms: number
  stream_enabled: number; tools_enabled: number; insecure_http_approved: number
  capability: ProviderConfig['capability']; last_tested_at: string | null
  last_tested_model: string | null; last_test_latency_ms: number | null
  last_test_error_code: ProviderConfig['lastTestErrorCode']; is_default: number
}

function fromRow(row: ProviderRow): ProviderConfigRecord {
  const config = ProviderConfigSchema.parse({
    id: row.id, name: row.name, kind: row.provider_type, preset: row.preset,
    baseUrl: row.endpoint, model: row.model, credentialRef: row.credential_ref,
    headerCredentialRefs: JSON.parse(row.header_credential_refs_json), timeoutMs: row.timeout_ms,
    streamEnabled: Boolean(row.stream_enabled), toolsEnabled: Boolean(row.tools_enabled),
    insecureHttpApproved: Boolean(row.insecure_http_approved), capability: row.capability,
    lastTestedAt: row.last_tested_at, lastTestErrorCode: row.last_test_error_code,
  })
  return { ...config, isDefault: Boolean(row.is_default), lastTestedModel: row.last_tested_model, lastTestLatencyMs: row.last_test_latency_ms }
}

export function createProviderConfigRepository(database: Database.Database) {
  const save = database.prepare(`insert into provider_configs (
    id, name, provider_type, endpoint, model, credential_ref, settings_json, created_at, updated_at,
    preset, header_credential_refs_json, timeout_ms, stream_enabled, tools_enabled,
    insecure_http_approved, capability, last_tested_at, last_test_error_code, is_default
  ) values (
    @id, @name, @kind, @baseUrl, @model, @credentialRef, '{}', @createdAt, @updatedAt,
    @preset, @headerCredentialRefsJson, @timeoutMs, @streamEnabled, @toolsEnabled,
    @insecureHttpApproved, @capability, @lastTestedAt, @lastTestErrorCode, @isDefault
  ) on conflict(id) do update set
    name=excluded.name, provider_type=excluded.provider_type, endpoint=excluded.endpoint, model=excluded.model,
    credential_ref=excluded.credential_ref, updated_at=excluded.updated_at, preset=excluded.preset,
    header_credential_refs_json=excluded.header_credential_refs_json, timeout_ms=excluded.timeout_ms,
    stream_enabled=excluded.stream_enabled, tools_enabled=excluded.tools_enabled,
    insecure_http_approved=excluded.insecure_http_approved, capability=excluded.capability,
    last_tested_at=excluded.last_tested_at, last_test_error_code=excluded.last_test_error_code,
    last_tested_model=case when excluded.last_tested_at is null then null else provider_configs.last_tested_model end,
    last_test_latency_ms=case when excluded.last_tested_at is null then null else provider_configs.last_test_latency_ms end`)
  const get = database.prepare('select * from provider_configs where id = ?')
  const list = database.prepare('select * from provider_configs order by is_default desc, updated_at desc, id')
  const remove = database.prepare('delete from provider_configs where id = ?')
  const clearDefault = database.prepare('update provider_configs set is_default = 0')
  const setDefault = database.prepare('update provider_configs set is_default = 1 where id = ?')
  const updateTest = database.prepare(`update provider_configs set
    capability = @capability, last_tested_at = @testedAt, last_test_error_code = @errorCode,
    last_tested_model = @testedModel, last_test_latency_ms = @latencyMs, updated_at = @testedAt
    where id = @id`)
  const setDefaultTransaction = database.transaction((id: string) => {
    clearDefault.run()
    if (setDefault.run(id).changes !== 1) throw Object.assign(new Error('Provider config not found'), { code: 'CONFIG_NOT_FOUND' })
  })
  const updateTestTransaction = database.transaction((id: string, result: CapabilityTestRecord, expected: ProviderConfig): boolean => {
    const row = get.get(id) as ProviderRow | undefined
    if (!row || !sameProviderConnection(fromRow(row), expected)) return false
    return updateTest.run({ id, ...result }).changes === 1
  })
  return {
    save(record: ProviderConfigRecord & { createdAt: string; updatedAt: string }): void {
      save.run({
        ...record,
        headerCredentialRefsJson: JSON.stringify(record.headerCredentialRefs),
        streamEnabled: Number(record.streamEnabled), toolsEnabled: Number(record.toolsEnabled),
        insecureHttpApproved: Number(record.insecureHttpApproved), isDefault: Number(record.isDefault),
      })
    },
    get(id: string): ProviderConfigRecord | null {
      const row = get.get(id) as ProviderRow | undefined
      return row ? fromRow(row) : null
    },
    list(): ProviderConfigRecord[] { return (list.all() as ProviderRow[]).map(fromRow) },
    delete(id: string): boolean { return remove.run(id).changes === 1 },
    setDefault(id: string): void { setDefaultTransaction(id) },
    updateTestResult(id: string, result: CapabilityTestRecord, expected: ProviderConfig): boolean {
      return updateTestTransaction(id, result, expected)
    },
  }
}
