import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { createWorkspaceRoot } from '../../../src/main/workspace/path-guard'
import { createWorkspaceService } from '../../../src/main/workspace/workspace-service'
import { createChangeSetService } from '../../../src/main/changes/change-set-service'
import { createToolExecutor } from '../../../src/main/agent/tools/executor'
import { AgentRuntime } from '../../../src/main/agent/agent-runtime'
import { FakeProviderAdapter } from '../../helpers/fake-provider-adapter'
import type { ProviderEvent, ProviderRequest, ToolCall } from '../../../src/shared/contracts/provider'

const taskId = '01991d5a-1c00-7000-8000-000000000000'
const sessionId = '01991d5a-1c00-7000-8000-000000000001'

function turn(calls: ToolCall[], text = ''): ProviderEvent[] {
  const content = [
    ...(text ? [{ type: 'text' as const, text }] : []),
    ...calls.map((call) => ({ type: 'tool-call' as const, call })),
  ]
  return [
    ...(text ? [{ type: 'text-delta' as const, text }] : []),
    ...calls.map((call) => ({ type: 'tool-call' as const, call })),
    { type: 'completed', stopReason: calls.length ? 'tool-use' : 'end-turn', assistantMessage: {
      role: 'assistant', provider: 'openai-compatible', content, providerData: null,
    } } as const,
  ]
}

function toolResults(request: ProviderRequest): Array<{ callId: string; content: unknown; isError: boolean }> {
  return request.messages.at(-1)?.content.flatMap((block) => block.type === 'tool-result' ? [{ callId: block.callId, content: block.content, isError: block.isError }] : []) ?? []
}

async function setup(adapter: FakeProviderAdapter, limits?: Partial<{ maxToolCalls: number; maxWallTimeMs: number; maxIdenticalCalls: number; maxInvalidEditsPerPath: number }>, runtimeApprovalBroker?: { request: Function; respond: Function; cancelTask: Function; cancelAll: Function }) {
  const root = await mkdtemp(join(tmpdir(), 'draftmd-runtime-workspace-'))
  const snapshots = await mkdtemp(join(tmpdir(), 'draftmd-runtime-snapshots-'))
  await writeFile(join(root, 'a.md'), '# A\nold a\n')
  await writeFile(join(root, 'b.md'), '# B\nold b\n')
  const workspace = createWorkspaceService(await createWorkspaceRoot(root))
  const approval = { request: vi.fn().mockResolvedValue({ decision: 'deny' }), cancelTask: vi.fn(), cancelAll: vi.fn() }
  const executor = createToolExecutor({ workspace, approval })
  const states: string[] = []
  const messages: unknown[] = []
  const activities: unknown[] = []
  const changes = createChangeSetService(snapshots)
  const runtime = new AgentRuntime({
    provider: adapter, executor, changeSets: changes,
    flush: { flush: vi.fn().mockResolvedValue(undefined) },
    tasks: {
      create: vi.fn((record) => states.push(record.status)),
      transition: vi.fn((_id, from, to) => { states.push(to); return true }),
    },
    messages: { create: vi.fn((message) => messages.push(message)) },
    activities: { create: vi.fn((activity) => activities.push(activity)) },
    now: (() => { let value = 1_000; return () => ++value })(),
    limits, approvalBroker: runtimeApprovalBroker as never,
  })
  const request: ProviderRequest = {
    system: 'Policy',
    messages: [{ role: 'user', provider: null, content: [{ type: 'text', text: 'Update both files' }], providerData: null }],
    tools: [], maxOutputTokens: 64_000,
  }
  return {
    root, workspace, states, messages, activities, runtime, request,
    workspaceDescriptor: { id: 'a'.repeat(64), name: 'Workspace', canonicalPath: root },
  }
}

async function drain<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = []
  for await (const value of iterable) values.push(value)
  return values
}

