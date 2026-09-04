import type { ChangeSet } from '../../shared/contracts/changes'
import type { TaskEvent, TaskStatus } from '../../shared/contracts/agent'
import type { ProviderAdapter } from '../providers/provider-adapter'
import type { ProviderMessage, ProviderRequest, ToolCall } from '../../shared/contracts/provider'
import type { ChangeSetService } from '../changes/change-set-service'
import type { SnapshotWorkspace } from '../changes/snapshot-store'
import { uuidv7 } from '../persistence/ids'
import { transitionTask } from './task-state-machine'
import { DEFAULT_EXECUTION_LIMITS, toolCallFingerprint, type ExecutionLimits } from './execution-limits'
import { parseToolCall, ToolCallValidationError, type ParsedToolCall } from './tools/schemas'
import type { ToolExecutionContext, ToolExecutionResult } from './tools/executor'
import { scheduleToolCalls } from './tool-scheduler'
import type { ApprovalBroker } from './approval-broker'

interface TaskStore {
  create(record: { id: string; sessionId: string; status: TaskStatus; createdAt: string; updatedAt: string }): void
  transition(id: string, from: TaskStatus, to: TaskStatus, updatedAt: string): boolean
}
interface MessageStore { create(record: unknown): void }
interface ActivityStore { create(record: unknown): void }

export interface AgentRuntimeDependencies {
  provider: ProviderAdapter
  executor: { execute(call: ParsedToolCall, context: ToolExecutionContext): Promise<ToolExecutionResult> }
  changeSets: ChangeSetService
  flush: { flush(): Promise<void> }
  tasks: TaskStore
  messages: MessageStore
  activities: ActivityStore
  now?: () => number
  limits?: Partial<ExecutionLimits>
  approvalBroker?: ApprovalBroker
}

export interface AgentTaskInput {
  taskId: string
  sessionId: string
  workspace: SnapshotWorkspace
  request: ProviderRequest
}

type UnsequencedTaskEvent = TaskEvent extends infer Event
  ? Event extends TaskEvent ? Omit<Event, 'taskId' | 'sequence'> : never
  : never

export interface AgentTaskResult {
  status: TaskStatus
  changeSet: ChangeSet | null
  errorCode: string | null
}

class AsyncEventQueue<T> implements AsyncIterable<T> {
  private values: T[] = []
  private waiting: Array<(value: IteratorResult<T>) => void> = []
  private closed = false
  push(value: T): void {
    const waiter = this.waiting.shift()
    if (waiter) waiter({ value, done: false })
    else this.values.push(value)
  }
  close(): void {
    this.closed = true
    for (const waiter of this.waiting.splice(0)) waiter({ value: undefined, done: true })
  }
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.values.shift()
        if (value !== undefined) return Promise.resolve({ value, done: false })
        if (this.closed) return Promise.resolve({ value: undefined, done: true })
        return new Promise((resolve) => this.waiting.push(resolve))
      },
    }
  }
}

function eventToolMeta(call: ParsedToolCall): { action: string; path: string | null } {
  switch (call.name) {
    case 'list_markdown_files': return { action: 'list', path: null }
    case 'search_markdown': return { action: 'search', path: null }
    case 'read_markdown': return { action: 'read', path: call.input.path }
    case 'create_markdown': return { action: 'create', path: call.input.path }
    case 'edit_markdown': return { action: 'edit', path: call.input.path }
    case 'rename_markdown': return { action: 'rename', path: call.input.from }
    case 'delete_markdown': return { action: 'delete', path: call.input.path }
  }
}

function isMutation(name: ParsedToolCall['name']): boolean {
  return name === 'create_markdown' || name === 'edit_markdown' || name === 'rename_markdown' || name === 'delete_markdown'
}

function safeCode(error: unknown): string {
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' && /^[A-Z0-9_]+$/.test(code) ? code : 'PROVIDER_ERROR'
}

function persistedContent(message: ProviderMessage): unknown[] {
  return message.content.map((block) => block.type === 'text'
    ? { type: 'text', text: block.text }
    : block.type === 'tool-call'
      ? { type: 'tool-call', id: block.call.id, name: block.call.name, input: block.call.input }
      : { type: 'tool-result', id: block.callId, content: block.content })
}

export class AgentRuntime {
  private readonly limits: ExecutionLimits
  private readonly now: () => number
  constructor(private readonly deps: AgentRuntimeDependencies) {
    this.limits = { ...DEFAULT_EXECUTION_LIMITS, ...deps.limits }
    this.now = deps.now ?? Date.now
  }

