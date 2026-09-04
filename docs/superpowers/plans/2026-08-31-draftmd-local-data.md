# DraftMD Local Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a secure folder workspace, local SQLite session/task persistence, Keychain-backed secrets, task snapshots, final Diff generation, and conflict-aware task undo without introducing any model dependency.

**Architecture:** All filesystem operations pass through `WorkspaceService`, which resolves relative paths against a canonical root and validates the final target. SQLite repositories persist only serializable metadata; Keychain persists secrets. `ChangeSetService` owns baselines, Diff calculation, and undo independent of the Agent so it can be tested deterministically.

**Tech Stack:** TypeScript, Zod, better-sqlite3 13, `@napi-rs/keyring` 2, `diff` 9, node-diff3 3.1, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-31-draftmd-product-design.md`

## Global Constraints

- Workspace is the folder explicitly selected by the user, not the parent of one opened file.
- Only `.md` and `.markdown` are visible to Agent/data services.
- Reject absolute paths, path traversal, NUL bytes, symlink escapes, and case-normalization escapes.
- Use atomic writes and compare expected SHA-256 version before every mutation.
- SQLite/session failures must not prevent ordinary Markdown editing.
- Secrets never enter SQLite, settings JSON, logs, IPC payloads, or renderer state.
- Snapshots live only below `app.getPath('userData')/snapshots`.

---

### Task 1: Add Workspace Identity and Path Guard

**Files:**
- Create: `src/main/workspace/path-guard.ts`
- Create: `src/main/workspace/workspace-id.ts`
- Create: `src/shared/contracts/workspace.ts`
- Create: `tests/unit/workspace/path-guard.test.ts`
- Create: `tests/integration/workspace/symlink-escape.test.ts`
- Create: `vitest.integration.config.ts`

**Interfaces:**
- Produces: `WorkspaceRoot`, `resolveMarkdownPath(root, relativePath, mode)`, `workspaceId(canonicalRoot)`, `WorkspaceDescriptorSchema`.
- Every later filesystem repository/tool consumes these functions; no module uses `join(root, modelPath)` directly.

- [ ] **Step 1: Write traversal and extension tests**

```ts
it.each(['../secret.md', '/tmp/secret.md', 'a/../../secret.md', 'note.md\0.txt'])('rejects %s', async (path) => {
  await expect(resolveMarkdownPath(root, path, 'existing')).rejects.toMatchObject({ code: 'PATH_OUTSIDE_WORKSPACE' })
})

it.each(['a.txt', 'a.md.exe', '.md'])('rejects unsupported extension %s', async (path) => {
  await expect(resolveMarkdownPath(root, path, 'new')).rejects.toMatchObject({ code: 'UNSUPPORTED_FILE_TYPE' })
})
```

Run unit tests; expect module-not-found failure.

- [ ] **Step 2: Implement lexical and canonical checks**

`resolveMarkdownPath()` accepts only normalized POSIX-style relative input. It resolves existing parent/target via `realpath`, compares `relative(canonicalRoot, canonicalTarget)` and rejects `..` or absolute results. For new files, canonicalize the nearest existing parent before appending the new basename. Return `{ absolutePath, relativePath }` with NFC normalization.

- [ ] **Step 3: Add real symlink escape tests**

Create a temp workspace with `linked -> outside`, then assert reads/writes to `linked/secret.md` fail. Add a symlink that stays within root and decide consistently: allow only when its resolved target is within root, returning the logical relative path for display.

- [ ] **Step 4: Implement stable workspace IDs**

`workspaceId()` returns `sha256('draftmd-workspace\0' + canonicalRoot)`. Store/display only the hash outside main process; never log the absolute root.

- [ ] **Step 5: Verify**

Run:

```bash
npm run test -- tests/unit/workspace
npm run test:integration -- tests/integration/workspace/symlink-escape.test.ts
npm run typecheck
```

Expected: all cases pass.

- [ ] **Step 6: Commit when authorized**

```bash
git add src/main/workspace src/shared/contracts/workspace.ts tests/unit/workspace tests/integration/workspace vitest.integration.config.ts