describe('AgentRuntime', () => {
  it('runs parallel reads then serialized mutations and finalizes one accurate change set', async () => {
    const adapter = new FakeProviderAdapter([
      () => turn([
        { id: 'search', name: 'search_markdown', input: { query: 'old' } },
        { id: 'read-a', name: 'read_markdown', input: { path: 'a.md' } },
        { id: 'read-b', name: 'read_markdown', input: { path: 'b.md' } },
      ]),
      (request) => {
        const results = toolResults(request)
        const a = results.find((result) => result.callId === 'read-a')!.content as { value: { version: string } }
        const b = results.find((result) => result.callId === 'read-b')!.content as { value: { version: string } }
        return turn([
          { id: 'edit-a', name: 'edit_markdown', input: { path: 'a.md', oldText: 'old a', newText: 'new a', expectedVersion: a.value.version } },
          { id: 'edit-b', name: 'edit_markdown', input: { path: 'b.md', oldText: 'old b', newText: 'new b', expectedVersion: b.value.version } },
        ])
      },
      () => turn([], 'Updated both files.'),
    ])
    const test = await setup(adapter)

    const handle = test.runtime.start({
      taskId, sessionId, workspace: test.workspaceDescriptor, request: test.request,
    })
    const eventsPromise = drain(handle.events)
    const result = await handle.done
    const events = await eventsPromise

    expect(result.status).toBe('completed')
    expect(result.changeSet?.changes.map((change) => change.path)).toEqual(['a.md', 'b.md'])
    expect(await readFile(join(test.root, 'a.md'), 'utf8')).toBe('# A\nnew a\n')
    expect(await readFile(join(test.root, 'b.md'), 'utf8')).toBe('# B\nnew b\n')
    expect(test.states).toEqual(['preparing', 'running', 'completed'])
    expect(test.messages).toHaveLength(6)
    expect(test.activities).toHaveLength(10)
    expect(events.filter((event) => event.type === 'tool-start').map((event) => event.tool)).toEqual([
      'search_markdown', 'read_markdown', 'read_markdown', 'edit_markdown', 'edit_markdown',
    ])
    expect(events.at(-1)).toMatchObject({ type: 'status', status: 'completed' })
    expect(adapter.requests[1].messages.at(-1)?.content.filter((block) => block.type === 'tool-result')).toHaveLength(3)
  })

  it('stops repeated identical calls before executing beyond the configured limit', async () => {
    const repeat = () => turn([{ id: crypto.randomUUID(), name: 'list_markdown_files', input: {} }])
    const adapter = new FakeProviderAdapter([repeat, repeat, repeat, repeat])
    const test = await setup(adapter, { maxIdenticalCalls: 2 })
    const handle = test.runtime.start({ taskId, sessionId, workspace: test.workspaceDescriptor, request: test.request })
    const result = await handle.done
    expect(result.status).toBe('failed')
    expect(result.errorCode).toBe('LIMIT_REACHED')
    expect(adapter.requests).toHaveLength(3)
  })

  it('stops cleanly before mutation when the user cancels a provider turn', async () => {
    const adapter = new FakeProviderAdapter([async (_request, signal) => {
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
      throw Object.assign(new Error('cancelled'), { code: 'CANCELLED' })
    }])
    const test = await setup(adapter)
    const handle = test.runtime.start({ taskId, sessionId, workspace: test.workspaceDescriptor, request: test.request })
    handle.stop()
    const result = await handle.done
    expect(result.status).toBe('stopped')
    expect(result.changeSet).toBeNull()
  })

  it('reports partial-complete and finalizes changes when provider fails after mutation', async () => {
    const adapter = new FakeProviderAdapter([
      () => turn([{ id: 'read', name: 'read_markdown', input: { path: 'a.md' } }]),
      (request) => {
        const read = toolResults(request)[0].content as { value: { version: string } }
        return turn([{ id: 'edit', name: 'edit_markdown', input: { path: 'a.md', oldText: 'old a', newText: 'changed', expectedVersion: read.value.version } }])
      },
      () => { throw Object.assign(new Error('provider down'), { code: 'CONNECTION' }) },
    ])
    const test = await setup(adapter)
    const result = await test.runtime.start({ taskId, sessionId, workspace: test.workspaceDescriptor, request: test.request }).done
    expect(result.status).toBe('partial-complete')
    expect(result.errorCode).toBe('CONNECTION')
    expect(result.changeSet?.changes).toHaveLength(1)
  })
})