  start(input: AgentTaskInput): {
    events: AsyncIterable<TaskEvent>
    stop(): void
    respondToApproval(id: string, decision: 'approve' | 'deny'): boolean
    done: Promise<AgentTaskResult>
  } {
    const events = new AsyncEventQueue<TaskEvent>()
    const controller = new AbortController()
    let stopping = false
    let sequence = 0
    const emit = (event: UnsequencedTaskEvent): void => {
      events.push({ ...event, taskId: input.taskId, sequence: sequence++ } as TaskEvent)
    }
    const unsubscribeApproval = this.deps.approvalBroker?.subscribe?.((item) => {
      if (item.taskId === input.taskId) emit({ type: 'approval-request', approvalId: item.id, path: item.path, reason: item.reason, expectedVersion: item.expectedVersion, stale: item.stale })
    }) ?? (() => {})
    const stop = (): void => { stopping = true; this.deps.approvalBroker?.cancelTask(input.taskId); controller.abort() }
    const done = this.run(input, emit, controller, () => stopping).finally(() => { unsubscribeApproval(); events.close() })
    return { events, stop, respondToApproval: (id, decision) => this.deps.approvalBroker?.respond(id, decision) ?? false, done }
  }

  private async run(
    input: AgentTaskInput,
    emit: (event: UnsequencedTaskEvent) => void,
    controller: AbortController,
    isStopping: () => boolean,
  ): Promise<AgentTaskResult> {
    const startedAt = this.now()
    const timestamp = (): string => new Date(this.now()).toISOString()
    let status: TaskStatus = 'preparing'
    let mutations = 0
    let changeSet: ChangeSet | null = null
    let errorCode: string | null = null
    let toolCount = 0
    const identical = new Map<string, number>()
    const invalidEdits = new Map<string, number>()
    let request = structuredClone(input.request)

    this.deps.tasks.create({ id: input.taskId, sessionId: input.sessionId, status, createdAt: timestamp(), updatedAt: timestamp() })
    emit({ type: 'status', status })
    this.deps.messages.create({ id: uuidv7(this.now()), sessionId: input.sessionId, role: 'user', content: persistedContent(request.messages.at(-1)!), modelSwitch: null, createdAt: timestamp() })
    try {
      await this.deps.flush.flush()
      await this.deps.changeSets.begin(input.taskId, input.workspace)
      status = transitionTask(status, { type: 'transition', next: 'running', hasMutations: false })
      this.deps.tasks.transition(input.taskId, 'preparing', status, timestamp())
      emit({ type: 'status', status })

      while (true) {
        if (isStopping()) throw Object.assign(new Error('Stopped'), { code: 'CANCELLED' })
        if (this.now() - startedAt > this.limits.maxWallTimeMs) throw Object.assign(new Error('Limit'), { code: 'LIMIT_REACHED' })
        const calls: ToolCall[] = []
        let completed: ProviderMessage | null = null
        let stopReason = 'unknown'
        for await (const providerEvent of this.deps.provider.stream(request, controller.signal)) {
          if (providerEvent.type === 'text-delta') emit({ type: 'assistant-text-delta', text: providerEvent.text })
          else if (providerEvent.type === 'tool-call') calls.push(providerEvent.call)
          else if (providerEvent.type === 'usage') emit({ type: 'usage', inputTokens: providerEvent.inputTokens, outputTokens: providerEvent.outputTokens, ...(providerEvent.cachedInputTokens === undefined ? {} : { cachedInputTokens: providerEvent.cachedInputTokens }) })
          else { completed = providerEvent.assistantMessage; stopReason = providerEvent.stopReason }
        }
        if (!completed) throw Object.assign(new Error('Missing completed event'), { code: 'PROVIDER_ERROR' })
        this.deps.messages.create({
          id: uuidv7(this.now()), sessionId: input.sessionId, role: 'assistant',
          content: persistedContent(completed), modelSwitch: completed.providerData, createdAt: timestamp(),
        })
        request.messages.push(completed)
        if (stopReason !== 'tool-use' || calls.length === 0) {
          status = transitionTask(status, { type: 'transition', next: 'completed', hasMutations: false })
          this.deps.tasks.transition(input.taskId, 'running', status, timestamp())
          if (mutations > 0) {
            changeSet = await this.deps.changeSets.finalize(input.taskId)
            emit({ type: 'change-set', changeSet })
          }
          emit({ type: 'status', status })
          return { status, changeSet, errorCode: null }
        }

        const parsed: ParsedToolCall[] = []
        const immediateResults = new Map<string, ToolExecutionResult>()
        for (const call of calls) {
          toolCount += 1
          if (toolCount > this.limits.maxToolCalls) throw Object.assign(new Error('Limit'), { code: 'LIMIT_REACHED' })
          let value: ParsedToolCall
          try {
            value = parseToolCall(call)
          } catch (error) {
            if (!(error instanceof ToolCallValidationError)) throw error
            const fingerprint = `${call.name}:${JSON.stringify(call.input)}`
            const count = (identical.get(fingerprint) ?? 0) + 1
            identical.set(fingerprint, count)
            if (count > this.limits.maxIdenticalCalls) throw Object.assign(new Error('Limit'), { code: 'LIMIT_REACHED' })
            immediateResults.set(call.id, { ok: false, code: 'INVALID_TOOL_CALL', summary: `${call.name} failed: INVALID_TOOL_CALL` })
            continue
          }
          const fingerprint = toolCallFingerprint(value)
          const count = (identical.get(fingerprint) ?? 0) + 1
          identical.set(fingerprint, count)
          if (count > this.limits.maxIdenticalCalls) throw Object.assign(new Error('Limit'), { code: 'LIMIT_REACHED' })
          parsed.push(value)
        }

        const execute = async (call: ParsedToolCall, context: ToolExecutionContext): Promise<ToolExecutionResult> => {
          if (isStopping()) return { ok: false, code: 'CANCELLED', summary: `${call.name} cancelled.` }
          const meta = eventToolMeta(call)
          emit({ type: 'tool-start', callId: call.id, tool: call.name, action: meta.action, path: meta.path, summary: `${meta.action} ${meta.path ?? 'workspace'}` })
          this.deps.activities.create({ id: uuidv7(this.now()), taskId: input.taskId, kind: 'tool-start', payload: { callId: call.id, tool: call.name, ...meta }, createdAt: timestamp() })
          if (call.name === 'delete_markdown') {
            const waiting = transitionTask(status, { type: 'transition', next: 'waiting-approval', hasMutations: false })
            this.deps.tasks.transition(input.taskId, status, waiting, timestamp())
            status = waiting
            emit({ type: 'status', status })
          }
          const result = await this.deps.executor.execute(call, context)
          if (status === 'waiting-approval' && !isStopping()) {
            const resumed = transitionTask(status, { type: 'transition', next: 'running', hasMutations: false })
            this.deps.tasks.transition(input.taskId, status, resumed, timestamp())
            status = resumed
            emit({ type: 'status', status })
          }
          if (result.ok && isMutation(call.name)) mutations += 1
          if (!result.ok && call.name === 'edit_markdown' && ['EDIT_TARGET_NOT_FOUND', 'EDIT_TARGET_AMBIGUOUS', 'VERSION_CONFLICT'].includes(result.code)) {
            const count = (invalidEdits.get(call.input.path) ?? 0) + 1
            invalidEdits.set(call.input.path, count)
            if (count >= this.limits.maxInvalidEditsPerPath) errorCode = 'LIMIT_REACHED'
          }
          emit({ type: 'tool-result', callId: call.id, tool: call.name, ok: result.ok, code: result.ok ? null : result.code, summary: result.ok ? `${call.name} completed.` : result.summary })
          this.deps.activities.create({ id: uuidv7(this.now()), taskId: input.taskId, kind: 'tool-result', payload: { callId: call.id, tool: call.name, ok: result.ok, code: result.ok ? null : result.code }, createdAt: timestamp() })
          return result
        }
        const executed = await scheduleToolCalls(parsed, execute, { taskId: input.taskId, signal: controller.signal })
        if (errorCode === 'LIMIT_REACHED') throw Object.assign(new Error('Limit'), { code: errorCode })
        const executedById = new Map(parsed.map((call, index) => [call.id, executed[index]]))
        const results = calls.map((call) => immediateResults.get(call.id) ?? executedById.get(call.id)!)
        const toolMessage: ProviderMessage = {
          role: 'user', provider: null,
          content: calls.map((call, index) => ({ type: 'tool-result', callId: call.id, content: results[index], isError: !results[index].ok })),
          providerData: null,
        }
        this.deps.messages.create({ id: uuidv7(this.now()), sessionId: input.sessionId, role: 'tool', content: persistedContent(toolMessage), modelSwitch: null, createdAt: timestamp() })
        request.messages.push(toolMessage)
      }
    } catch (error) {
      errorCode = safeCode(error)
      const target: TaskStatus = mutations > 0 ? 'partial-complete' : isStopping() || errorCode === 'CANCELLED' ? 'stopped' : 'failed'
      const fromStatus = status
      status = transitionTask(status, { type: 'transition', next: target, hasMutations: mutations > 0 })
      this.deps.tasks.transition(input.taskId, fromStatus, status, timestamp())
      if (mutations > 0) {
        changeSet = await this.deps.changeSets.finalize(input.taskId)
        emit({ type: 'change-set', changeSet })
      }
      emit({ type: 'error', code: errorCode, retryable: errorCode === 'CONNECTION' || errorCode === 'RATE_LIMIT' || errorCode === 'TIMEOUT' })
      emit({ type: 'status', status })
      return { status, changeSet, errorCode }
    }
  }
}
