import type { DraftMDAPI } from '../../shared/contracts/ipc'
import type { SelectionReference } from '../../shared/contracts/agent'

export interface AgentInputContext {
  workspaceId: string
  providerConfigId: string
  sessionId?: string
  currentPath: string | null
  currentContent: string | null
  selection: SelectionReference | null
}

export async function sendAgentInput(api: DraftMDAPI, prompt: string, context: AgentInputContext) {
  return api.startAgentTask({ ...context, prompt })
}
