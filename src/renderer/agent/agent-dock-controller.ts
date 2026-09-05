export function createAgentDockState(input: { viewportHeight: number; storedHeight: number | null }) {
  const maxHeight = Math.floor(input.viewportHeight * 0.65)
  let height = Math.min(maxHeight, Math.max(180, input.storedHeight ?? 320))
  return {
    expanded: false,
    busy: false,
    get height(): number { return height },
    open(): void { this.expanded = true },
    collapse(input: { input: string; waitingApproval: boolean }): boolean {
      if (input.input.length > 0 || input.waitingApproval) return false
      this.expanded = false
      return true
    },
    setBusy(busy: boolean): void { this.busy = busy },
    resize(next: number, viewportHeight: number): number {
      height = Math.min(Math.floor(viewportHeight * 0.65), Math.max(180, next))
      return height
    },
  }
}

export interface AgentDockController {
  open(): void
  collapse(): boolean
  toggle(): void
  focusInput(): void
  setBusy(busy: boolean): void
  waitingApproval(waiting: boolean): void
  dispose(): void
}

export function createAgentDockController(input: {
  root: HTMLElement
  expanded: HTMLElement
  resize: HTMLElement
  textarea: HTMLTextAreaElement
  collapseButton: HTMLButtonElement
  sendButton: HTMLButtonElement
  stopButton: HTMLButtonElement
  onSend(text: string): void
  onStop(): void
  storage?: Storage
}): AgentDockController {
  let stored: number | null = null
  try { const value = input.storage?.getItem('agent-dock-height'); stored = value ? Number(value) : null } catch { stored = null }
  const state = createAgentDockState({ viewportHeight: window.innerHeight, storedHeight: Number.isFinite(stored) ? stored : null })
  let waiting = false
  const render = (): void => {
    document.body.classList.toggle('agent-dock-expanded', state.expanded)
    input.expanded.hidden = !state.expanded
    input.resize.hidden = !state.expanded
    input.stopButton.hidden = !state.busy
    input.sendButton.disabled = state.busy
    document.documentElement.style.setProperty('--agent-dock-height', `${state.height}px`)
  }
  const open = (): void => { state.open(); render() }
  const collapse = (): boolean => { const collapsed = state.collapse({ input: input.textarea.value, waitingApproval: waiting }); render(); return collapsed }
  const focusInput = (): void => { open(); input.textarea.focus() }
  const send = (): void => { const text = input.textarea.value.trim(); if (!text || state.busy) return; input.onSend(text); input.textarea.value = ''; open() }
  const keydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && document.activeElement === input.textarea && collapse()) { event.preventDefault(); return }
    if (event.key === 'Enter' && event.metaKey && document.activeElement === input.textarea) { event.preventDefault(); send(); return }
    if (event.key.toLowerCase() === 'j' && event.metaKey && !event.shiftKey) { event.preventDefault(); state.expanded ? collapse() : focusInput() }
  }
  const applyHeight = (height: number): void => {
    document.documentElement.style.setProperty('--agent-dock-height', `${height}px`)
    try { input.storage?.setItem('agent-dock-height', String(height)) } catch { /* storage is best effort */ }
  }
  const resizeKeydown = (event: KeyboardEvent): void => {
    const delta = resizeKeyDelta(event.key)
    if (!delta) return
    event.preventDefault()
    applyHeight(state.resize(state.height + delta, window.innerHeight))
  }
  let resizing = false
  const pointerDown = (event: PointerEvent): void => { resizing = true; input.resize.setPointerCapture(event.pointerId) }
  const pointerMove = (event: PointerEvent): void => {
    if (!resizing) return
    applyHeight(state.resize(window.innerHeight - event.clientY, window.innerHeight))
  }
  const pointerUp = (): void => { resizing = false }
  const collapseClick = (): void => { collapse() }
  const sendClick = (): void => send()
  const stopClick = (): void => input.onStop()
  document.addEventListener('keydown', keydown)
  input.resize.addEventListener('keydown', resizeKeydown)
  input.resize.addEventListener('pointerdown', pointerDown)
  input.resize.addEventListener('pointermove', pointerMove)
  input.resize.addEventListener('pointerup', pointerUp)
  input.collapseButton.addEventListener('click', collapseClick)
  input.sendButton.addEventListener('click', sendClick)
  input.stopButton.addEventListener('click', stopClick)
  render()
  return {
    open, collapse, focusInput,
    toggle() { state.expanded ? collapse() : focusInput() },
    setBusy(busy) { state.setBusy(busy); render() },
    waitingApproval(value) { waiting = value; if (value) open() },
    dispose() {
      document.removeEventListener('keydown', keydown)
      input.resize.removeEventListener('keydown', resizeKeydown)
      input.resize.removeEventListener('pointerdown', pointerDown)
      input.resize.removeEventListener('pointermove', pointerMove)
      input.resize.removeEventListener('pointerup', pointerUp)
      input.collapseButton.removeEventListener('click', collapseClick)
      input.sendButton.removeEventListener('click', sendClick)
      input.stopButton.removeEventListener('click', stopClick)
    },
  }
}

export function createPendingStop() {
  let pending = false
  return {
    request(taskId: string | null): string | null {
      if (taskId) return taskId
      pending = true
      return null
    },
    attach(taskId: string): string | null {
      if (!pending) return null
      pending = false
      return taskId
    },
    clear(): void { pending = false },
  }
}

export function resizeKeyDelta(key: string): number {
  return key === 'ArrowUp' ? 16 : key === 'ArrowDown' ? -16 : 0
}
