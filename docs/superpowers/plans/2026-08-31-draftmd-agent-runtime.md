# DraftMD Agent Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a cancellable, provider-neutral document Agent that can list, search, read, create, edit, rename, and conditionally delete Markdown while enforcing workspace, version, execution, persistence, and recovery boundaries.

**Architecture:** `AgentRuntime` is an explicit state machine that performs one provider turn at a time. It validates tool calls with Zod, executes read-only calls concurrently and mutating calls serially through `WorkspaceService`, persists every transition/activity, pauses for deletion approval, and finalizes a task-level change set under all terminal outcomes.

**Tech Stack:** TypeScript, Zod, ProviderAdapter, WorkspaceService, SQLite repositories, ChangeSetService, Vitest fake adapters and temp workspaces.

**Spec:** `docs/superpowers/specs/2026-08-31-draftmd-product-design.md`

## Global Constraints

- Tool surface is exactly the seven DraftMD Markdown tools; no generic filesystem, shell, web, URL, or MCP tool.
- Tool input is structured and schema-validated. Ordinary assistant text is never executed.
- Read-only tools may run in parallel; mutations are serialized in model order.
- Every mutation carries an expected version or explicit create-no-overwrite contract.
- Delete waits for UI approval and cancellation/close means denial.
- Tasks have explicit tool-call, wall-clock, repeated-call, and same-path-invalid-edit limits.
- Task status always matches disk state; partial mutation implies `partial-complete`, not generic failure.
- Every mutating task begins a baseline and finalizes a ChangeSet even after stop/error.

---

### Task 1: Define the Task State Machine and Event Contract

**Files:**
- Create: `src/main/agent/task-state-machine.ts`
- Create: `src/shared/contracts/agent.ts`
- Create: `tests/unit/agent/task-state-machine.test.ts`

**Interfaces:**
- Produces statuses `preparing | running | waiting-confirmation | completed | partial-complete | stopped | failed | undone | undo-conflict`.
- Produces `TaskEvent` variants for status, assistant text delta, tool start/result, approval request, usage, error, and final change set.

- [ ] **Step 1: Write exhaustive transition tests**

Test allowed and forbidden transitions, especially running → waiting-confirmation → running, running → partial-complete, failed only when no mutations, terminal statuses immutable, and undone/undo-conflict only from completed/partial-complete.

- [ ] **Step 2: Implement a pure transition function**

```ts
export function transitionTask(current: TaskStatus, event: TaskTransitionEvent): TaskStatus
```

Use an exhaustive `switch`; invalid transitions throw `TaskStateError` containing statuses only.

- [ ] **Step 3: Define strict serializable events**

Every event carries task ID and monotonic sequence. Tool events contain relative path/action and safe summary, never complete file contents. Text delta may contain assistant output because it is user-visible and persisted as a message.

- [ ] **Step 4: Verify**

Run unit tests and typecheck.

- [ ] **Step 5: Commit when authorized**

```bash
git add src/main/agent/task-state-machine.ts src/shared/contracts/agent.ts tests/unit/agent

git commit -m "feat: define document task lifecycle"
```

---

### Task 2: Define and Validate the Seven Markdown Tools

**Files:**
- Create: `src/main/agent/tools/schemas.ts`
- Create: `src/main/agent/tools/definitions.ts`
- Create: `src/main/agent/tools/executor.ts`
- Create: `tests/unit/agent/tool-schemas.test.ts`
- Create: `tests/integration/agent/tool-executor.test.ts`

**Interfaces:**
- Produces `ToolName`, `toolDefinitions`, `parseToolCall(call)`, and `ToolExecutor.execute(call, context)`.
- Provider adapters serialize `toolDefinitions`; Runtime consumes normalized calls.

- [ ] **Step 1: Write strict tool schema tests**

Test exact valid/invalid inputs for:

```text
list_markdown_files({})
search_markdown({ query, limit? })
read_markdown({ path, heading?, startLine?, endLine? })
create_markdown({ path, content })
edit_markdown({ path, oldText, newText, expectedVersion })
rename_markdown({ from, to, expectedVersion })
delete_markdown({ path, expectedVersion, reason })
```

All schemas are strict; unknown keys rejected; paths and queries bounded; content max 5 MiB.

- [ ] **Step 2: Implement provider-neutral definitions**

Descriptions state exact boundary and conflict behavior. Tool order is deterministic: list, search, read, create, edit, rename, delete. JSON schemas set `additionalProperties: false` and required fields.

