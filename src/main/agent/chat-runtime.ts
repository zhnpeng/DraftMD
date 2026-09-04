import type { NormalizedStopReason, ProviderRequest } from '../../shared/contracts/provider'
import type { ProviderAdapter } from '../providers/provider-adapter'
import { uuidv7 } from '../persistence/ids'

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

  async run(input: ChatInput): Promise<{ text: string; stopReason: NormalizedStopReason }> {
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
    let stopReason: NormalizedStopReason = 'unknown'
    for await (const event of this.deps.provider.stream(request, input.signal)) {
      if (event.type === 'text-delta') text += event.text
      else if (event.type === 'completed') {
        finalText = event.assistantMessage.content.filter((block) => block.type === 'text').map((block) => block.text).join('')
        stopReason = event.stopReason
        this.deps.messages.create({
          id: uuidv7(now()), sessionId: input.sessionId, role: 'assistant',
          content: [{ type: 'text', text: finalText || text }], modelSwitch: event.assistantMessage.providerData,
          createdAt: new Date(now()).toISOString(),
        })
      }
    }
    return { text: finalText || text, stopReason }
  }
}
