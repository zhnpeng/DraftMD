import { msg } from '../../shared/i18n'
export function shouldAutoScroll(input: { scrollHeight: number; scrollTop: number; clientHeight: number }): boolean {
  return input.scrollHeight - input.scrollTop - input.clientHeight <= 48
}

export function createDeltaBatcher(input: {
  render(text: string): void
  requestFrame(callback: FrameRequestCallback): number
  cancelFrame(id: number): void
}) {
  let pending = ''
  let frame: number | null = null
  let disposed = false
  const render = (): void => {
    frame = null
    if (disposed || !pending) return
    const next = pending
    pending = ''
    input.render(next)
  }
  return {
    push(text: string): void {
      if (disposed || !text) return
      pending += text
      if (frame === null) frame = input.requestFrame(render)
    },
    flush(): void {
      if (disposed) return
      if (frame !== null) { input.cancelFrame(frame); frame = null }
      render()
    },
    dispose(): void {
      if (frame !== null) input.cancelFrame(frame)
      frame = null
      pending = ''
      disposed = true
    },
  }
}

export function renderMessage(container: HTMLElement, role: 'user' | 'assistant', text: string): HTMLElement {
  const message = document.createElement('article')
  message.className = `agent-message ${role}`
  message.textContent = text
  container.appendChild(message)
  return message
}

export function modelSwitchText(providerConfigId: string, providers: Array<{ id: string; name: string }>): string {
  const provider = providers.find((candidate) => candidate.id === providerConfigId)
  return provider ? msg('dock.switchedModel', { name: provider.name }) : msg('dock.removedModel')
}

export function renderSystemMessage(container: HTMLElement, text: string): HTMLElement {
  const message = document.createElement('div')
  message.className = 'agent-message system'
  message.textContent = text
  container.appendChild(message)
  return message
}
