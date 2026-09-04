# DraftMD Agent UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the bottom AI task dock, persistent session UX, selection references, user-verifiable tool activity, delete approval, final per-file Diff, task undo, and model switching without compromising the editor-first layout.

**Architecture:** One renderer-side `AgentDockController` consumes typed task/session events and renders small focused components with plain DOM and CSS consistent with ColaMD. The main process remains authoritative for sessions, tasks, approvals, changes, and undo. The renderer never reconstructs task truth from partial stream output.

**Tech Stack:** TypeScript DOM UI, existing semantic CSS theme variables, typed preload bridge, Playwright Electron E2E.

**Spec:** `docs/superpowers/specs/2026-08-31-draftmd-product-design.md`

## Global Constraints

- Dock is at the bottom, collapsed to one input row by default, expandable upward, resizable, and does not change editor content width.
- Collapsing does not stop a task.
- No inline floating AI toolbar; selection is referenced through a keyboard command into the dock.
- Every control is keyboard reachable, has visible focus, localized accessible name, and non-color state cue.
- Diff uses line signs/labels and color; deletion always requires a blocking explicit decision.
- Renderer displays persisted task state and structured activities, not hidden model reasoning.
- All strings exist in both catalogs.

---

### Task 1: Add Dock Layout, Resize, and Keyboard Behavior

**Files:**
- Modify: `src/renderer/index.html`
- Create: `src/renderer/agent/agent-dock-controller.ts`
- Create: `src/renderer/agent/agent-dock.css`
- Create: `src/renderer/agent/agent-input.ts`
- Modify: `src/renderer/app/bootstrap.ts`
- Modify: `src/renderer/themes/base.css`
- Modify: `src/shared/i18n/messages.ts`
- Create: `tests/e2e/agent-dock-layout.spec.ts`

**Interfaces:**
- Produces `AgentDockController.open()`, `collapse()`, `focusInput()`, `setBusy()`, `dispose()`.
- Stores per-viewer dock height locally with safe `localStorage` fallback, clamped between 180px and 65vh.

- [ ] **Step 1: Write visual/layout E2E assertions**

Assert collapsed input is visible, editor width/left coordinate is unchanged after expansion, drag handle changes height, Escape collapses only when input is empty and task not waiting approval, and collapse leaves a fake running task alive.

- [ ] **Step 2: Add semantic DOM**

Use `<section aria-label>`, `<header>`, scrollable message log with `role="log"`, resize separator with `role="separator" aria-orientation="horizontal"`, `<textarea>`, model button, send/stop buttons. `hidden` controls collapsed subregions; do not use inline display toggles.

- [ ] **Step 3: Implement resizing and layout tokens**

Add `--agent-dock-height`, `--agent-dock-collapsed-height`, task status/semantic colors, and body layout grid. Editor/source heights become `calc(100vh - titlebar - dock)`. File panel bottom aligns above dock.

- [ ] **Step 4: Add keyboard behavior**

Default shortcuts after conflict audit:

- `⌘J`: show/hide/focus dock;
- `⌘Return`: send while input focused;
- `Escape`: collapse when safe;
- menu item “Focus AI Task Dock” exposes the shortcut.

Selection shortcut is added in Task 3.

- [ ] **Step 5: Verify**

Run E2E layout test at 1280×800 and 800×600, both themes and `prefers-reduced-motion`.

- [ ] **Step 6: Commit when authorized**

```bash
git add src/renderer src/shared/i18n tests/e2e/agent-dock-layout.spec.ts

git commit -m "feat: add resizable AI task dock"
```

---

### Task 2: Add Workspace Session Management and Model Switching

**Files:**
- Create: `src/renderer/agent/session-list.ts`
- Create: `src/renderer/agent/session-controller.ts`
- Create: `src/renderer/agent/model-picker.ts`
- Modify: `src/renderer/agent/agent-dock-controller.ts`
- Modify: `src/main/app/ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/shared/i18n/messages.ts`
- Create: `tests/e2e/sessions.spec.ts`

**Interfaces:**
- Consumes workspace-scoped session CRUD and redacted provider configs.
- Produces session new/switch/rename/delete and model-switch marker events.

- [ ] **Step 1: Write persistent-session E2E flow**

Create two sessions in workspace A, rename one, switch model, restart app, assert sessions and switch marker persist; open workspace B and assert A sessions absent; delete a session with confirmation and assert Markdown untouched.

- [ ] **Step 2: Implement session list and title behavior**

First user task creates a session if none selected. Initial title is a deterministic 40-character truncation until a later assistant turn; do not spend an extra LLM call for title generation in MVP. User rename wins permanently.

- [ ] **Step 3: Implement model picker**

Show configured model display name and capability. Switching records a `model-switch` message and affects later turns only. Disabled/unavailable configs link to settings; chat-only configs show “Suggestions only.”

- [ ] **Step 4: Implement deletion semantics**

