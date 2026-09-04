import { realpath } from 'node:fs/promises'
import { isAbsolute, relative, sep } from 'node:path'
import type { WorkspaceRoot } from '../workspace/path-guard'
import type { WorkspaceService } from '../workspace/workspace-service'
import { SelectionReferenceSchema, type SelectionReference } from '../../shared/contracts/agent'

export { SelectionReferenceSchema, type SelectionReference }

export class SelectionReferenceError extends Error {
  constructor(readonly code: 'SELECTION_STALE' | 'SELECTION_AMBIGUOUS' | 'SELECTION_NOT_FOUND') {
    super(code)
    this.name = 'SelectionReferenceError'
  }
}

export function validateSelectionReference(reference: SelectionReference, current: {
  workspaceId: string
  version: string
  content: string
}): { start: number; end: number } {
  if (current.workspaceId !== reference.workspaceId || current.version !== reference.version) {
    throw new SelectionReferenceError('SELECTION_STALE')
  }
  const needle = `${reference.beforeAnchor}${reference.selectedText}${reference.afterAnchor}`
  const first = current.content.indexOf(needle)
  if (first < 0) throw new SelectionReferenceError('SELECTION_NOT_FOUND')
  if (current.content.indexOf(needle, first + 1) >= 0) throw new SelectionReferenceError('SELECTION_AMBIGUOUS')
  const start = first + reference.beforeAnchor.length
  return { start, end: start + reference.selectedText.length }
}


export async function normalizeSelectionReference(reference: SelectionReference, input: {
  workspaceId: string
  root: WorkspaceRoot
  workspace: Pick<WorkspaceService, 'read'>
}): Promise<SelectionReference> {
  if (reference.workspaceId !== input.workspaceId) {
    throw new SelectionReferenceError('SELECTION_STALE')
  }
  let path = reference.path
  if (isAbsolute(path)) {
    let canonicalPath: string
    try {
      canonicalPath = await realpath(path)
    } catch {
      throw new SelectionReferenceError('SELECTION_NOT_FOUND')
    }
    const candidate = relative(input.root.canonicalPath, canonicalPath)
    if (!candidate || candidate === '..' || candidate.startsWith(`..${sep}`) || isAbsolute(candidate)) {
      throw new SelectionReferenceError('SELECTION_NOT_FOUND')
    }
    path = candidate.split(sep).join('/')
  }
  let current: Awaited<ReturnType<WorkspaceService['read']>>
  try {
    current = await input.workspace.read(path)
  } catch {
    throw new SelectionReferenceError('SELECTION_NOT_FOUND')
  }
  validateSelectionReference(reference, {
    workspaceId: input.workspaceId,
    version: current.version,
    content: current.content,
  })
  return { ...reference, path: current.path }
}
