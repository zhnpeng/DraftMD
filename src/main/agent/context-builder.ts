import type { ProviderMessage, ProviderRequest, ProviderTool } from '../../shared/contracts/provider'
import type { SelectionReference } from './selection-reference'
import { SYSTEM_POLICY } from './system-prompt'

export class ContextLimitError extends Error {
  readonly code = 'CONTEXT_LIMIT'
  constructor(readonly bytes: number, readonly limit: number) {
    super('CONTEXT_LIMIT')
    this.name = 'ContextLimitError'
  }
}

export interface ContextBuilderInput {
  task: { text: string; selection: SelectionReference | null }
  session: { history: ProviderMessage[] }
  workspace: {
    id: string
    files: Array<{ path: string; size: number; mtimeMs: number }>
    current: { path: string; version: string; headingPath: string[] } | null
  }
  tools: ProviderTool[]
  maxHistoryBytes?: number
}

export function buildProviderRequest(input: ContextBuilderInput): ProviderRequest {
  const maxHistoryBytes = input.maxHistoryBytes ?? 512 * 1024
  const historyBytes = Buffer.byteLength(JSON.stringify(input.session.history), 'utf8')
  if (historyBytes > maxHistoryBytes) throw new ContextLimitError(historyBytes, maxHistoryBytes)
  const files = [...input.workspace.files].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
  const context = {
    workspaceId: input.workspace.id,
    files,
    currentDocument: input.workspace.current ? {
      ...input.workspace.current,
      headingPath: input.workspace.current.headingPath.join(' / '),
    } : null,
    selection: input.task.selection,
    task: input.task.text,
  }
  return {
    system: SYSTEM_POLICY,
    messages: [
      ...input.session.history,
      { role: 'user', provider: null, content: [{ type: 'text', text: JSON.stringify(context) }], providerData: null },
    ],
    tools: input.tools,
    maxOutputTokens: 64_000,
  }
}