it('returns one malformed tool error to the provider and allows correction', async () => {
  const adapter = new FakeProviderAdapter([
    () => turn([{ id: 'bad', name: 'read_markdown', input: { path: '../secret.md' } }]),
    (request) => {
      expect(toolResults(request)).toEqual([{ callId: 'bad', content: {
        ok: false, code: 'INVALID_TOOL_CALL', summary: 'read_markdown failed: INVALID_TOOL_CALL',
      }, isError: true }])
      return turn([{ id: 'good', name: 'read_markdown', input: { path: 'a.md' } }])
    },
    () => turn([], 'Recovered.'),
  ])
  const test = await setup(adapter)
  const result = await test.runtime.start({ taskId, sessionId, workspace: test.workspaceDescriptor, request: test.request }).done
  expect(result.status).toBe('completed')
  expect(adapter.requests).toHaveLength(3)
})

it('stops after the same malformed tool call repeats', async () => {
  const bad = () => turn([{ id: crypto.randomUUID(), name: 'read_markdown', input: { path: '../secret.md' } }])
  const adapter = new FakeProviderAdapter([bad, bad, bad])
  const test = await setup(adapter, { maxIdenticalCalls: 2 })
  const result = await test.runtime.start({ taskId, sessionId, workspace: test.workspaceDescriptor, request: test.request }).done
  expect(result.status).toBe('failed')
  expect(result.errorCode).toBe('LIMIT_REACHED')
})

it('enforces the wall-time limit between provider turns', async () => {
  const adapter = new FakeProviderAdapter([
    () => turn([{ id: 'list', name: 'list_markdown_files', input: {} }]),
  ])
  const test = await setup(adapter, { maxWallTimeMs: 0 })
  const result = await test.runtime.start({ taskId, sessionId, workspace: test.workspaceDescriptor, request: test.request }).done
  expect(result.status).toBe('failed')
  expect(result.errorCode).toBe('LIMIT_REACHED')
})

it('fails without a ChangeSet when the provider errors before any mutation', async () => {
  const adapter = new FakeProviderAdapter([() => { throw Object.assign(new Error('auth'), { code: 'AUTHENTICATION' }) }])
  const test = await setup(adapter)
  const result = await test.runtime.start({ taskId, sessionId, workspace: test.workspaceDescriptor, request: test.request }).done
  expect(result).toMatchObject({ status: 'failed', errorCode: 'AUTHENTICATION', changeSet: null })
})

it('returns partial-complete when stopped after a mutation', async () => {
  let unblock!: () => void
  const adapter = new FakeProviderAdapter([
    () => turn([{ id: 'read', name: 'read_markdown', input: { path: 'a.md' } }]),
    (request) => {
      const read = toolResults(request)[0].content as { value: { version: string } }
      return turn([{ id: 'edit', name: 'edit_markdown', input: { path: 'a.md', oldText: 'old a', newText: 'changed', expectedVersion: read.value.version } }])
    },
    async (_request, signal) => {
      await new Promise<void>((resolve) => { unblock = resolve; signal.addEventListener('abort', resolve, { once: true }) })
      throw Object.assign(new Error('cancelled'), { code: 'CANCELLED' })
    },
  ])
  const test = await setup(adapter)
  const handle = test.runtime.start({ taskId, sessionId, workspace: test.workspaceDescriptor, request: test.request })
  while (adapter.requests.length < 3) await new Promise((resolve) => setTimeout(resolve, 1))
  handle.stop(); unblock?.()
  const result = await handle.done
  expect(result.status).toBe('partial-complete')
  expect(result.changeSet?.changes).toHaveLength(1)
})

