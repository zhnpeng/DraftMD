# DraftMD Release Checklist

## Publication Authorized — 2026-09-08

The owner reports successful personal use and explicitly authorizes committing and pushing the current work, creating `v0.1.1`, and publishing a regular unsigned macOS Universal release. This lifts the earlier hold and authorizes re-enabling the Release workflow. Build fresh artifacts from the tag and require the existing source, security, performance, Universal and packaged acceptance gates before publication. Do not republish the old drafts.

Windows remains source/candidate CI only, with no Windows assets attached to this release. Developer ID signing/notarization, physical Intel/macOS 13 validation and exhaustive real-service compatibility remain outstanding and must be disclosed, not inferred from personal use or automated fixtures.

## Historical Publication Hold — 2026-09-05

The owner withdrew public releases pending successful personal use. Both `v0.1.0` and `v0.1.0-preview.5` were converted to drafts, and the GitHub `Release` workflow was disabled. At the time of the hold, the unauthenticated GitHub Releases API reported zero public releases. Source, tags, draft assets, and local installations are retained.

At that time, publication and re-enabling the workflow required the owner to confirm successful personal use and explicitly request a public release. That condition was satisfied on 2026-09-08 as recorded above. Automated test results alone do not authorize publication. Local development, testing, and local installation may continue under the existing authorization. Build and verify a fresh candidate for the eventual first release.

## Historical Reports

The report below records the 2026-09-02 candidate and its original release policy. For the current source tree and remaining validation, see the [current roadmap](roadmap.md). The [0.1.0 release](releases/v0.1.0.md) uses the subsequently authorized unsigned GitHub distribution policy. Historical artifact hashes and validation claims here do not describe that release.

Use this checklist for a release candidate. Do not publish, tag, sign, notarize, or run paid-provider checks without the required authorization.

## RC verification report — 2026-09-02

**Decision: NOT RELEASE-READY.** The unsigned Universal candidate passes the available automated and local Apple Silicon checks, but release-blocking verification remains unavailable or unauthorized: a physical Intel Mac, macOS 13, signing/notarization, real Anthropic/OpenAI requests, Ollama, and LM Studio.

### Candidate and environment

- Candidate version: `0.1.0`, unsigned local Universal build.
- Host: macOS 26.5.2 (25F84), Apple M4, arm64.
- Runtime: Electron 44.1.0, Node.js 24.14.0, npm 11.9.0.
- App size: approximately 525 MiB unpacked.
- ZIP: 234,083,770 bytes; SHA-256 `9d827551bc2c4ddb4553c6b80996afb232b2f4d0b24d872bac070b28b5bf6112`.
- DMG: 235,156,699 bytes; SHA-256 `18bae35182fce4fa31e5143c118eee8d2e95ec1ea7f86f4ce8ded18485482201`.
- ZIP and DMG contain the same `app.asar`: SHA-256 `ca755b35083b873b4d68c8f8f4c940144861487ba8bd4782f01bc0feaeb0fe9e`.
- Main executable architectures: `x86_64 arm64`; `LSMinimumSystemVersion` is `13.0.0`.
- Candidate was not uploaded, tagged, signed with a Developer ID, notarized, or published.

### Automated gates

Fresh sequential gate run on 2026-09-02 through `git diff --check`, final exit code 0. Packaging and Universal verification were run separately on the same final product tree:

- [x] `npm ci` — 683 packages installed; `npm audit` reported 0 vulnerabilities.
- [x] `npm run typecheck`.
- [x] `npm run test` — 95 files passed, 1 skipped; 669 tests passed, 1 skipped.
- [x] `npm run test:integration` — 21 files passed, 1 skipped; 120 tests passed, 1 skipped.
- [x] `npm run test:security` — 35 Vitest tests and 2 Electron security tests passed.
- [x] `npm run test:e2e` — 34 Electron tests passed.
- [x] `npm run test:performance` — 3 workspace tests and 2 Electron performance tests passed.
- [x] `npm run build`.
- [x] `npm run check:theme-colors` — all 12 built-in/standalone themes passed.
- [x] `git diff --check`.
- [x] `npm run dist:mac` — unsigned Universal DMG and ZIP created with publishing disabled.
- [x] `npm run verify:universal` — executable, native module architectures, package roots, symlink policy, and Electron ABI loads passed.

Fresh performance evidence:

- 1,000-file workspace list p95: 11.67 ms (2,000 ms budget).
- 1,000-file workspace search p95: 53.53 ms (3,000 ms budget).
- 5 MiB document: ready 2,627.98 ms; edit 220.31 ms; save 1,099.72 ms; maximum Long Task 895 ms (under 1,000 ms); zero Mermaid NodeViews in reduced mode.
- Cold editor startup median: 463 ms (517.5 ms budget); no Provider modules loaded.