git commit -m "feat: enforce Markdown workspace boundary"
```

---

### Task 2: Implement Versioned Atomic Markdown CRUD and Search

**Files:**
- Create: `src/main/workspace/file-version.ts`
- Create: `src/main/workspace/workspace-service.ts`
- Create: `src/main/workspace/markdown-index.ts`
- Create: `tests/integration/workspace/workspace-service.test.ts`
- Create: `tests/fixtures/workspace-basic/**`

**Interfaces:**
- Produces:

```ts
interface WorkspaceService {
  list(): Promise<MarkdownFileInfo[]>
  search(query: string, limit?: number): Promise<SearchMatch[]>
  read(path: string, range?: MarkdownRange): Promise<MarkdownReadResult>
  create(path: string, content: string): Promise<FileMutationResult>
  edit(path: string, edit: TextEdit, expectedVersion: string): Promise<FileMutationResult>
  rename(from: string, to: string, expectedVersion: string): Promise<RenameResult>
  delete(path: string, expectedVersion: string): Promise<DeleteResult>
}
```

- `FileMutationResult` always contains the new SHA-256 version.
- Agent tools in Phase 4 delegate exclusively to this service.

- [ ] **Step 1: Write CRUD/version conflict tests**

Cover create-no-overwrite, exact edit, zero/multiple match rejection, rename collision, delete version mismatch, and atomic-write cleanup. Example:

```ts
const read = await service.read('spec.md')
await writeFile(join(root, 'spec.md'), '# External\n')
await expect(service.edit('spec.md', { oldText: '# Old', newText: '# New' }, read.version))
  .rejects.toMatchObject({ code: 'VERSION_CONFLICT' })
```

Run and expect module-not-found failure.

- [ ] **Step 2: Implement content versions and atomic writes**

Version is `sha256(file bytes)`. Atomic write creates `.<basename>.<uuid>.draftmd-tmp` in the same directory with mode inherited from existing file or `0o600`, `fsync`s the file, renames it, and best-effort `fsync`s the parent. Clean temp files on failure.

- [ ] **Step 3: Implement exact text edits**

`TextEdit` is:

```ts
const TextEditSchema = z.object({
  oldText: z.string().min(1),
  newText: z.string(),
  expectedOccurrences: z.literal(1).default(1),
}).strict()
```

Reject no match as `EDIT_TARGET_NOT_FOUND` and multiple matches as `EDIT_TARGET_AMBIGUOUS`; do not guess.

- [ ] **Step 4: Implement bounded listing and lexical search**

Recursively list up to 1,000 Markdown files, skip hidden directories, `.git`, `node_modules`, and snapshot/temp artifacts. Return relative POSIX paths, byte size, mtime, and version only when read. `search()` scans UTF-8 text, returns at most 50 matches with file, line, heading path, and 2 surrounding lines. Abort when `AbortSignal` fires.

- [ ] **Step 5: Verify CRUD and 1,000-file behavior**

Run integration tests including a generated 1,000-file fixture and assert list/search finish without loading file contents into renderer. Run typecheck.

- [ ] **Step 6: Commit when authorized**

```bash
git add src/main/workspace src/shared/contracts tests/integration/workspace tests/fixtures

git commit -m "feat: add versioned Markdown workspace service"
```

---

### Task 3: Open Folder as the Workspace and Persist Recent Workspaces

**Files:**
- Create: `src/main/workspace/workspace-manager.ts`
- Create: `src/main/workspace/recent-workspaces.ts`
- Modify: `src/main/app/menu.ts`
- Modify: `src/main/app/ipc.ts`
- Modify: `src/main/app/window-manager.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/app/file-panel-controller.ts`
- Create: `tests/unit/workspace/recent-workspaces.test.ts`
- Create: `tests/e2e/workspace.spec.ts`

**Interfaces:**
- Produces: `WorkspaceManager.openFolder(window)`, `current(windowId)`, `close(windowId)`, and renderer events `workspace:opened`, `workspace:files-changed`.
- Session repositories use the stable workspace ID, not absolute path as a foreign key.

- [ ] **Step 1: Write recent workspace tests**

Test dedupe, max 10, stale folder pruning, and blank normal launch. Unlike ColaMD, normal startup must not automatically reopen a document; recent workspaces are explicit menu choices.

- [ ] **Step 2: Implement folder chooser and manager**

Use `dialog.showOpenDialog({ properties: ['openDirectory'] })`. Canonicalize the selected folder, create its descriptor, update native recent documents only if appropriate, and attach one workspace per app window.

- [ ] **Step 3: Replace sibling-file browsing with workspace browsing**

File panel displays recursive folders and Markdown files rooted at the selected workspace. It cannot browse above root. Opening a file uses its workspace-relative path. External additions/deletions refresh through one debounced workspace watcher.

- [ ] **Step 4: Add E2E workspace isolation test**

Launch with a fixture workspace, assert files outside the selected folder never appear, create a Markdown file externally and observe it, then delete it and observe removal.

- [ ] **Step 5: Verify**

Run unit, integration, E2E workspace tests, typecheck, and build.

- [ ] **Step 6: Commit when authorized**

```bash
git add src/main/workspace src/main/app src/preload src/renderer tests

git commit -m "feat: make folders first-class workspaces"
```

---

### Task 4: Add SQLite Migrations and Repositories

**Files:**
- Create: `src/main/persistence/database.ts`
- Create: `src/main/persistence/migrations/001_initial.sql`
- Create: `src/main/persistence/migrate.ts`
- Create: `src/main/persistence/workspace-repository.ts`
- Create: `src/main/persistence/session-repository.ts`
- Create: `src/main/persistence/task-repository.ts`
- Create: `src/main/persistence/message-repository.ts`
- Create: `src/shared/contracts/session.ts`
- Create: `tests/integration/persistence/repositories.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces repositories for `workspaces`, `sessions`, `messages`, `tasks`, `tool_activities`, `file_changes`, `provider_configs` (non-secret fields only), and `schema_migrations`.
- All IDs are application-generated UUIDv7 strings; timestamps are ISO-8601 UTC strings.

- [ ] **Step 1: Install SQLite and write migration tests**

Install `better-sqlite3@^13.0.3` and `@electron/rebuild@^4.2.0`. Test empty DB migration, idempotent second startup, foreign keys enabled, WAL mode, and rollback on invalid migration.

- [ ] **Step 2: Define the initial schema**

`001_initial.sql` creates normalized tables with `ON DELETE CASCADE` from workspace → session → task/message/activity/change. Task status has a CHECK constraint for the nine specified states. Provider configs store `credential_ref`, never secret text.

- [ ] **Step 3: Implement database open and recovery isolation**

`openDatabase(path)` sets WAL, `foreign_keys=ON`, and `busy_timeout=5000`. If migration/open fails, rename database to `draftmd.corrupt.<timestamp>.sqlite`, create a new DB, return a recovery warning, and leave Markdown editing available.

- [ ] **Step 4: Implement repositories with transactions**

Expose explicit methods, not arbitrary SQL. `TaskRepository.transition(id, from, to)` updates only when current status matches, returning `false` on races. Messages preserve provider-neutral serialized content and model switch markers.

- [ ] **Step 5: Verify Electron native-module packaging**

Add `postinstall: electron-builder install-app-deps` and run:

```bash
npm install
npm run test:integration -- tests/integration/persistence
npm run build
npx electron-builder install-app-deps
```

Expected: repository tests pass and native module loads under Electron 44.

- [ ] **Step 6: Commit when authorized**

```bash
git add package.json package-lock.json src/main/persistence src/shared/contracts/session.ts tests/integration/persistence

git commit -m "feat: persist DraftMD sessions and tasks"
```

---

### Task 5: Add macOS Keychain Credential Store

**Files:**
- Create: `src/main/credentials/credential-store.ts`
- Create: `src/main/credentials/keyring-credential-store.ts`
- Create: `src/main/credentials/in-memory-credential-store.ts`
- Create: `tests/unit/credentials/credential-store.test.ts`
- Create: `tests/integration/credentials/keyring.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces:

```ts
interface CredentialStore {
  set(ref: string, secret: string): Promise<void>
  get(ref: string): Promise<string | null>
  delete(ref: string): Promise<boolean>
}
```

- Service name is exactly `app.draftmd.desktop`; account/ref is a random UUID, never provider name or email.
- Provider configuration service in Phase 3 consumes only this interface.

- [ ] **Step 1: Write contract tests against the in-memory implementation**

Test set/get/delete, overwrite, absent value, and no secret exposure in object serialization.

- [ ] **Step 2: Install and wrap `@napi-rs/keyring`**

Install `@napi-rs/keyring@^2.0.0`. Implement with `new Entry('app.draftmd.desktop', ref)`. Wrap native errors into codes `KEYCHAIN_DENIED`, `KEYCHAIN_UNAVAILABLE`, and `KEYCHAIN_ITEM_NOT_FOUND`; do not include the secret in error objects.

- [ ] **Step 3: Add opt-in integration test**

The Keychain test runs only when `DRAFTMD_RUN_KEYCHAIN_TESTS=1`, creates a random ref and value, verifies round-trip, and deletes in `finally`. Default CI uses in-memory store and does not prompt.

- [ ] **Step 4: Verify packaging and secret redaction**

Run unit tests and build. Grep the SQLite fixture and logs for the known test secret and assert zero matches.

- [ ] **Step 5: Commit when authorized**

```bash
git add package.json package-lock.json src/main/credentials tests/unit/credentials tests/integration/credentials

git commit -m "feat: store provider secrets in macOS Keychain"
```

---

### Task 6: Add Task Baselines, Diff, and Conflict-Aware Undo

**Files:**
- Create: `src/main/changes/snapshot-store.ts`
- Create: `src/main/changes/change-set-service.ts`
- Create: `src/main/changes/diff-service.ts`
- Create: `src/main/changes/undo-service.ts`
- Create: `src/shared/contracts/changes.ts`
- Create: `tests/integration/changes/change-set.test.ts`
- Create: `tests/integration/changes/undo.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces:

```ts
interface ChangeSetService {
  begin(taskId: string, workspace: WorkspaceDescriptor): Promise<TaskBaseline>
  finalize(taskId: string): Promise<ChangeSet>
}

interface UndoService {
  undo(taskId: string): Promise<UndoResult>
}
```

- `ChangeSet` contains per-file `created | modified | renamed | deleted`, old/new versions, unified Diff, and line counts.
- Agent Runtime starts/finalizes all mutating tasks through this service.

- [ ] **Step 1: Write change-set tests**

Cover unchanged task, modify, create, rename, delete, and partial task. Snapshot metadata maps relative path to version and baseline blob path. Baseline contents are stored with mode `0o600` beneath `<snapshots>/<workspaceId>/<taskId>`.

- [ ] **Step 2: Implement final Diff**

Install `diff@^9.0.0`. Generate unified patches from baseline to final text with context 3 and labels `a/<path>`, `b/<path>`. Diff is computed in main process and returned as structured hunks plus text; renderer never reads snapshots.

- [ ] **Step 3: Write undo tests including post-task edits**

Cases:

- unchanged after task → exact restore;
- created then untouched → remove;
- created then hand-edited → conflict;
- modified then hand-edited in unrelated lines → successful three-way merge;
- overlapping hand edit → conflict markers are never written automatically;
- deleted → restore from baseline;
- renamed → restore only when both paths are safe.

- [ ] **Step 4: Implement three-way merge**

Install `node-diff3@^3.1.2`. Use baseline as ancestor, task final as one side, current disk as the other. Only write if merge reports no conflict. On conflict, return `{ status: 'conflict', files: [{ path, base, taskFinal, current }] }` and leave disk unchanged.

- [ ] **Step 5: Add retention cleanup**

Keep snapshots referenced by tasks. Purge unreferenced snapshots older than 30 days on idle startup; never purge snapshots for nonterminal tasks or tasks not yet marked undone. Cleanup errors are logged without blocking startup.

- [ ] **Step 6: Verify**

Run:

```bash
npm run test:integration -- tests/integration/changes
npm run typecheck
npm run build
git diff --check
```

Expected: all mutation and undo scenarios pass.

- [ ] **Step 7: Commit when authorized**

```bash
git add package.json package-lock.json src/main/changes src/shared/contracts/changes.ts tests/integration/changes

git commit -m "feat: add task Diff and safe undo core"
```
