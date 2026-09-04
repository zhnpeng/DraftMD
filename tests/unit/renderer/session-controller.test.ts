import { expect, it, vi } from 'vitest'
import { createSessionController } from '../../../src/renderer/agent/session-controller'
import type { ProviderConfigDTO, SessionDTO } from '../../../src/shared/contracts'

const provider = (id: string, isDefault = false): ProviderConfigDTO => ({
  id, name: id.endsWith('1') ? 'Primary' : 'Secondary', kind: 'openai-compatible', preset: 'none',
  baseUrl: 'https://example.com/v1', model: 'model', timeoutMs: 60_000, streamEnabled: true,
  toolsEnabled: true, insecureHttpApproved: false, capability: 'agent', lastTestedAt: null,
  lastTestErrorCode: null, hasCredential: false, headerNames: [], isDefault,
})
const session = (id: string, providerConfigId: string | null): SessionDTO => ({
  id, workspaceId: 'a'.repeat(64), title: id.endsWith('1') ? 'First' : 'Second',
  createdAt: '2026-09-01T12:00:00.000Z', updatedAt: '2026-09-01T12:00:00.000Z', providerConfigId,
})
const p1 = '01991d5a-1c00-7000-8000-000000000001'
const p2 = '01991d5a-1c00-7000-8000-000000000002'
const s1 = '01991d5a-1c00-7000-8000-000000000011'
const s2 = '01991d5a-1c00-7000-8000-000000000012'

function setup() {
  const api = {
    listSessions: vi.fn().mockResolvedValue([session(s1, p2), session(s2, null)]),
    listProviderConfigs: vi.fn().mockResolvedValue([provider(p1, true), provider(p2)]),
    switchSessionModel: vi.fn().mockResolvedValue(undefined), renameSession: vi.fn().mockResolvedValue(true),
    deleteSession: vi.fn().mockResolvedValue(true),
  }
  return { api, controller: createSessionController({ api: api as never }) }
}

it('restores the selected session provider and falls back to the default', async () => {
  const { controller } = setup()
  await controller.refresh('a'.repeat(64))
  expect(controller.state()).toMatchObject({ currentSessionId: s1, providerId: p2 })
  controller.selectSession(s2)
  expect(controller.state().providerId).toBe(p1)
  controller.selectSession(null)
  expect(controller.state().providerId).toBe(p1)
})

it('persists a model switch only when a session already exists', async () => {
  const { api, controller } = setup()
  await controller.refresh('a'.repeat(64))
  await controller.selectProvider(p1)
  expect(api.switchSessionModel).toHaveBeenCalledWith({ sessionId: s1, providerConfigId: p1 })
  controller.selectSession(null)
  await controller.selectProvider(p2)
  expect(api.switchSessionModel).toHaveBeenCalledTimes(1)
})

it('keeps the selected session after rename and selects a deterministic neighbor after delete', async () => {
  const { controller } = setup()
  await controller.refresh('a'.repeat(64))
  await controller.rename(s1, 'Renamed')
  expect(controller.state().currentSessionId).toBe(s1)
  await controller.delete(s1)
  expect(controller.state().currentSessionId).toBe(s2)
})