Deleting a session removes local messages/tasks/snapshot references after a confirmation. Snapshot blobs become eligible for cleanup; workspace Markdown is never touched.

- [ ] **Step 5: Verify**

Run sessions E2E, repository integration tests, typecheck, build.

- [ ] **Step 6: Commit when authorized**

```bash
git add src/renderer/agent src/main/app src/preload src/shared/i18n tests/e2e/sessions.spec.ts

git commit -m "feat: add persistent workspace conversations"
```

---

### Task 3: Capture and Validate Editor Selections

**Files:**
- Modify: `src/renderer/editor/editor.ts`
- Create: `src/renderer/editor/selection-reference.ts`
- Modify: `src/renderer/app/source-mode-controller.ts`
- Create: `src/renderer/agent/selection-chip.ts`
- Modify: `src/renderer/agent/agent-input.ts`
- Modify: `src/shared/i18n/messages.ts`
- Create: `tests/unit/editor/selection-reference.test.ts`
- Create: `tests/e2e/selection-agent.spec.ts`

**Interfaces:**
- Produces `captureVisualSelection()` and `captureSourceSelection()` returning the shared `SelectionReference` shape, or null for empty selection.
- Main Agent validates captured version/anchors before mutation.

- [ ] **Step 1: Write source and visual selection tests**

Test heading path detection, before/after anchors, CJK text, duplicate selected text under different headings, empty selection, and 20KB selection cap with clear error.

- [ ] **Step 2: Capture WYSIWYG selection through ProseMirror**

Use editor state selection and serializer to derive exact Markdown slice. Walk ancestors/headings to compute title path; serialize content before/after from document text/Markdown, not DOM `innerHTML`.

- [ ] **Step 3: Capture source selection**

Use textarea `selectionStart/selectionEnd`, parse nearest preceding headings, and capture exact selected Markdown plus 200 characters on each side.

- [ ] **Step 4: Add shortcut and chip**

Use `⌘⇧J` for “Ask AI about Selection” after confirming no existing conflict. It opens/focuses dock and adds a removable chip: relative file · heading path · short quote. The selected content is not inserted visibly into textarea.

- [ ] **Step 5: Add stale-reference E2E test**

Capture selection, externally modify the selected paragraph before fake provider edit, and assert write rejected with localized “Selection changed—select it again”; no file mutation.

- [ ] **Step 6: Commit when authorized**

```bash
git add src/renderer/editor src/renderer/agent src/shared/i18n tests/unit/editor tests/e2e/selection-agent.spec.ts

git commit -m "feat: reference editor selections in Agent tasks"
```

---

### Task 4: Render Streaming Messages, Activities, and Accurate Task States

**Files:**
- Create: `src/renderer/agent/message-list.ts`
- Create: `src/renderer/agent/tool-activity-list.ts`
- Create: `src/renderer/agent/task-status.ts`
- Modify: `src/renderer/agent/agent-dock-controller.ts`
- Modify: `src/shared/i18n/messages.ts`
- Create: `tests/e2e/agent-task-flow.spec.ts`

**Interfaces:**
- Consumes persisted initial task/session state plus ordered live `TaskEvent`s.
- Produces user/assistant messages, structured activity rows, stop action, and terminal summary without interpreting raw provider messages.

- [ ] **Step 1: Write the cross-document task E2E flow**

Use fake provider: search meeting notes, read three files, edit product/design, finish. Assert streamed text, activity labels, busy indicator, stop button, final completed status, two changed files, and real disk changes.

- [ ] **Step 2: Render messages safely**

Render assistant text as escaped plain text for MVP; no model HTML. Preserve newlines and code spans without allowing links/scripts. Batch deltas with `requestAnimationFrame`, auto-scroll only if user was already near bottom.

- [ ] **Step 3: Render activities from structured data**

Map tool names to localized verbs and paths. States use icon shape + text: running spinner, success check, error mark, waiting lock. Display counts and relevant heading/range; never display raw tool JSON by default.

- [ ] **Step 4: Implement task state controls**

Preparing/running shows Stop; waiting confirmation shows pending item; terminal states show summary actions. `failed` is only shown when no change; `partial-complete` always links to Diff and Undo.

- [ ] **Step 5: Add stop E2E cases**

Stop before mutation → stopped/no Diff. Stop after one edit → partial-complete/one-file Diff/Undo. Reopening dock or app uses persisted status, not stale transient UI.

- [ ] **Step 6: Commit when authorized**

```bash
git add src/renderer/agent src/shared/i18n tests/e2e/agent-task-flow.spec.ts

git commit -m "feat: surface live document Agent work"
```

---

### Task 5: Add Deletion Approval UI

**Files:**
- Create: `src/renderer/agent/delete-approval.ts`
- Modify: `src/renderer/agent/agent-dock-controller.ts`
- Modify: `src/shared/i18n/messages.ts`
- Create: `tests/e2e/delete-approval.spec.ts`