- [ ] **Step 3: Implement executor delegation**

Read/list/search delegate to WorkspaceService and truncate only the number of matches/lines according to explicit request limits. Never silently truncate a requested whole file: return `CONTENT_TOO_LARGE` with byte count and instruct the model to request a heading/range.

- [ ] **Step 4: Gate delete through an approval broker**

`delete_markdown` calls `ApprovalBroker.request({ taskId, path, reason, expectedVersion })`. Only `{ decision: 'approve' }` executes deletion. Deny returns a normal tool error result `USER_DENIED`; timeout/app close returns `USER_CANCELLED`.

- [ ] **Step 5: Verify**

Run schema and integration tests against temp workspaces, including all path/version conflicts.

- [ ] **Step 6: Commit when authorized**

```bash
git add src/main/agent/tools tests/unit/agent tests/integration/agent

git commit -m "feat: add constrained Markdown Agent tools"
```

---

### Task 3: Build Stable Prompt and Context Assembly

**Files:**
- Create: `src/main/agent/system-prompt.ts`
- Create: `src/main/agent/context-builder.ts`
- Create: `src/main/agent/selection-reference.ts`
- Create: `tests/unit/agent/context-builder.test.ts`

**Interfaces:**
- Produces `buildProviderRequest(task, session, workspace, tools)`, `SelectionReference`, and provider-neutral messages.
- Stable system prefix is deterministic; volatile workspace/current selection/task content is appended after it.

- [ ] **Step 1: Write context minimality tests**

Assert request contains permission rules, sorted file inventory, current document metadata, explicit selection when provided, effective session history, and tools; assert it does not include contents of unrelated files. Same stable input produces byte-identical system/tool serialization.

- [ ] **Step 2: Implement the system policy**

Policy states: operate only through provided tools; do not invent file contents; read before edit; use expected versions; prefer focused edits; never delete without tool approval; explain inability instead of guessing; no shell/web/non-Markdown operations; finish with concise result summary.

- [ ] **Step 3: Implement bounded session history**

Load complete recent turns up to provider-independent byte/token estimate threshold. Preserve tool calls/results needed for current task. When too large, stop before dropping requested documents and return `CONTEXT_LIMIT` for the Runtime to request a new session or narrower task; compaction is not part of MVP provider-neutral path.

- [ ] **Step 4: Implement selection references**

Reference contains workspace ID, relative file, heading path, exact selected text, 200-character before/after anchors, source mode flag, and captured file version. Validate file version and unique anchor match immediately before edit.

- [ ] **Step 5: Verify**

Run unit tests, snapshot stable system/tool request, and typecheck.

- [ ] **Step 6: Commit when authorized**

```bash
git add src/main/agent/system-prompt.ts src/main/agent/context-builder.ts src/main/agent/selection-reference.ts tests/unit/agent

git commit -m "feat: assemble bounded document Agent context"
```

---

### Task 4: Implement the Provider-Neutral Agent Loop

**Files:**
- Create: `src/main/agent/agent-runtime.ts`
- Create: `src/main/agent/execution-limits.ts`
- Create: `src/main/agent/tool-scheduler.ts`
- Create: `src/main/agent/task-controller.ts`
- Create: `tests/helpers/fake-provider-adapter.ts`
- Create: `tests/integration/agent/agent-runtime.test.ts`

**Interfaces:**
- Produces `AgentRuntime.start(input): Promise<TaskHandle>`, where handle has `events`, `stop()`, `respondToApproval()`, and `done`.
- Consumes one-turn `ProviderAdapter.stream()`; Runtime appends assistant/tool messages and loops.

- [ ] **Step 1: Write a failing multi-turn integration test**

Fake provider sequence: search tool → read tool → parallel edits of two files → final text. Assert activity ordering, disk changes, persisted messages/tool activities, completed state, and finalized ChangeSet.

- [ ] **Step 2: Implement preparation and guaranteed finalization**

On `start`: flush current editor through an injected `DocumentFlushGateway`, create task row, begin baseline, build context, transition to running. Wrap loop in `try/finally`; if mutations exist under error/stop, finalize ChangeSet and transition to partial-complete.

- [ ] **Step 3: Implement event streaming and assistant messages**

Buffer text deltas for renderer at 30–60 Hz while still persisting the final assistant turn once. Store provider-private continuation payload encrypted? No: keep it in local SQLite as provider response JSON without secrets; document this as local session data and never log it.

