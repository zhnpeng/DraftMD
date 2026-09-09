# DraftMD Current Status and Roadmap

Updated 2026-09-08 for source version `0.1.1`. Consult the [release notes](releases/v0.1.1.md) for changes and installation limits, and [GitHub Releases](https://github.com/zhnpeng/DraftMD/releases) for published downloads.

## Implemented MVP Areas

- macOS visual and source Markdown editing, external file synchronization, unsaved-edit protection, outline, twelve themes, and PDF/HTML export.
- Folder workspaces, Markdown navigation, local sessions and task history in SQLite.
- Anthropic, OpenAI, and OpenAI-compatible provider adapters, capability testing, and Keychain credential storage.
- Agent file tools scoped to the workspace, document/selection context, streaming task activity, deletion approval, and cancellation. Chat-only models have no file tools.
- Task snapshots, file change summaries and Diff, conflict-aware Undo, and interrupted-task recovery.
- Typed IPC boundaries, safe diagnostics, automated security and performance checks, and Universal packaging configuration.

These areas have implementations and automated coverage. They do not replace the release validation below.

## 0.1.1 Release

The owner completed personal use and authorized a fresh unsigned macOS-only regular release on 2026-09-08, lifting the earlier publication hold. See the [release checklist](release-checklist.md) and the tag's GitHub Actions run for publication and validation status. Previous drafts are not republished.

- Add Responses API alongside Chat Completions, provider-aware model suggestions and model-list synchronization.
- Move the Agent into a resizable right sidebar and keep exported documents free of application chrome.
- Add per-provider reasoning effort with model-aware choices, persistence and matching capability probes.
- Automatically reveal the root file list when opening a workspace, while preserving manual collapse during background refreshes.
- Keep multi-megabyte source editing responsive with a lazy-loaded viewport-rendered text surface while preserving exact content and the existing save/conflict pipeline; restore Open Folder when all macOS windows are closed.
- Include Windows x64 runtime adaptation, native packaging and candidate CI in source only. Windows runtime/installer acceptance remains outstanding; see [Windows acceptance](windows.md).

## 0.1.0 Maintenance History

- Restore running Agent and Chat tasks when switching conversations, including pending approvals and streamed output.
- Prevent active conversation deletion and model switching that would invalidate running tasks; cancel provider requests on Stop or window close.
- Keep approval actions accessible in smaller windows.
- Clean up unreferenced snapshot directories older than 30 days after successful startup recovery. Preserve all task references and suspend cleanup when database recovery may have lost references. See [retention rules](privacy.md#snapshot-retention).
- Add ordinary push/PR checks on macOS with Node.js 24, covering type checks, tests, security, performance, builds, themes, and whitespace.
- Align current product and contributor docs with DraftMD, preserving inherited requests in an [upstream archive](archive/colamd-feature-requests.md).
- Run repeatable acceptance against the actual packaged `.app`, with isolated profiles and bundled-renderer checks. Release CI now requires packaged acceptance after Universal verification and before artifact upload.
- Invalidate provider capability when connection settings or credential references change, and discard probe results whose tested connection no longer matches the saved configuration.
- Ignore development renderer URLs in the production app itself, keeping packaged windows on bundled pages.

Execution and local verification are recorded in the [task lifecycle plan](plans/2026-09-05-task-lifecycle.md), [maintenance plan](plans/2026-09-05-maintenance.md), [packaged acceptance plan](plans/2026-09-05-packaged-acceptance.md), and [runtime boundary plan](plans/2026-09-05-runtime-boundaries.md). Historical unsigned local candidates remain under `release/runtime-boundaries-20260905/` and `release/maintenance-20260905/`. Both used the Preview 5 source version but differ from its published binary. The 0.1.0 release workflow builds fresh artifacts from the release tag.

The [latest candidate report](reports/2026-09-05-runtime-boundaries-candidate.md) records fifteen packaged acceptance journeys, artifact hashes, architecture/native-module checks, and remaining limitations. The [initial local candidate acceptance report](reports/2026-09-05-local-candidate.md) remains a historical record of the earlier candidate.

## Remaining Validation

1. Validate real Anthropic and OpenAI requests, tool calls, cancellation, deletion approval, and Undo. Record the exact service/model combinations; these calls may incur charges.
2. Run manual Ollama and LM Studio checks against installed services and selected models. Capability labels are conditional on the model and endpoint, not universal provider guarantees.
3. Run the packaged Universal app on a physical Intel Mac and on macOS 13. Architecture inspection alone is insufficient runtime evidence.
4. For a future signed distribution, configure Apple Developer ID signing and notarization credentials, produce a signed candidate, and verify stapling and normal Gatekeeper installation. Signing is not required for the current unsigned GitHub Release.
5. Configure branch protection as needed. Hosted CI and release results are recorded in GitHub Actions for each commit and tag.

Automatic updates remain disabled until a validated release channel is configured. Version 0.1.1 targets an unsigned regular GitHub Release; confirm published downloads on GitHub. The dated [release checklist](release-checklist.md) preserves the earlier candidate's evidence and is not a fresh acceptance report for this source tree.

## Later Product Work

Candidates are listed in [feature requests](feature-requests.md). Priorities include macOS reliability and Windows x64 candidate validation. Word/image export, Linux/mobile/Web, multiwindow product workflows, custom theme import, cloud collaboration, shell/web tools, and MCP remain outside scope.

## Planning History

The [product design](superpowers/specs/2026-08-31-draftmd-product-design.md) and [six-phase implementation roadmap](superpowers/plans/2026-08-31-draftmd-roadmap.md) explain the original design. Their historical task checkboxes are not an up-to-date list of unfinished implementation. Use this page for current priorities and individual execution records for verification evidence.
