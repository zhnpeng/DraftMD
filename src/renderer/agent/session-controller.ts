import type { DraftMDAPI, ProviderConfigDTO, SessionDTO } from '../../shared/contracts'

export function createSessionController(input: { api: DraftMDAPI }) {
  let workspaceId: string | null = null
  let sessions: SessionDTO[] = []
  let currentSessionId: string | null = null
  let providers: ProviderConfigDTO[] = []
  let providerId: string | null = null

  const defaultProviderId = (): string | null =>
    providers.find((provider) => provider.isDefault)?.id ?? providers[0]?.id ?? null
  const providerForSession = (sessionId: string | null): string | null => {
    const saved = sessions.find((session) => session.id === sessionId)?.providerConfigId
    return saved && providers.some((provider) => provider.id === saved) ? saved : defaultProviderId()
  }
  const loadSessions = async (id: string): Promise<void> => {
    sessions = await input.api.listSessions(id)
  }

  return {
    async refresh(id: string): Promise<void> {
      workspaceId = id
      const [nextSessions, nextProviders] = await Promise.all([
        input.api.listSessions(id), input.api.listProviderConfigs(),
      ])
      sessions = nextSessions
      providers = nextProviders
      if (!currentSessionId || !sessions.some((session) => session.id === currentSessionId)) {
        currentSessionId = sessions[0]?.id ?? null
      }
      providerId = providerForSession(currentSessionId)
    },
    async setWorkspace(id: string): Promise<void> {
      const changed = workspaceId !== id
      workspaceId = id
      await loadSessions(id)
      if (changed || !currentSessionId || !sessions.some((session) => session.id === currentSessionId)) {
        currentSessionId = sessions[0]?.id ?? null
      }
      providerId = providerForSession(currentSessionId)
    },
    async refreshProviders(): Promise<void> {
      providers = await input.api.listProviderConfigs()
      if (!providerId || !providers.some((provider) => provider.id === providerId)) {
        providerId = providerForSession(currentSessionId)
      }
    },
    state() {
      return { workspaceId, sessions: [...sessions], currentSessionId, providers: [...providers], providerId }
    },
    selectSession(id: string | null): void {
      currentSessionId = id && sessions.some((session) => session.id === id) ? id : null
      providerId = providerForSession(currentSessionId)
    },
    async selectProvider(id: string): Promise<boolean> {
      if (!providers.some((provider) => provider.id === id)) return false
      providerId = id
      if (currentSessionId) await input.api.switchSessionModel({ sessionId: currentSessionId, providerConfigId: id })
      const current = sessions.find((session) => session.id === currentSessionId)
      if (current) current.providerConfigId = id
      return true
    },
    async rename(id: string, title: string): Promise<boolean> {
      const result = await input.api.renameSession({ id, title })
      if (result) {
        const session = sessions.find((candidate) => candidate.id === id)
        if (session) session.title = title
      }
      return result
    },
    async delete(id: string): Promise<boolean> {
      const result = await input.api.deleteSession(id)
      if (!result) return false
      sessions = sessions.filter((session) => session.id !== id)
      if (currentSessionId === id) currentSessionId = sessions[0]?.id ?? null
      providerId = providerForSession(currentSessionId)
      return true
    },
  }
}
