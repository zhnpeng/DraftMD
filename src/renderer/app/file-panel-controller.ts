import type { DraftMDAPI, SiblingFile } from '../../shared/contracts'
import { msg } from '../../shared/i18n'
import type { SourceModeController } from './source-mode-controller'

interface OutlineItem { level: number; title: string; element?: HTMLElement; line?: number }

export interface WorkspaceNavigation {
  directory(): string
  refresh(): Promise<SiblingFile[] | null>
  open(entry: SiblingFile): Promise<boolean>
  workspaceOpened(): Promise<SiblingFile[] | null>
}

export function createWorkspaceNavigation(input: {
  listWorkspaceFiles(directory: string): Promise<SiblingFile[] | null>
  openWorkspaceFile?(path: string): Promise<boolean>
  beforeOpenFile?(): Promise<boolean>
}): WorkspaceNavigation {
  let directory = ''
  const refresh = (): Promise<SiblingFile[] | null> => input.listWorkspaceFiles(directory)
  return {
    directory: () => directory,
    refresh,
    async open(entry) {
      if (entry.kind === 'directory' || entry.kind === 'parent') {
        directory = entry.path
        await refresh()
        return true
      }
      if (input.beforeOpenFile && !await input.beforeOpenFile()) return false
      return input.openWorkspaceFile ? input.openWorkspaceFile(entry.path) : false
    },
    workspaceOpened() {
      directory = ''
      return refresh()
    },
  }
}


export interface FilePanelController {
  refresh(): Promise<void>
  workspaceOpened(): Promise<void>
  render(files: SiblingFile[]): void
  toggle(): void
  scheduleOutlineUpdate(): void
  updateVisibility(): void
  dispose(): void
}

