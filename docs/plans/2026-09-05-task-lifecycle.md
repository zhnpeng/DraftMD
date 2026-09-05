# Task Lifecycle Implementation Plan

**Goal:** Keep running requests controllable across conversation navigation, protect active conversations from deletion, and stream/cancel chat-only requests.

**Architecture:** Extend the existing runtime registry with session ownership and a transient event snapshot. Session history includes the initial messages and live events for an owned running request, so the renderer can restore its state without duplicate persisted messages. Reject deletion and overlapping requests while a session/window is active, including asynchronous preparation. Chat uses the same task handle and event channel without filesystem tools or snapshots.

**Tech Stack:** TypeScript, Electron IPC/Zod, SQLite, Vitest, Playwright.

The user authorized the next reliability increment after the project review. Work stays in this workspace without publishing or making commits.

## Decisions

- Preserve conversation navigation while requests run. Disabling navigation would be smaller but would prevent users from consulting prior conversations.
- Reject deletion of active sessions; cancelling then deleting would discard the completed task's recovery/undo entry.
- Reuse task events for chat. A second chat-specific IPC channel would duplicate cancellation and window ownership handling.
- Keep only transient live history in memory; completed requests use persisted messages as before.

## Tasks

- [x] Add regression tests for active-session snapshots, preparation/deletion guards, and chat streaming/cancellation. Run focused Vitest tests and confirm failures.
- [x] Implement registry snapshots and service guards in `src/main/agent/runtime-registry.ts`, `agent-app-service.ts`, and `src/shared/contracts/agent.ts`.
- [x] Add managed chat handles in `src/main/agent/chat-runtime.ts`; connect them in `src/main/index.ts`. Retain zero tools and no document snapshots.
- [x] Restore live state in `src/renderer/agent/agent-dock-app.ts`, buffer events during history/start requests, and prevent overlapping sends. Show localized active-session deletion feedback.
- [x] Add Electron regressions in `tests/e2e/task-lifecycle.spec.ts` for navigation, deletion, streaming, cancellation, and window close; use a deterministic loopback provider.
- [x] Run focused checks, then `npm run typecheck`, `npm run test`, `npm run test:e2e`, `npm run test:security`, `npm run check:theme-colors`, and `git diff --check`. Review final diff.

## Deferred Follow-up

Snapshot retention, PR CI, document consolidation, real-provider validation, and signed platform validation remain subsequent increments from the review.

Snapshot retention, PR CI, and document consolidation are now tracked in the [maintenance increment](2026-09-05-maintenance.md). Real-provider and signed platform validation remain release work.

## Review Notes

- Independent review identified model-switch markers disappearing from the frozen live history. Active sessions now reject model changes, and the model picker remains disabled until completion.
- Slow-stream Electron tests exposed an unbound animation-frame callback; browser methods now retain their Window receiver.
- Approval restoration exposed clipped action buttons. Pending approvals now have reserved space and their own scroll area within the dock.

## Verification Results

- Typecheck passed.
- Vitest: 684 passed, 1 opt-in macOS Keychain test skipped.
- Full Electron E2E: 38 passed, including four new lifecycle journeys.
- Final layout/accessibility checks: 10 passed; screenshots inspected at 960x720 and 800x600.
- Final request-start sequencing checks: 9 passed across lifecycle, sessions, agent task flow, and chat-only acceptance.
- Security: 35 Vitest tests and 2 Electron sandbox tests passed.
- Production builds and the 12-theme color contract passed; `git diff --check` passed.
- No live paid-provider requests, signing, packaging, publication, or commits were performed.
