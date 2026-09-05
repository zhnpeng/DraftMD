# Packaged Acceptance Implementation Plan

**Goal:** Verify the current unreleased fixes inside an actual Universal macOS app and make that verification repeatable.

**Architecture:** Reuse existing Electron journeys with an explicit packaged-app launch mode and a separate Playwright configuration. Use Electron's standard user-data-dir switch with a runtime isolation assertion; keep production test-mode restrictions intact. Allow the Universal verifier to target a separate artifact directory so prior release binaries remain intact.

**Tech Stack:** Electron, Playwright, Vitest, electron-builder, macOS lipo.

The user authorized autonomous continuation. No remote publication or signing is part of this increment.

## Environment Findings

- No OpenAI/Anthropic or Apple release credentials are configured in the current environment variables.
- Ollama and LM Studio are not installed at the standard Applications paths and their default loopback services are unavailable.
- Existing Preview 5 artifacts will be preserved. Build the current tree into `release/maintenance-20260905/` without changing the package version.
- Physical Intel and macOS 13 runtime validation remain external requirements.

## Tasks

- [x] Add regression coverage for packaged launch selection and alternate artifact verification; observe failures before implementation.
- [x] Extend `tests/helpers/electron-app.ts` and `scripts/verify-universal.js`, add `playwright.packaged.config.ts` and `test:packaged`.
- [x] Build the unsigned Universal candidate into the separate output directory and verify native modules and legal notices.
- [x] Run packaged editor, Diff/Undo, lifecycle, and snapshot retention journeys using loopback fixtures.
- [x] Add the packaged gate after Universal verification in the release workflow and document local usage.
- [x] Review isolation and gate behavior, run relevant regression checks, and record artifact evidence and remaining limitations.

## Verification

The old Preview 5 bundle fails the new retention journey because expired orphan snapshots remain. The new candidate passed all 11 reused acceptance journeys. Independent review then identified two helper isolation gaps: caller-supplied profiles outside the temp root and inherited development renderer URLs. Both have failing regression evidence and are addressed before final acceptance. The helper now validates canonical profile containment before preparation, removes the development URL from the final packaged environment, and checks matched renderer pages reside within the selected bundle. The expanded packaged suite has 12 journeys.

The Universal executable and native package layout pass verification. Native SQLite and Keychain modules load on arm64, and the x64 modules load with a successful SQLite query under Rosetta. ZIP CRC validation passes, and app.asar matches across the unpacked app, ZIP, and read-only mounted DMG. This does not establish physical Intel or macOS 13 compatibility.

One concurrent development verification run failed because two build processes modified dist simultaneously. Build-producing checks are subsequently run serially; no product change is attributed to that test-orchestration failure.

Final verification: application and test-helper typechecks passed; 697 default Vitest tests passed and the skipped real Keychain test passed when separately enabled; 40 development Electron journeys, 12 packaged journeys, 35 security unit tests, two security Electron tests, three performance unit tests, and two performance Electron tests passed. Theme, workflow, and whitespace checks passed. Independent re-review confirmed the isolation fixes with no remaining blocking findings.

Artifact hashes, local measurements, environment findings, and remaining release limitations are recorded in the [local candidate report](../reports/2026-09-05-local-candidate.md). No commits, pushes, remote CI runs, signing, uploads, or publication occurred.
