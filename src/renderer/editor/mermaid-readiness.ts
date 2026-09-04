type RenderToken = { owner: symbol; generation: number }

const pendingRenders = new Set<RenderToken>()
const settledListeners = new Set<() => void>()
let currentGeneration = 0

function notifySettled(): void {
  for (const listener of settledListeners) listener()
}

export function setMermaidGeneration(generation: number): void {
  currentGeneration = generation
}

export function beginMermaidRender(owner = Symbol('mermaid-view'), generation = currentGeneration): () => void {
  const token = { owner, generation }
  pendingRenders.add(token)
  let settled = false
  return () => {
    if (settled) return
    settled = true
    pendingRenders.delete(token)
    notifySettled()
  }
}

export function cancelMermaidRenders(owner: symbol): void {
  let changed = false
  for (const token of pendingRenders) {
    if (token.owner !== owner) continue
    pendingRenders.delete(token)
    changed = true
  }
  if (changed) notifySettled()
}

function cancelTokens(tokens: ReadonlySet<RenderToken>): void {
  let changed = false
  for (const token of tokens) {
    if (!pendingRenders.delete(token)) continue
    changed = true
  }
  if (changed) notifySettled()
}

function generationTokens(generation: number): Set<RenderToken> {
  return new Set(Array.from(pendingRenders).filter((token) => token.generation === generation))
}

function hasPending(generation: number): boolean {
  for (const token of pendingRenders) {
    if (token.generation === generation) return true
  }
  return false
}

export function waitForMermaidReady(input: {
  generation?: number
  isCurrent(): boolean
  timeoutMs?: number
}): Promise<boolean> {
  const generation = input.generation ?? 0
  if (!input.isCurrent()) return Promise.resolve(false)
  const capturedTokens = generationTokens(generation)
  if (capturedTokens.size === 0) return Promise.resolve(true)
  const timeoutMs = input.timeoutMs ?? 16_000
  return new Promise((resolve) => {
    let done = false
    const settle = (ready: boolean): void => {
      if (done) return
      done = true
      clearTimeout(timeout)
      clearInterval(cancellationCheck)
      settledListeners.delete(check)
      resolve(ready)
    }
    const check = (): void => {
      if (!input.isCurrent()) settle(false)
      else if (!hasPending(generation)) settle(true)
    }
    const timeout = setTimeout(() => {
      cancelTokens(capturedTokens)
      settle(input.isCurrent())
    }, timeoutMs)
    const cancellationCheck = setInterval(check, 25)
    settledListeners.add(check)
    check()
  })
}
