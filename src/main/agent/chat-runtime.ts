import type { NormalizedStopReason, ProviderRequest } from '../../shared/contracts/provider'
import type { ProviderAdapter } from '../providers/provider-adapter'
import { uuidv7 } from '../persistence/ids'
import type { TaskEvent } from '../../shared/contracts/agent'
import type { TaskHandle } from './runtime-registry'
import { AsyncEventQueue } from './async-event-queue'

export interface ChatInput {
  sessionId: string
  prompt: string
  currentDocument: string | null
  selection: string | null
  signal: AbortSignal
}

export class ChatRuntime {
  constructor(private readonly deps: {
    provider: ProviderAdapter
    messages: { create(record: unknown): void }
    now?: () => number
  }) {}

  start(input: Omit<ChatInput, 'signal'> & { taskId: string }): TaskHandle {
    const events = new AsyncEventQueue<TaskEvent>()
    const controller = new AbortController()
    let sequence = 0
    const emit = (event: { type: 'status'; status: 'running' | 'completed' | 'stopped' | 'failed' } | { type: 'assistant-text-delta'; text: string }): void => {
      events.push({ ...event, taskId: input.taskId, sequence: sequence++ })
    }
    emit({ type: 'status', status: 'running' })
    const done = this.run({ ...input, signal: controller.signal }, text => emit({ type: 'assistant-text-delta', text }))
      .then(() => {
        const status = controller.signal.aborted ? 'stopped' as const : 'completed' as const
        emit({ type: 'status', status })
        return { status, changeSet: null, errorCode: null }
      }, (error: unknown) => {
        const status = controller.signal.aborted ? 'stopped' as const : 'failed' as const
        const code = (error as { code?: unknown })?.code
        const errorCode = controller.signal.aborted ? 'CANCELLED'
          : typeof code === 'string' && /^[A-Z0-9_]{1,128}$/.test(code) ? code : 'PROVIDER_ERROR'
        events.push({ taskId: input.taskId, sequence: sequence++, type: 'error', code: errorCode, retryable: false })
        emit({ type: 'status', status })
        return { status, changeSet: null, errorCode }
      }).finally(() => events.close())
    return { events, done, stop: () => controller.abort(), respondToApproval: () => false }
  }

  async run(input: ChatInput, onText: (text: string) => void = () => {}): Promise<{ text: string; stopReason: NormalizedStopReason }> {
    const now = this.deps.now ?? Date.now
    const context = {
      instruction: 'This provider is chat-only. Give a suggestion; do not claim to modify files.',
      prompt: input.prompt,
      currentDocument: input.currentDocument,
      selection: input.selection,
    }
    const request: ProviderRequest = {
      system: 'You are DraftMD’s chat-only writing assistant. Discuss only the explicitly supplied text. You have no file tools and cannot modify files.',
      messages: [{ role: 'user', provider: null, content: [{ type: 'text', text: JSON.stringify(context) }], providerData: null }],
      tools: [], maxOutputTokens: 64_000,
    }
    this.deps.messages.create({
      id: uuidv7(now()), sessionId: input.sessionId, role: 'user',
      content: [{ type: 'text', text: input.prompt }], modelSwitch: null,
      createdAt: new Date(now()).toISOString(),
    })
    let text = ''
    let finalText = ''
    let providerData: unknown = null
    let stopReason: NormalizedStopReason = 'unknown'
    try {
      input.signal.throwIfAborted()
      for await (const event of this.deps.provider.stream(request, input.signal)) {
        input.signal.throwIfAborted()
        if (event.type === 'text-delta') { text += event.text; onText(event.text) }
        else if (event.type === 'completed') {
          finalText = event.assistantMessage.content.filter((block) => block.type === 'text').map((block) => block.text).join('')
          if (finalText.startsWith(text) && finalText.length > text.length) onText(finalText.slice(text.length))
          stopReason = event.stopReason
          providerData = event.assistantMessage.providerData
        }
      }
    } finally {
      if (finalText || text) {
        this.deps.messages.create({
          id: uuidv7(now()), sessionId: input.sessionId, role: 'assistant',
          content: [{ type: 'text', text: finalText || text }], modelSwitch: providerData,
          createdAt: new Date(now()).toISOString(),
        })
      }
    }
    return { text: finalText || text, stopReason }
  }
}