it('transitions through waiting-approval and accepts a per-item response through the task handle', async () => {
  let approvalId = ''
  let resolveApproval!: (value: { decision: 'approve' | 'deny' | 'cancel' }) => void
  const approvalBroker = {
    request: vi.fn((input) => new Promise<{ decision: 'approve' | 'deny' | 'cancel' }>((resolve) => {
      approvalId = `${input.taskId}:approval`
      resolveApproval = resolve
    })),
    respond: vi.fn((id, decision) => { if (id !== approvalId) return false; resolveApproval({ decision }); return true }),
    cancelTask: vi.fn(), cancelAll: vi.fn(),
  }
  const adapter = new FakeProviderAdapter([
    () => turn([{ id: 'read', name: 'read_markdown', input: { path: 'a.md' } }]),
    (request) => {
      const read = toolResults(request)[0].content as { value: { version: string } }
      return turn([{ id: 'delete', name: 'delete_markdown', input: { path: 'a.md', expectedVersion: read.value.version, reason: 'Obsolete' } }])
    },
    () => turn([], 'Deleted.'),
  ])
  const test = await setup(adapter, undefined, approvalBroker)
  const executor = createToolExecutor({ workspace: test.workspace, approval: approvalBroker })
  ;(test.runtime as unknown as { deps: { executor: typeof executor } }).deps.executor = executor
  const handle = test.runtime.start({ taskId, sessionId, workspace: test.workspaceDescriptor, request: test.request })
  const eventPromise = drain(handle.events)
  while (!approvalId) await new Promise((resolve) => setTimeout(resolve, 1))
  expect(handle.respondToApproval(approvalId, 'approve')).toBe(true)
  const result = await handle.done
  const events = await eventPromise

  expect(result.status).toBe('completed')
  expect(events.filter((event) => event.type === 'status').map((event) => event.status)).toContain('waiting-approval')
  expect(test.states).toContain('waiting-approval')
})

it('cancels pending approvals when stopped', async () => {
  const approvalBroker = {
    request: vi.fn(() => new Promise<{ decision: 'cancel' }>(() => {})),
    respond: vi.fn(), cancelTask: vi.fn(), cancelAll: vi.fn(),
  }
  const adapter = new FakeProviderAdapter([async (_request, signal) => {
    await new Promise<void>((resolve) => signal.addEventListener('abort', resolve, { once: true }))
    throw Object.assign(new Error('cancelled'), { code: 'CANCELLED' })
  }])
  const test = await setup(adapter, undefined, approvalBroker)
  const handle = test.runtime.start({ taskId, sessionId, workspace: test.workspaceDescriptor, request: test.request })
  handle.stop()
  await handle.done
  expect(approvalBroker.cancelTask).toHaveBeenCalledWith(taskId)
})

it('finishes partial-complete when stopped in approval after an earlier mutation', async () => {
  let approvalListener: ((item: { id: string; taskId: string; path: string; reason: string; expectedVersion: string; stale: boolean }) => void) | null = null
  const approvalBroker = {
    request: vi.fn((input) => new Promise<{ decision: 'cancel' }>((resolve) => {
      approvalListener?.({ id: 'approval-1', ...input })
      approvalBroker.cancelTask.mockImplementation(() => resolve({ decision: 'cancel' }))
    })),
    respond: vi.fn(), cancelTask: vi.fn(), cancelAll: vi.fn(),
    subscribe: vi.fn((listener) => { approvalListener = listener; return () => { approvalListener = null } }),
  }
  const adapter = new FakeProviderAdapter([
    () => turn([{ id: 'read-a', name: 'read_markdown', input: { path: 'a.md' } }, { id: 'read-b', name: 'read_markdown', input: { path: 'b.md' } }]),
    (request) => {
      const results = toolResults(request)
      const a = results.find((result) => result.callId === 'read-a')!.content as { value: { version: string } }
      const b = results.find((result) => result.callId === 'read-b')!.content as { value: { version: string } }
      return turn([
        { id: 'edit', name: 'edit_markdown', input: { path: 'a.md', oldText: 'old a', newText: 'changed', expectedVersion: a.value.version } },
        { id: 'delete', name: 'delete_markdown', input: { path: 'b.md', expectedVersion: b.value.version, reason: 'Obsolete' } },
      ])
    },
  ])
  const test = await setup(adapter, undefined, approvalBroker)
  const executor = createToolExecutor({ workspace: test.workspace, approval: approvalBroker })
  ;(test.runtime as unknown as { deps: { executor: typeof executor } }).deps.executor = executor
  const handle = test.runtime.start({ taskId, sessionId, workspace: test.workspaceDescriptor, request: test.request })
  const eventPromise = drain(handle.events)
  while (!approvalListener || !approvalBroker.request.mock.calls.length) await new Promise((resolve) => setTimeout(resolve, 1))
  handle.stop()
  const result = await handle.done
  const events = await eventPromise
  expect(result.status).toBe('partial-complete')
  expect(result.changeSet?.changes).toHaveLength(1)
  expect(events).toContainEqual(expect.objectContaining({ type: 'approval-request', approvalId: 'approval-1', path: 'b.md' }))
})
