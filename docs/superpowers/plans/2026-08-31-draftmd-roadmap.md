# DraftMD MVP Delivery Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver DraftMD as a reliable, open-source, macOS-only AI Markdown editor by evolving the ColaMD codebase through six independently testable increments.

**Architecture:** Preserve Milkdown and proven document behavior, but split the monolithic Electron main process into explicit services. The renderer communicates only through a typed, validated preload bridge; the main process owns workspace access, SQLite, Keychain, provider SDKs, the Agent loop, snapshots, and recovery.

**Tech Stack:** Electron 44, electron-vite 5, TypeScript 7, Milkdown 7, Vitest 4, Playwright 1.62, Zod 4, better-sqlite3 13, `@napi-rs/keyring` 2, `@anthropic-ai/sdk` 0.122, `openai` 7.8, `diff` 9, node-diff3 3.1.

**Spec:** `docs/superpowers/specs/2026-08-31-draftmd-product-design.md`

## Global Constraints

- Support only macOS 13 Ventura and newer; ship one Universal DMG/ZIP for Apple Silicon and Intel.
- Keep `contextIsolation: true` and `nodeIntegration: false`; renderer never receives credentials or direct filesystem access.
- Agent access is restricted to the explicitly opened workspace and `.md`/`.markdown` files; reject absolute paths, traversal, symlink escapes, and extension disguises.
- Do not add Shell, code execution, web, URL fetch, MCP, cloud sync, accounts, embeddings, or non-Markdown editing.
- Normal AI edits write directly; every task produces a final Diff and task-level undo. Deletion always waits for explicit confirmation.
- Keep the editor fully usable when no provider is configured or a provider fails.
- Persist conversations and task metadata locally in SQLite; persist secrets only in macOS Keychain.
- Provide Simplified Chinese and English from the first UI increment; no user-facing string may be introduced outside the message catalog.
- Preserve ColaMD's MIT notice and add a clear DraftMD copyright/license notice.
- Use TDD for every behavior change and run typecheck, unit tests, build, and `git diff --check` at every phase gate.

---

## Delivery Order

| Phase | Plan | Independently testable outcome | Depends on |
| --- | --- | --- | --- |
| 1 | `2026-08-31-draftmd-foundation.md` | Branded, macOS-only DraftMD editor with CI, tests, i18n, and focused process modules | ColaMD source |
| 2 | `2026-08-31-draftmd-local-data.md` | Secure folder workspace, SQLite sessions/tasks, Keychain abstraction, snapshots, Diff, and undo core | Phase 1 |
| 3 | `2026-08-31-draftmd-providers.md` | Anthropic, OpenAI, and compatible provider configurations with streaming and capability tests | Phase 2 |
| 4 | `2026-08-31-draftmd-agent-runtime.md` | Cancellable Markdown-only tool loop with limits, conflict checks, delete approval, and recovery | Phase 3 |
| 5 | `2026-08-31-draftmd-agent-ui.md` | Bottom task dock, persistent sessions, selection references, activity, Diff, deletion approval, and undo | Phase 4 |
| 6 | `2026-08-31-draftmd-release-hardening.md` | Full E2E coverage, performance/security gates, recovery, signed-release workflow, and docs | Phase 5 |

## Cross-Phase File Map

```text
src/
├── shared/
│   ├── contracts/          # IPC/domain Zod schemas and serializable types
│   └── i18n/               # zh-CN/en catalogs and translator
├── main/
│   ├── app/                # lifecycle, windows, menus, IPC registration
│   ├── workspace/          # path guard, file CRUD, indexing, watchers
│   ├── persistence/        # SQLite migrations and repositories
│   ├── credentials/        # Keychain wrapper
│   ├── changes/            # snapshots, Diff, undo, merge
│   ├── providers/          # provider adapters and config/capability service
│   ├── agent/              # tools, prompt, loop, limits, approvals
│   ├── export/             # retained PDF/HTML exporters
│   └── index.ts            # composition root only
├── preload/
│   └── index.ts            # narrow validated bridge
└── renderer/
    ├── editor/             # retained Milkdown editor + selection adapter
    ├── app/                # renderer state coordination
    ├── agent/              # task dock, sessions, messages, activities, Diff
    ├── settings/           # language and provider settings
    ├── themes/             # retained themes + task dock tokens
    └── main.ts             # renderer composition root only

tests/
├── unit/                   # pure services and repositories
├── integration/            # temp workspace/database/provider loop tests
├── e2e/                    # Electron user journeys
├── fixtures/               # Markdown workspaces and provider responses
└── helpers/                # temp dirs, fake clocks, mock provider server
```

## Phase Gates

Each phase ends with:

```bash
npm run typecheck
npm run test
npm run build
npm run check:theme-colors
git diff --check
```

Additional gates begin when their infrastructure exists:

```bash
npm run test:integration   # Phase 2 onward
npm run test:e2e           # Phase 5 onward
npm run dist:mac           # Phase 6 release candidate
```

A failing gate blocks the next phase. Do not skip a failing test as “pre-existing” without recording the exact failure and confirming it on the untouched ColaMD baseline.

## Commit Discipline

- Initialize a local Git repository in `mdassit` after copying the ColaMD working tree without its `.git` directory.
- Make one commit per task, using the commit command written in the phase plan.
- Never push, publish a release, create a remote, or spend real LLM API money without explicit authorization.
- Do not copy `.superpowers/` into commits; add it and `artifacts/` to `.gitignore`.

## Execution Decision

The user authorized direct execution with minimal interruption. Execute inline with `superpowers:executing-plans`, one phase at a time, and pause only for:

- destructive operations outside the new DraftMD working tree;
- paid live-provider tests;
- Apple signing/notarization credentials;
- a required decision that changes the confirmed product scope;
- a blocker that prevents completing the current phase under any reasonable default.
