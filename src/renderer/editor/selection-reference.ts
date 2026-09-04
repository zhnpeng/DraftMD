import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model'
import type { SelectionReference } from '../../shared/contracts/agent'

export class SelectionCaptureError extends Error {
  constructor(readonly code: 'SELECTION_TOO_LARGE') {
    super(code)
    this.name = 'SelectionCaptureError'
  }
}

export function headingPathAtOffset(content: string, offset: number): string[] {
  const headings: string[] = []
  const lineEnd = content.indexOf('\n', Math.max(0, offset))
  const prefix = content.slice(0, lineEnd < 0 ? content.length : lineEnd)
  for (const line of prefix.split(/\r?\n/)) {
    const match = /^(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/.exec(line)
    if (!match) continue
    const depth = match[1].length
    headings.length = depth - 1
    headings[depth - 1] = match[2]
  }
  return headings.filter((heading): heading is string => heading !== undefined)
}

export function captureSourceSelection(input: {
  workspaceId: string
  path: string
  version: string
  content: string
  start: number
  end: number
}): SelectionReference | null {
  const start = Math.min(input.start, input.end)
  const end = Math.max(input.start, input.end)
  if (start === end) return null
  const selectedText = input.content.slice(start, end)
  if (new TextEncoder().encode(selectedText).byteLength > 20 * 1024) throw new SelectionCaptureError('SELECTION_TOO_LARGE')
  return {
    workspaceId: input.workspaceId, path: input.path, version: input.version,
    headingPath: headingPathAtOffset(input.content, start), selectedText,
    beforeAnchor: input.content.slice(Math.max(0, start - 200), start),
    afterAnchor: input.content.slice(end, end + 200), sourceMode: true,
  }
}


export function captureVisualEditorSelection(input: {
  doc: ProseMirrorNode
  from: number
  to: number
  serialize(doc: ProseMirrorNode): string
}): { selectedText: string; headingPath: string[] } | null {
  if (input.from === input.to) return null
  const from = Math.min(input.from, input.to)
  const to = Math.max(input.from, input.to)
  const headingPath: string[] = []
  input.doc.descendants((node, position) => {
    if (position >= from) return false
    if (node.type.name !== 'heading') return true
    const level = Number(node.attrs.level)
    if (!Number.isInteger(level) || level < 1 || level > 6) return false
    headingPath.length = level - 1
    headingPath[level - 1] = node.textContent.trim()
    return false
  })
  const slice = input.doc.slice(from, to)
  const selectedDoc = input.doc.type.create(null, slice.content)
  const selectedText = input.serialize(selectedDoc).replace(/\n+$/, '')
  if (!selectedText) return null
  return {
    selectedText,
    headingPath: headingPath.filter((heading): heading is string => heading !== undefined && heading.length > 0),
  }
}

export function captureVisualSelection(input: {
  workspaceId: string
  path: string
  version: string
  markdown: string
  selectedText: string
  headingPath: string[]
}): SelectionReference | null {
  if (!input.selectedText) return null
  if (new TextEncoder().encode(input.selectedText).byteLength > 20 * 1024) throw new SelectionCaptureError('SELECTION_TOO_LARGE')
  const occurrences: number[] = []
  let offset = 0
  while (true) {
    const found = input.markdown.indexOf(input.selectedText, offset)
    if (found < 0) break
    occurrences.push(found); offset = found + input.selectedText.length
  }
  const scoped = occurrences.filter((position) => {
    const path = headingPathAtOffset(input.markdown, position)
    return path.length === input.headingPath.length
      && path.every((heading, index) => heading === input.headingPath[index])
  })
  if (scoped.length !== 1) return null
  const start = scoped[0]
  return {
    workspaceId: input.workspaceId, path: input.path, version: input.version,
    headingPath: input.headingPath, selectedText: input.selectedText,
    beforeAnchor: input.markdown.slice(Math.max(0, start - 200), start),
    afterAnchor: input.markdown.slice(start + input.selectedText.length, start + input.selectedText.length + 200),
    sourceMode: false,
  }
}

export function mapTextRange(
  before: string,
  after: string,
  start: number,
  end: number,
): { start: number; end: number } {
  const from = Math.max(0, Math.min(before.length, Math.min(start, end)))
  const to = Math.max(from, Math.min(before.length, Math.max(start, end)))
  const selected = before.slice(from, to)
  const beforeAnchor = before.slice(Math.max(0, from - 32), from)
  const afterAnchor = before.slice(to, to + 32)
  const needle = `${beforeAnchor}${selected}${afterAnchor}`
  if (needle) {
    const first = after.indexOf(needle)
    if (first >= 0 && after.indexOf(needle, first + 1) < 0) {
      const mappedStart = first + beforeAnchor.length
      return { start: mappedStart, end: mappedStart + selected.length }
    }
  }
  const fallback = Math.min(after.length, from)
  return { start: fallback, end: Math.min(after.length, fallback + selected.length) }
}
