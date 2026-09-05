# Runtime Boundary Fixes

The user authorized autonomous continuation of release reliability work.

## Confirmed Problems

- Provider saves retain the old capability even when the endpoint, model, transport options, or credential references change.
- Capability probes persist by ID only, allowing an in-flight result to overwrite a subsequently edited configuration.
- The production composition passes ELECTRON_RENDERER_URL to the window manager even for packaged apps. The test launcher already clears it, but production also needs to ignore it.

## Design

Compare the request-affecting provider fields and credential references with a shared main-process helper. Changing these fields invalidates capability and all test metadata; renaming and changing the default do not. Persist probe results transactionally only if the current connection matches the tested snapshot. A discarded result is returned as cancelled so the UI cannot advertise a stale success. No database migration or secret-value persistence is needed.

Gate the renderer URL at application composition using app.isPackaged. Add a packaged test that launches the binary directly with a development URL, independently of the helper's environment sanitization.

## Tasks

- [x] Reproduce stale capability and stale in-flight persistence with SQLite regression tests.
- [x] Implement connection comparison, invalidation, and conditional probe persistence.
- [x] Reproduce and fix production renderer URL selection; verify development behavior stays available.
- [x] Run provider and Electron regressions, review the changes, and rebuild a separate candidate for packaged verification.
- [x] Record verification and update the current roadmap without rewriting earlier artifact reports.

## Progress

Fifteen regression cases failed before the provider fix; the provider suites then passed 38 tests. Both Electron revalidation journeys passed: switching from an Agent endpoint to a chat-only endpoint requires a fresh probe, and an old timeout cannot overwrite a new successful result for a different connection.

The previous local candidate failed a direct packaged launch with ELECTRON_RENDERER_URL: it opened the supplied loopback page. The composition now ignores that variable when app.isPackaged is true. A new candidate will be built under `release/runtime-boundaries-20260905/` to verify the fix while preserving the previous candidate and its report.

Independent review found no blocking issue. The persistence guarantee is connection-snapshot equality at write time, not latest-probe priority: overlapping probes for the same connection retain completion-order semantics, and a configuration changed from A to B and back to A can accept a matching A result. No configuration revision or request sequence was added in this increment.

Source verification passed: application typecheck, strict checks of the new test files, 713 Vitest tests (one opt-in Keychain test skipped), 42 Electron E2E tests, 35 security unit tests plus two Electron security tests, three performance unit tests plus two Electron performance tests, and the twelve-theme contract. The current local development-build startup median is 201 ms and the 5 MiB edit is approximately 202 ms.

Final packaged acceptance passed all 15 tests. Visual inspection found the approval viewport test was targeting a startup changelog window; an explicit viewport assertion reproduced the mistake before switching to the document page's BrowserWindow. The corrected 800x600 packaged screenshot was inspected and the full packaged suite passed again.

Universal/native/notice validation, Rosetta x64 queries, ZIP CRC checks, and matching app payloads across app/ZIP/DMG all passed. Artifact hashes and scope limitations are in the [candidate report](../reports/2026-09-05-runtime-boundaries-candidate.md). No previous candidate was overwritten and nothing was published.
