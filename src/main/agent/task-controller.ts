import type { ProviderCapability } from '../../shared/contracts/provider'
import type { AgentTaskInput } from './agent-runtime'
import type { ChatInput } from './chat-runtime'

export class TaskControllerError extends Error {
  constructor(readonly code: 'PROVIDER_UNAVAILABLE') {
    super(code)
    this.name = 'TaskControllerError'
  }
}

export function createTaskController(input: {
  chat: { run(chat: ChatInput): Promise<unknown> }
  agent: { start(agent: AgentTaskInput): unknown }
}) {
  return {
    start(request: { capability: ProviderCapability; chat: ChatInput; agent: AgentTaskInput }) {
      if (request.capability === 'unavailable') throw new TaskControllerError('PROVIDER_UNAVAILABLE')
      if (request.capability === 'agent') return { mode: 'agent' as const, handle: input.agent.start(request.agent) }
      return input.chat.run(request.chat).then((result) => ({ mode: 'suggestion' as const, result }))
    },
  }
}