**Interfaces:**
- Consumes approval requests with task ID, per-item path, reason, and stale-state flag.
- Produces one explicit approve/deny decision per item.

- [ ] **Step 1: Write approval E2E tests**

Test cancel, approve, mixed decisions for two files, keyboard navigation, app close while pending, stale version after request, and collapsed dock auto-expanding without auto-deciding.

- [ ] **Step 2: Implement blocking approval panel inside dock**

Display relative path in monospace, localized Agent reason as text, and changed-since-task warning. Default focused action is Cancel. Approve uses semantic destructive styling but is not triggered by Enter unless focused.

- [ ] **Step 3: Ensure close/stop denies pending items**

Window close invokes broker denial before shutdown. Stop returns user-cancelled results for all pending deletes and prevents later calls.

- [ ] **Step 4: Verify**

Run approval integration and E2E tests, both locales.

- [ ] **Step 5: Commit when authorized**

```bash
git add src/renderer/agent/delete-approval.ts src/shared/i18n tests/e2e/delete-approval.spec.ts

git commit -m "feat: require approval for Agent deletions"
```

---

### Task 6: Add Per-File Diff and Task Undo UI

**Files:**
- Create: `src/renderer/agent/diff-view.ts`
- Create: `src/renderer/agent/change-summary.ts`
- Create: `src/renderer/agent/undo-conflict.ts`
- Modify: `src/renderer/agent/agent-dock-controller.ts`
- Modify: `src/shared/i18n/messages.ts`
- Create: `tests/e2e/diff-undo.spec.ts`

**Interfaces:**
- Consumes structured `ChangeSet` and `UndoResult`; it never reads snapshot files.
- Produces per-file filters, accessible hunks, Undo action, and conflict details/choices.

- [ ] **Step 1: Write Diff and undo E2E tests**

Modify two files/create one, assert categories and +/- line counts, inspect hunks, undo and verify disk exactly restored. Then edit a changed line manually and assert undo-conflict leaves disk unchanged and shows three versions.

- [ ] **Step 2: Render accessible unified Diff**

Each file is a disclosure row with type badge. Each line has explicit `Added`, `Removed`, or `Context` visually-hidden label plus `+/-/ ` prefix and line numbers. Horizontally scroll only within code area; body never scrolls sideways.

- [ ] **Step 3: Implement task-level undo states**

Disable Undo while task running or waiting. After undo, mark task undone and retain view-only Diff/history. For conflicts, display affected files and actions: keep current file, open file, or cancel; MVP does not provide an inline three-way merge editor.

- [ ] **Step 4: Preserve editor position after Agent writes**

When current document changes, map ProseMirror selection through text anchors where possible; otherwise restore nearest heading and scroll ratio. Never steal focus from task input while user is typing.

- [ ] **Step 5: Verify**

Run Diff/undo integration and E2E tests, test color-independent labels in accessibility snapshot, typecheck, build.

- [ ] **Step 6: Commit when authorized**

```bash
git add src/renderer/agent src/shared/i18n tests/e2e/diff-undo.spec.ts

git commit -m "feat: review and undo Agent changes"
```

---

### Task 7: Add Interrupted-Task Recovery UI and First-Run Guidance

**Files:**
- Create: `src/renderer/agent/recovery-panel.ts`
- Create: `src/renderer/app/onboarding.ts`
- Modify: `src/renderer/app/bootstrap.ts`
- Modify: `src/shared/i18n/messages.ts`
- Create: `tests/e2e/recovery.spec.ts`
- Create: `tests/e2e/onboarding.spec.ts`

**Interfaces:**
- Consumes interrupted task summaries and settings state.
- Produces keep/view/undo recovery actions and skippable first-run guidance.

- [ ] **Step 1: Write recovery E2E test**

Seed partial task, launch, assert no provider call, show “previous task interrupted,” view changed files, keep or undo. Pending delete is absent/denied.

- [ ] **Step 2: Implement recovery panel**

It appears before normal session content but does not block opening/editing Markdown. Dismiss/keep records acknowledgement; Undo uses the same conflict path as Task 6.

- [ ] **Step 3: Write onboarding E2E test**

First run chooses/detects language, opens folder, skips model, sees permission summary, enters editor. Relaunch does not repeat; Help menu can reopen it.

- [ ] **Step 4: Implement concise onboarding**

Four steps only: language, open folder, optional model, permissions. Avoid account/cloud copy. If no model, dock remains usable as configuration entry.

- [ ] **Step 5: Run complete UI phase gate**

```bash
npm run test
npm run test:integration
npm run test:e2e
npm run typecheck
npm run build
npm run check:theme-colors
git diff --check
```

Expected: all pass.

- [ ] **Step 6: Commit when authorized**

```bash
git add src/renderer src/shared/i18n tests/e2e

git commit -m "feat: finish DraftMD Agent workspace experience"
```
