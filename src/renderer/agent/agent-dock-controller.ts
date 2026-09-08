import { isPrimaryModifier } from '../../shared/platform'

export function createAgentDockState(input: { viewportWidth: number; storedWidth: number | null }) {
  const clamp = (next: number, viewportWidth: number): number => Math.min(640, Math.floor(viewportWidth / 2), Math.max(300, next))
  let width = clamp(input.storedWidth ?? 360, input.viewportWidth)
  return {
    expanded: true,
    busy: false,
    get width(): number { return width },
    open(): void { this.expanded = true },
    collapse(input: { input: string; waitingApproval: boolean }): boolean {
      if (input.input.length > 0 || input.waitingApproval) return false
      this.expanded = false
      return true
    },
    setBusy(busy: boolean): void { this.busy = busy },
    resize(next: number, viewportWidth: number): number {
      width = clamp(next, viewportWidth)
      return width
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
  expandButton: HTMLButtonElement
  sendButton: HTMLButtonElement
  stopButton: HTMLButtonElement
  onSend(text: string): Promise<boolean>
  onStop(): void
  storage?: Storage
}): AgentDockController {
  let stored: number | null = null
  try { const value = input.storage?.getItem('agent-dock-width'); stored = value ? Number(value) : null } catch { stored = null }
  const state = createAgentDockState({ viewportWidth: window.innerWidth, storedWidth: Number.isFinite(stored) ? stored : null })
  let waiting = false
  let submitting = false
  const render = (): void => {
    document.body.classList.toggle('agent-dock-expanded', state.expanded)
    input.expanded.hidden = !state.expanded
    input.resize.hidden = !state.expanded
    input.stopButton.hidden = !state.busy
    input.sendButton.disabled = state.busy
    input.expandButton.hidden = state.expanded
    input.expandButton.setAttribute('aria-expanded', String(state.expanded))
    input.resize.setAttribute('aria-valuemin', '300')
    input.resize.setAttribute('aria-valuemax', String(Math.min(640, Math.floor(window.innerWidth / 2))))
    input.resize.setAttribute('aria-valuenow', String(state.width))
    document.documentElement.style.setProperty('--agent-dock-width', `${state.width}px`)
  }
  const open = (): void => { state.open(); render() }
  const collapse = (): boolean => {
    const collapsed = state.collapse({ input: input.textarea.value, waitingApproval: waiting })
    render()
    if (collapsed) input.expandButton.focus()
    return collapsed
  }
  const focusInput = (): void => { open(); input.textarea.focus() }
  const send = async (): Promise<void> => {
    const draft = input.textarea.value
    const text = draft.trim()
    if (!text || state.busy || submitting) return
    submitting = true
    open()
    try {
      const accepted = await input.onSend(text)
      if (accepted && input.textarea.value === draft) input.textarea.value = ''
    } finally { submitting = false }
  }
  const keydown = (event: KeyboardEvent): void => {
    if (event.isComposing || event.keyCode === 229) return
    if (event.key === 'Escape' && document.activeElement === input.textarea && collapse()) { event.preventDefault(); return }
    if (event.key === 'Enter' && !event.shiftKey && document.activeElement === input.textarea) { event.preventDefault(); if (!event.repeat) void send(); return }
    if (event.key.toLowerCase() === 'j' && isPrimaryModifier(event, document.documentElement.dataset.platform ?? 'darwin') && !event.shiftKey) { event.preventDefault(); state.expanded ? collapse() : focusInput() }
  }
  const applyWidth = (width: number): void => {
    render()
    try { input.storage?.setItem('agent-dock-width', String(width)) } catch { /* storage is best effort */ }
  }
  const resizeKeydown = (event: KeyboardEvent): void => {
    const delta = resizeKeyDelta(event.key)
    if (!delta) return
    event.preventDefault()
    applyWidth(state.resize(state.width + delta, window.innerWidth))
  }
  let resizing = false
  const pointerDown = (event: PointerEvent): void => { resizing = true; input.resize.setPointerCapture(event.pointerId) }
  const pointerMove = (event: PointerEvent): void => {
    if (!resizing) return
    applyWidth(state.resize(window.innerWidth - event.clientX, window.innerWidth))
  }
  const pointerUp = (): void => { resizing = false }
  const viewportResize = (): void => { state.resize(state.width, window.innerWidth); render() }
  const collapseClick = (): void => { collapse() }
  const sendClick = (): void => { void send() }
  const stopClick = (): void => input.onStop()
  document.addEventListener('keydown', keydown)
  window.addEventListener('resize', viewportResize)
  input.resize.addEventListener('keydown', resizeKeydown)
  input.resize.addEventListener('pointerdown', pointerDown)
  input.resize.addEventListener('pointermove', pointerMove)
  input.resize.addEventListener('pointerup', pointerUp)
  input.resize.addEventListener('lostpointercapture', pointerUp)
  input.expandButton.addEventListener('click', focusInput)
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
      window.removeEventListener('resize', viewportResize)
      input.resize.removeEventListener('keydown', resizeKeydown)
      input.resize.removeEventListener('pointerdown', pointerDown)
      input.resize.removeEventListener('pointermove', pointerMove)
      input.resize.removeEventListener('pointerup', pointerUp)
      input.resize.removeEventListener('lostpointercapture', pointerUp)
      input.expandButton.removeEventListener('click', focusInput)
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
  return key === 'ArrowLeft' ? 16 : key === 'ArrowRight' ? -16 : 0
}
