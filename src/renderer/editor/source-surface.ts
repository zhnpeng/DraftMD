export interface SourceSelection { anchor: number; head: number }

export interface SourceSurface {
  content(): string
  selection(): SourceSelection
  select(anchor: number, head: number): void
  replaceSelection(text: string): void
  focus(): void
}

export interface LargeSourceSurface extends SourceSurface {
  setContent(content: string, preservePosition: boolean): void
  destroy(): void
}

let active: SourceSurface | null = null
export function setActiveSourceSurface(surface: SourceSurface | null): void { active = surface }
export function getActiveSourceSurface(): SourceSurface | null { return active }
