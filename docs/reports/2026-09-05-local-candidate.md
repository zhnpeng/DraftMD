# Local Universal Candidate Acceptance

Date: 2026-09-05. Host: macOS 26.6.2, Apple silicon.

This is an unsigned local candidate containing the current uncommitted lifecycle and maintenance changes, based on commit `ffc6282a84405a745ddc50b440191d6f46a8cc6b`. Its source version remains `0.1.0-preview.5`. It is distinct from the published Preview 5 artifacts, which were preserved. This report does not declare the candidate ready for a signed production release.

## Artifacts

Local output directory: `release/maintenance-20260905/`.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `DraftMD-0.1.0-preview.5-universal.dmg` | 235161913 | `81c4d945dab591db5389a9b37c0ad47f8d3f91a32a0926e7cb89200153fb4777` |
| `DraftMD-0.1.0-preview.5-universal-mac.zip` | 234089559 | `9d60e4258d4a25bab0be222e8ca3cb2edc127d64549d85d36a6d26a0cf57dfff` |

The unpacked app is `mac-universal/DraftMD.app` within that directory. Its `app.asar` SHA-256 is `9db7b1cdf6c6eb536a55cd1bd67aa682dcd904dbeb8472f7050f88226199bc03`. The same payload was verified in the ZIP and a read-only mounted DMG; ZIP CRC validation passed. The DMG was detached after verification.

## Packaged Verification

- The main executable contains arm64 and x86_64 slices. Native package layout, architecture checks, absence of runtime symlinks, and bundled LICENSE/NOTICE checks passed.
- Native Keychain and SQLite modules loaded in the host architecture. The same packaged modules also loaded under Rosetta x64, where an in-memory SQLite query succeeded.
- Twelve packaged acceptance journeys passed: editing, document replacement/undo, LaTeX layout, per-file Diff and exact task Undo, conflict preservation, startup snapshot cleanup, quarantine protection, active-session navigation/approval/deletion guards, chat streaming/Stop/window-close cancellation, and bundled-renderer isolation.
- The test launcher verifies actual packaged mode and a canonical temporary profile. It rejects unsafe profiles before writing fixture data, removes development renderer URL overrides, and checks matched renderer pages are inside the selected bundle.
- The previous Preview 5 app failed the new orphan-snapshot cleanup journey as expected; the current candidate passed it. This establishes that the test distinguishes the new behavior from the old binary.
- Independent review found two test-isolation gaps; both have regression coverage and were fixed and re-reviewed without remaining blocking findings.

## Source Regression Checks

- Application typecheck and a separate strict typecheck of the modified test helper and packaged Playwright config passed.
- Full Vitest: 697 passed, one opt-in Keychain test skipped by default. That real Keychain test was then explicitly enabled and passed its write/read/delete round trip; the disposable credential was removed.
- Development Electron E2E: 40 passed.
- Security: 35 Vitest tests and two Electron sandbox tests passed.
- Performance: three Vitest tests and two Electron tests passed with the existing CI budgets. Cold-start renderer-ready median was 209 ms; editing the 5 MiB fixture took approximately 202 ms, with a maximum recorded renderer long task of 854 ms. These are local development-build measurements, not physical Intel measurements.
- Production builds, twelve-theme checks, release workflow YAML/shell checks, and whitespace checks passed.

Commands that rebuild `dist` must run serially. An initial concurrent test run had a build-output race; the full suite was subsequently rerun successfully without overlapping builds.

## Remaining Validation

- Live Anthropic/OpenAI requests were not run; their API keys are absent from the current environment variables.
- Ollama/LM Studio are absent from the standard Applications paths and their default loopback services were unavailable. No models were downloaded.
- Physical Intel and macOS 13 testing remain open. Rosetta and architecture inspection do not close those requirements.
- Apple release credentials are absent from the current environment variables. No Developer ID signing, notarization, stapling, or Gatekeeper acceptance is claimed.
- Nothing was committed, pushed, uploaded, or published. The release workflow's new packaged gate has been validated locally but has not run on GitHub in this increment.

Reproduction commands and isolation details are in [CONTRIBUTING.md](../../CONTRIBUTING.md#packaged-acceptance). Execution notes are in the [packaged acceptance plan](../plans/2026-09-05-packaged-acceptance.md); current priorities remain in the [roadmap](../roadmap.md).