### Artifact and platform checks

- [x] Final DMG mounts read-only and final ZIP expands cleanly in temporary locations.
- [x] DMG and ZIP contain matching application payloads and Universal `arm64 + x86_64` executables.
- [x] `better-sqlite3` and Keychain N-API binaries for both architectures pass package and Electron ABI verification.
- [x] Final Apple Silicon candidate launches and creates a fresh 4,096-byte SQLite database.
- [x] Final x86_64 slice launches under Rosetta via `arch -x86_64` and creates a fresh 4,096-byte SQLite database.
- [x] Final ZIP launch, edit, explicit save, exit, and reopen preserves the edit.
- [x] Final packaged disposable Keychain credential lifecycle passes: create reports `hasCredential=true`; deletion is requested with `deleteSecrets=true` and the Provider config disappears. No credential value was printed or retained.
- [x] Both `.md` and `.markdown` are packaged as `Editor` document types.
- [ ] **BLOCKED — physical Intel Mac unavailable.** Rosetta smoke coverage does not close this requirement.
- [ ] **BLOCKED — macOS 13 runtime unavailable.** Metadata declares 13.0.0, but this host is macOS 26.5.2.
- [ ] **SKIPPED — Developer ID signing requires signing credentials and explicit authorization.** The local candidate is unsigned/ad-hoc only.
- [ ] **SKIPPED — notarization and stapling require credentials and explicit authorization.** No `spctl` acceptance claim is made.

### Product journeys

- [x] Automated E2E covers open/edit/autosave, Save As, external changes/conflicts, source/visual mode, workspaces, sessions, recovery, diagnostics, onboarding, and Provider settings.
- [x] Automated accessibility gates cover English and Simplified Chinese at 800×600, keyboard-only navigation, focus, accessible names, reduced motion, clipping, and overflow.
- [x] Static color/contrast contract passes for all 12 themes.
- [x] Final packaged matrix passes English and Simplified Chinese in light and dark themes.
- [x] Final packaged Mermaid valid diagram renders an SVG in the strict `sandbox="allow-scripts"` iframe; invalid diagrams show localized errors without poisoning valid diagrams.
- [x] Final packaged KaTeX inline and `$$` block formulas render; the block formula has computed centered layout.
- [x] Final packaged 5 MiB document enters reduced source mode, disables visual mode, creates zero Mermaid nodes, and saves byte-for-byte correctly apart from the intentional 25-byte sentinel. Expected and actual SHA-256 both equal `76f5869f9678fc3336fa12899e68f239cdb6aa801287da65048475502f37e3ac`.
- [x] Automated acceptance covers CJK, tables, task lists, highlights, links, images, Diff, Undo, conflicts, deletion approval, and interrupted-task recovery.
- [x] Final packaged loopback Agent journey passes with no paid Provider: Agent capability, 4 localhost requests, 5 successful/0 failed tool activities, two-file Diff, and byte-for-byte three-file Undo restoration.

### Provider and diagnostics checks

- [x] Automated mock coverage passes Agent, chat-only, cancellation, authentication error, rate limit, malformed tool call, timeout, stale selection, deletion approval, Diff, and Undo flows.
- [x] Diagnostics contract, recursive redaction, safe logging, preview/export, and database integrity tests pass; document/prompt/response/credential fields remain excluded.
- [ ] **SKIPPED — Ollama unavailable:** CLI absent, process absent, port 11434 closed.
- [ ] **SKIPPED — LM Studio unavailable:** CLI absent, process absent, port 1234 closed.
- [ ] **SKIPPED — real Anthropic request requires paid credentials and explicit approval.** No request was made.
- [ ] **SKIPPED — real OpenAI request requires paid credentials and explicit approval.** No request was made.

### Release decision gates

- [x] Privacy and Provider compatibility documentation reviewed by automated/document checks.
- [x] Signing/notarization workflow fails closed on tagged releases when protected secrets are absent; workflow dispatch remains visibly unsigned and non-publishing.
- [x] Known blockers and skipped checks are documented above.
- [ ] Version and release notes require release-owner review.
- [ ] Protected signing/notarization credentials have not been authorized or exercised.
- [ ] Physical Intel and macOS 13 runtime verification remain open release blockers.
- [ ] Explicit authorization has not been received for a tag, upload, or release publication.

Do not convert this report to a release approval until every release-blocking item is completed or the release owner explicitly accepts and documents the exception.