- [ ] **Step 4: Implement scheduling**

Execute a batch of list/search/read calls concurrently with `Promise.allSettled`; execute create/edit/rename/delete serially in response order. Return all tool results in one provider follow-up user turn to preserve parallel-tool semantics.

- [ ] **Step 5: Implement limits**

Defaults:

```ts
{
  maxToolCalls: 40,
  maxWallTimeMs: 10 * 60_000,
  maxIdenticalCalls: 3,
  maxInvalidEditsPerPath: 3,
}
```

Count every requested tool, including denied/invalid calls. Identical call hash is tool name + canonical JSON input. Abort with safe `LIMIT_REACHED` reason and partial completion if mutated.

- [ ] **Step 6: Implement cancellation**

One AbortController covers provider turns and read/search tools. `stop()` sets stopping flag, aborts outstanding calls, denies pending approvals, permits an already-started atomic rename to finish, and blocks all later tools.

- [ ] **Step 7: Verify loop cases**

Tests: successful multi-step, parallel reads, sequential mutations, malformed tool call correction once, repeated invalid call stop, wall-time stop with fake timers, user cancellation before/after mutation, provider error before/after mutation, and context-limit failure.

- [ ] **Step 8: Commit when authorized**

```bash
git add src/main/agent tests/helpers/fake-provider-adapter.ts tests/integration/agent

git commit -m "feat: run cancellable document Agent tasks"
```

---

### Task 5: Add Delete Approval, Recovery, and Resume Semantics

**Files:**
- Create: `src/main/agent/approval-broker.ts`
- Create: `src/main/agent/task-recovery.ts`
- Modify: `src/main/app/ipc.ts`
- Modify: `src/main/app/window-manager.ts`
- Create: `tests/integration/agent/approval.test.ts`
- Create: `tests/integration/agent/recovery.test.ts`

**Interfaces:**
- Produces renderer event/request for delete approval, startup `InterruptedTaskSummary[]`, `keepInterruptedTask(taskId)`, and `undoInterruptedTask(taskId)`.
- No automatic model continuation on startup.

- [ ] **Step 1: Write approval tests**

Test approve, deny, per-item decision for multiple deletes, stale version at approval time, stop while waiting, and app-close cancellation. Ensure approval reason/path only, never arbitrary HTML.

- [ ] **Step 2: Implement broker persistence**

Persist pending approval as tool activity. Runtime transitions to waiting-confirmation, sends UI event, and returns to running after decision. Re-check file version after approval and before delete.

- [ ] **Step 3: Write crash recovery tests**

Seed DB with preparing/running/waiting task plus baseline and partial disk changes. On startup, mark it partial-complete if changes exist, stopped if none; produce summary and Diff; never call provider adapter.

- [ ] **Step 4: Implement startup recovery**

Recovery runs after DB/workspace service initialization and before showing task dock. User may keep changes, view Diff, or invoke UndoService. Pending deletion is treated as denied.

- [ ] **Step 5: Verify**

Run all Agent integration tests, typecheck, build, and `git diff --check`.

- [ ] **Step 6: Commit when authorized**

```bash
git add src/main/agent src/main/app tests/integration/agent

git commit -m "feat: recover and approve Agent tasks safely"
```

---

### Task 6: Implement Chat-Only Mode

**Files:**
- Create: `src/main/agent/chat-runtime.ts`
- Modify: `src/main/agent/task-controller.ts`
- Create: `tests/integration/agent/chat-runtime.test.ts`

**Interfaces:**
- Produces streaming conversation with zero tools for provider configs classified `chat-only`.
- It can receive current document or selection text supplied explicitly, but cannot call or simulate file tools.

- [ ] **Step 1: Write zero-tool request tests**

Assert chat-only ProviderRequest has empty tool list, includes explicit current content/selection, streams response, persists conversation, creates no task baseline, and produces no ChangeSet.

- [ ] **Step 2: Implement safe routing**

TaskController rejects direct-edit intent only structurally: if capability is chat-only, it runs ChatRuntime and UI labels response as suggestion. It never parses returned patches or file instructions.

- [ ] **Step 3: Verify**

Run chat/runtime tests and assert no WorkspaceService mutation methods were invoked.

- [ ] **Step 4: Commit when authorized**

```bash
git add src/main/agent/chat-runtime.ts src/main/agent/task-controller.ts tests/integration/agent/chat-runtime.test.ts

git commit -m "feat: support safe chat-only providers"
```