export function createFilePanelController(input: {
  api: DraftMDAPI
  source: SourceModeController
  editorElement: HTMLElement
  sourceElement: HTMLTextAreaElement
  panelElement: HTMLElement
  fileListElement: HTMLElement
  outlineListElement: HTMLElement
  filesTab: HTMLButtonElement
  outlineTab: HTMLButtonElement
  toggleButton: HTMLButtonElement
  currentPath(): string | null
  beforeOpenFile(): Promise<boolean>
}): FilePanelController {
  let manualHidden = localStorage.getItem('file-panel-hidden') !== '0'
  let panelMode: 'files' | 'outline' = 'files'
  let outlineQueued = false
  let workspaceFiles: SiblingFile[] | null = null

  const sourceOutline = (content: string): OutlineItem[] => content.split(/\r?\n/).flatMap((line, index) => {
    const match = /^(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/.exec(line)
    if (!match) return []
    const title = match[2].replace(/!?(?:\[([^\]]*)\])\([^)]*\)/g, '$1').replace(/[*_`]/g, '').trim()
    return title ? [{ level: match[1].length, title, line: index }] : []
  })
  const visualOutline = (): OutlineItem[] => Array.from(input.editorElement.querySelectorAll<HTMLElement>('.ProseMirror h1, .ProseMirror h2, .ProseMirror h3, .ProseMirror h4, .ProseMirror h5, .ProseMirror h6'))
    .map((element) => ({ level: Number(element.tagName.slice(1)), title: element.textContent?.trim() ?? '', element }))
    .filter((item) => item.title)
  const renderOutline = (): void => {
    if (input.source.isReducedRendering()) { input.outlineListElement.replaceChildren(); return }
    const items = input.source.isSourceMode() ? sourceOutline(input.sourceElement.value) : visualOutline()
    input.outlineListElement.innerHTML = ''
    for (const item of items) {
      const entry = document.createElement('li')
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = item.title
      button.style.paddingLeft = `${8 + (item.level - 1) * 12}px`
      button.addEventListener('click', () => {
        if (item.element) item.element.scrollIntoView({ behavior: 'smooth', block: 'start' })
        else if (item.line !== undefined) {
          const lineHeight = Number.parseFloat(getComputedStyle(input.sourceElement).lineHeight) || 24
          input.sourceElement.scrollTop = Math.max(0, item.line * lineHeight - lineHeight)
          input.sourceElement.focus()
        }
      })
      entry.appendChild(button)
      input.outlineListElement.appendChild(entry)
    }
  }
  const updateVisibility = (): void => {
    const show = !manualHidden
    input.panelElement.hidden = !show
    document.body.classList.toggle('show-file-panel', show)
    input.toggleButton.classList.toggle('active', show)
    input.fileListElement.hidden = panelMode !== 'files'
    input.outlineListElement.hidden = panelMode !== 'outline'
    input.filesTab.classList.toggle('active', panelMode === 'files')
    input.filesTab.setAttribute('aria-selected', String(panelMode === 'files'))
    input.outlineTab.classList.toggle('active', panelMode === 'outline')
    input.outlineTab.setAttribute('aria-selected', String(panelMode === 'outline'))
  }
  const setMode = (mode: 'files' | 'outline'): void => { if (mode === 'outline' && input.source.isReducedRendering()) return; panelMode = mode; updateVisibility(); if (mode === 'outline') renderOutline() }
  const toggle = (): void => {
    manualHidden = !manualHidden
    localStorage.setItem('file-panel-hidden', manualHidden ? '1' : '0')
    updateVisibility()
  }
  const render = (files: SiblingFile[]): void => {
    input.fileListElement.innerHTML = ''
    for (const file of files) {
      const entry = document.createElement('li')
      const button = document.createElement('button')
      const icon = document.createElement('span')
      icon.className = `file-entry-icon ${file.kind}`
      icon.setAttribute('aria-hidden', 'true')
      icon.innerHTML = file.kind === 'parent'
        ? '<svg viewBox="0 0 16 16"><path d="M13 8H3.5M7 4 3 8l4 4"/></svg>'
        : file.kind === 'directory'
          ? '<svg viewBox="0 0 16 16"><path d="M2.5 4.5h4l1.5 1.5h6v6.5h-11.5z"/><path d="M2.5 4.5v-1h4l1.5 1.5"/></svg>'
          : '<svg viewBox="0 0 16 16"><path d="M4 2.5h5l3 3v8H4z"/><path d="M9 2.5v3h3"/></svg>'
      const label = document.createElement('span')
      label.className = 'file-entry-name'
      label.textContent = file.kind === 'parent' ? '..' : file.name
      button.addEventListener('mouseenter', () => {
        const overflow = label.scrollWidth - label.clientWidth
        if (overflow <= 0) return
        label.style.setProperty('--file-entry-scroll', `${overflow}px`)
        label.style.setProperty('--file-entry-scroll-duration', `${Math.min(6, Math.max(2.4, overflow / 20))}s`)
        label.classList.add('scrolling')
      })
      button.addEventListener('mouseleave', () => {
        label.classList.remove('scrolling')
        label.style.removeProperty('--file-entry-scroll')
        label.style.removeProperty('--file-entry-scroll-duration')
      })
      button.title = file.kind === 'directory' ? msg('files.openDirectory', { name: file.name }) : file.kind === 'parent' ? msg('files.parentDirectory') : file.name
      button.dataset.path = file.path
      button.dataset.kind = file.kind
      button.classList.toggle('directory', file.kind === 'directory')
      button.classList.toggle('parent', file.kind === 'parent')
      button.classList.toggle('active', file.path === input.currentPath())
      button.append(icon, label)
      entry.appendChild(button)
      input.fileListElement.appendChild(entry)
    }
  }
  const navigation = createWorkspaceNavigation({
    listWorkspaceFiles: (directory) => input.api.listWorkspaceFiles(directory),
    openWorkspaceFile: (path) => input.api.openWorkspaceFile(path),
    beforeOpenFile: input.beforeOpenFile,
  })
  let refreshGeneration = 0
  const refresh = async (reset = false): Promise<void> => {
    const generation = ++refreshGeneration
    const files = await (reset ? navigation.workspaceOpened() : navigation.refresh())
    if (generation !== refreshGeneration) return
    workspaceFiles = files
    if (files) render(files)
  }
  const scheduleOutlineUpdate = (): void => {
    if (outlineQueued) return
    outlineQueued = true
    requestAnimationFrame(() => { outlineQueued = false; renderOutline() })
  }
  const handleFileClick = async (event: Event): Promise<void> => {
    const button = (event.target as HTMLElement).closest('button[data-path]') as HTMLButtonElement | null
    if (button?.dataset.path === undefined) return
    const entry: SiblingFile = {
      name: button.textContent?.trim() ?? '',
      path: button.dataset.path,
      kind: button.dataset.kind as SiblingFile['kind'],
    }
    if (entry.kind === 'file' && button.dataset.path === input.currentPath()) return
    if (await navigation.open(entry)) {
      const files = await navigation.refresh()
      workspaceFiles = files
      if (files) render(files)
    }
  }
  const onToggle = (): void => toggle()
  const onFiles = (): void => setMode('files')
  const onOutline = (): void => setMode('outline')
  input.fileListElement.addEventListener('click', handleFileClick)
  input.toggleButton.addEventListener('click', onToggle)
  input.filesTab.addEventListener('click', onFiles)
  input.outlineTab.addEventListener('click', onOutline)
  updateVisibility()

  return {
    refresh,
    workspaceOpened() {
      manualHidden = false
      localStorage.setItem('file-panel-hidden', '0')
      setMode('files')
      return refresh(true)
    },
    render, toggle, scheduleOutlineUpdate, updateVisibility,
    dispose() {
      input.fileListElement.removeEventListener('click', handleFileClick)
      input.toggleButton.removeEventListener('click', onToggle)
      input.filesTab.removeEventListener('click', onFiles)
      input.outlineTab.removeEventListener('click', onOutline)
    },
  }
}
