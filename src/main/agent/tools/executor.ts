import type { JsonValue } from '../../../shared/contracts/provider'
import type { WorkspaceService } from '../../workspace/workspace-service'
import type { ApprovalBroker } from '../approval-broker'
import type { ParsedToolCall } from './schemas'

const MAX_WHOLE_FILE_BYTES = 5 * 1024 * 1024

export type ToolExecutionResult =
  | { ok: true; value: JsonValue }
  | { ok: false; code: string; summary: string }

export interface ToolExecutionContext {
  taskId: string
  signal: AbortSignal
}

function safeErrorCode(error: unknown): string {
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' && /^[A-Z0-9_]+$/.test(code) ? code : 'TOOL_ERROR'
}

function sectionByHeading(content: string, heading: string): string | null {
  const lines = content.split('\n')
  const wanted = heading.trim().toLocaleLowerCase()
  let start = -1
  let level = 0
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/.exec(lines[index])
    if (match?.[2].trim().toLocaleLowerCase() === wanted) { start = index; level = match[1].length; break }
  }
  if (start < 0) return null
  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    const match = /^(#{1,6})\s+/.exec(lines[index])
    if (match && match[1].length <= level) { end = index; break }
  }
  return lines.slice(start, end).join('\n')
}

export function createToolExecutor(input: { workspace: WorkspaceService; approval: ApprovalBroker }) {
  const execute = async (call: ParsedToolCall, context: ToolExecutionContext): Promise<ToolExecutionResult> => {
    try {
      if (context.signal.aborted) return { ok: false, code: 'CANCELLED', summary: `${call.name} cancelled.` }
      switch (call.name) {
        case 'list_markdown_files':
          return { ok: true, value: { files: await input.workspace.list(context.signal) } }
        case 'search_markdown':
          return { ok: true, value: { matches: await input.workspace.search(call.input.query, call.input.limit, context.signal) } }
        case 'read_markdown': {
          const read = await input.workspace.read(call.input.path)
          if (!call.input.heading && !call.input.startLine && Buffer.byteLength(read.content) > MAX_WHOLE_FILE_BYTES) {
            return { ok: false, code: 'CONTENT_TOO_LARGE', summary: `File is ${Buffer.byteLength(read.content)} bytes; request a heading or line range.` }
          }
          let content = read.content
          if (call.input.heading) {
            const section = sectionByHeading(content, call.input.heading)
            if (section === null) return { ok: false, code: 'HEADING_NOT_FOUND', summary: `Heading not found: ${call.input.heading}` }
            content = section
          }
          if (call.input.startLine) {
            const lines = content.split(/\r?\n/)
            content = lines.slice(call.input.startLine - 1, call.input.endLine ?? call.input.startLine).join('\n')
          }
          return { ok: true, value: { path: read.path, content, version: read.version } }
        }
        case 'create_markdown':
          return { ok: true, value: await input.workspace.create(call.input.path, call.input.content) }
        case 'edit_markdown':
          return { ok: true, value: await input.workspace.edit(call.input.path, {
            oldText: call.input.oldText, newText: call.input.newText, expectedOccurrences: 1,
          }, call.input.expectedVersion) }
        case 'rename_markdown':
          return { ok: true, value: await input.workspace.rename(call.input.from, call.input.to, call.input.expectedVersion) }
        case 'delete_markdown': {
          let stale = true
          try { stale = (await input.workspace.read(call.input.path)).version !== call.input.expectedVersion } catch { stale = true }
          const decision = await input.approval.request({ taskId: context.taskId, ...call.input, stale })
          if (decision.decision === 'deny') return { ok: false, code: 'USER_DENIED', summary: 'User denied deletion.' }
          if (decision.decision === 'cancel') return { ok: false, code: 'USER_CANCELLED', summary: 'Deletion approval was cancelled.' }
          const current = await input.workspace.read(call.input.path)
          if (current.version !== call.input.expectedVersion) return { ok: false, code: 'VERSION_CONFLICT', summary: 'delete_markdown failed: VERSION_CONFLICT' }
          return { ok: true, value: await input.workspace.delete(call.input.path, call.input.expectedVersion) }
        }
      }
    } catch (error) {
      const code = safeErrorCode(error)
      return { ok: false, code, summary: `${call.name} failed: ${code}` }
    }
  }
  return { execute }
}
