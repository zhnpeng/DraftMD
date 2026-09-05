# DraftMD Maintenance Plan

Scope authorized by the user's instruction to continue the project recommendations.

## Design

- Run snapshot maintenance asynchronously after successful interrupted-task recovery.
- Keep every snapshot referenced by any persisted task, regardless of workspace or status.
- Remove only unreferenced snapshot directories whose modification time is more than 30 days old.
- Skip deletion when database recovery/fallback is reported or a quarantined database backup remains. Log safe diagnostic codes on skipped/failed cleanup without blocking startup.
- Run the existing quality gates on macOS / Node 24 for branch pushes and PRs without packaging or publishing.
- Describe current DraftMD behavior in contributor and product docs; archive inherited ColaMD requests with provenance. Keep historical release evidence intact.

## Execution

- [x] Add retention regression tests, observe failure, implement and wire startup cleanup.
- [x] Add and validate the regular CI workflow.
- [x] Reconcile current documentation and record remaining release work.
- [x] Review deletion safety and run type, test, Electron, security, performance, build, theme, and whitespace checks.

## Validation

Retention red/green checks passed: eight filesystem/SQLite integration tests and two Electron startup tests. They cover all-task references, the exact age boundary, session deletion, startup ordering, database quarantine across launches, and failure handling. The first Electron run failed because startup had no cleanup wiring; both tests passed after wiring.

Independent review found no blocking retention issue. Its whitespace-check finding is addressed by comparing PR/push changes against their base SHA in CI, fetching history for that comparison.

CI YAML was parsed with js-yaml and all shell steps passed bash syntax validation. Required gates, trigger scopes, permissions, and absence of publishing steps were checked. All 64 local links in the ten updated product/contributor documents resolve.

Final local verification includes the previous lifecycle changes:

- Typecheck passed.
- Vitest: 692 passed, one opt-in real Keychain test skipped.
- Integration: 133 passed, the same Keychain test skipped. These tests overlap the full Vitest suite.
- Electron E2E: 40 passed, including both new startup retention journeys.
- Security: 35 Vitest tests and two Electron tests passed.
- Performance: three Vitest tests and two Electron tests passed using the existing CI budgets (startup baseline 900 ms, edit budget 2000 ms, long-task budget 3000 ms). Cold-start renderer-ready median was 202 ms; editing a 5 MiB document took approximately 196 ms, with a maximum recorded renderer long task of 852 ms.
- Production builds completed successfully in the Electron test setup. Existing dependency annotation warnings remain non-fatal.
- The 12-theme contract and whitespace checks passed.
- Archived upstream requests retain their original body, with only the archive heading/notice and a final newline added.

No commits, pushes, signing, packaging, paid-provider requests, or publication were performed. The workflow was validated locally; hosted CI and repository branch protection have not been exercised or configured in this increment. See the [current roadmap](../roadmap.md) for remaining release validation.
