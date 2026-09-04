# DraftMD Release Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove DraftMD meets its security, reliability, performance, bilingual, macOS Universal, recovery, and release requirements and prepare an unsigned or signed release candidate without publishing it.

**Architecture:** Add adversarial security tests, workload fixtures, diagnostic redaction, full acceptance E2E journeys, and a macOS-only CI/release path. Automated tests use fake providers; paid live-provider and signing/notarization tests remain explicit manual gates.

**Tech Stack:** Vitest, Playwright Electron, GitHub Actions macOS, electron-builder, Apple codesign/notary tooling.

**Spec:** `docs/superpowers/specs/2026-08-31-draftmd-product-design.md`

## Global Constraints

- Do not call paid providers without explicit approval.
- Do not publish releases, push tags, create a remote, or upload artifacts without explicit approval.
- Do not request or print signing secrets; consume them only through documented environment variables/CI secrets.
- No release passes while any security, data-loss, E2E, typecheck, build, or theme gate fails.
- Apple Silicon and Intel Universal support plus macOS 13 minimum are release-blocking.

---

### Task 1: Add Security Regression Suite

**Files:**
- Create: `tests/security/workspace-boundary.test.ts`
- Create: `tests/security/ipc-validation.test.ts`
- Create: `tests/security/provider-redaction.test.ts`
- Create: `tests/security/renderer-sandbox.spec.ts`
- Create: `vitest.security.config.ts`
- Modify: `package.json`

**Interfaces:**
- Produces `npm run test:security` as a release-blocking gate.

- [ ] **Step 1: Add adversarial path corpus**

Cover absolute paths, traversal in both slash forms, URL-encoded traversal, NUL, Unicode normalization, case variants, symlink chains, nested symlink parent, extension masquerade, hard link where supported, and workspace root replacement during task.

- [ ] **Step 2: Fuzz strict IPC schemas**

For every channel, send missing fields, extra fields, wrong primitive types, huge strings, prototype keys, and invalid enum values. Assert rejection before service invocation.

- [ ] **Step 3: Assert renderer sandbox and CSP**

E2E evaluates `typeof require === 'undefined'`, `typeof process === 'undefined'` in renderer, no `draftmd` method returns credentials, external model Markdown cannot inject script/event attributes, and Mermaid remains isolated.

- [ ] **Step 4: Assert redaction**

Inject sentinel secret/document text through provider errors, logs, diagnostic export, IPC error DTOs, and SQLite metadata. Assert secret absent everywhere; full document absent from logs/diagnostics; user-visible conversation/SQLite may contain explicitly persisted messages as specified.

- [ ] **Step 5: Verify**

Run `npm run test:security`; expected zero failures.

- [ ] **Step 6: Commit when authorized**

```bash
git add tests/security vitest.security.config.ts package.json package-lock.json

git commit -m "test: enforce DraftMD security boundaries"
```

---

### Task 2: Add Diagnostics and Database Recovery

**Files:**
- Create: `src/main/diagnostics/logger.ts`
- Create: `src/main/diagnostics/export-diagnostics.ts`
- Create: `src/shared/contracts/diagnostics.ts`
- Modify: main services to use logger
- Create: `tests/integration/diagnostics/redaction.test.ts`
- Create: `tests/integration/persistence/corruption-recovery.test.ts`

**Interfaces:**
- Produces structured logger with safe fields and diagnostics preview/export.
- User sees the list of included categories before choosing export location.

- [ ] **Step 1: Write safe-field logger tests**

Allow only timestamp, level, module, task status, provider kind, safe error code, relative path, operation, latency, and token usage. Reject unknown fields and absolute path-looking values.

- [ ] **Step 2: Implement rolling local logs**

Max 5 files × 2 MiB, under userData/logs, mode `0o600`. Never log request/response bodies, headers, keys, full prompts, full assistant text, or document content.

- [ ] **Step 3: Implement diagnostic preview/export**

Preview lists app/OS/runtime versions, safe settings, redacted provider metadata, recent safe logs, DB integrity result, and no snapshots. Export JSON/ZIP only after user chooses a path. Apply a second regex/value redaction pass.

- [ ] **Step 4: Verify corrupted DB fallback**

Inject malformed SQLite, launch, assert Markdown editor works, a localized warning appears, corrupt DB preserved under timestamped name, and fresh session DB is usable.

- [ ] **Step 5: Commit when authorized**

```bash
git add src/main/diagnostics src/shared/contracts/diagnostics.ts src/main/persistence tests/integration

git commit -m "feat: add private diagnostics and recovery"
```

---

### Task 3: Add Performance Fixtures and Budgets

**Files:**
- Create: `scripts/generate-performance-fixtures.mjs`
- Create: `tests/performance/workspace-performance.test.ts`
- Create: `tests/performance/large-document.spec.ts`
- Create: `vitest.performance.config.ts`
- Modify: `package.json`

**Interfaces:**
- Produces `npm run test:performance` with machine-tolerant budgets and benchmark JSON.

- [ ] **Step 1: Generate deterministic fixtures**

Create 1,000 Markdown files across nested folders and one 5 MiB Markdown file containing headings, tables, code, Mermaid, and LaTeX. Generate in temp/output ignored by Git, not repository blobs.

- [ ] **Step 2: Test workspace budget**

On CI macOS, list 1,000 files under 2 seconds and lexical search under 3 seconds after cold start; renderer receives summaries only. Budgets are p95 across 3 runs with one warm-up and are recorded rather than silently loosened.

- [ ] **Step 3: Test 5 MiB document behavior**

Open and edit without renderer crash or >1 second event-loop stall. If complex decorations exceed budget, automatically enter documented reduced-rendering mode while preserving source content and editing.

- [ ] **Step 4: Test lazy Provider loading**

Cold launch without opening dock/provider settings must not import provider SDK chunks. Record startup from main load through editor ready and compare against Foundation baseline with a maximum 15% regression.

- [ ] **Step 5: Verify**

Run `npm run test:performance` on the development Mac and retain JSON output as a CI artifact, not committed output.

- [ ] **Step 6: Commit when authorized**

```bash
git add scripts/generate-performance-fixtures.mjs tests/performance vitest.performance.config.ts package.json

git commit -m "test: enforce DraftMD performance budgets"
```

---

### Task 4: Automate the Five Acceptance Journeys

**Files:**
- Create: `tests/e2e/acceptance/meeting-sync.spec.ts`
- Create: `tests/e2e/acceptance/create-design.spec.ts`
- Create: `tests/e2e/acceptance/selection-completion.spec.ts`
- Create: `tests/e2e/acceptance/delete-protection.spec.ts`
- Create: `tests/e2e/acceptance/chat-only.spec.ts`
- Create: `tests/fixtures/acceptance/**`

**Interfaces:**
- Produces executable versions of Spec §15 acceptance scenarios against fake provider scripts and real temp files/SQLite/snapshots.

- [ ] **Step 1: Implement meeting decision synchronization journey**

Assert only requirements/design relevant sections change, activity list and summary match, final Diff is readable, and undo restores all three files byte-for-byte.

- [ ] **Step 2: Implement design draft creation journey**

Assert creation, collision rejection, file list refresh, valid Markdown, undo removal, and post-creation manual-edit conflict.

- [ ] **Step 3: Implement selection completion journey**

Assert heading/path context, on-demand search, selected-section-only edit, stale selection refusal, and local Diff.

- [ ] **Step 4: Implement deletion journey**

Assert pause, path/reason, deny, approve, per-item handling, and undo restore.

- [ ] **Step 5: Implement chat-only journey**

Assert suggestion conversation works, no tools are offered, no baseline/change set exists, and fake patch text is never applied.

- [ ] **Step 6: Verify**

Run all acceptance tests in both locales where copy is asserted and both light/dark themes for Diff/approval snapshots.

- [ ] **Step 7: Commit when authorized**

```bash
git add tests/e2e/acceptance tests/fixtures/acceptance

git commit -m "test: automate DraftMD acceptance journeys"
```

---

### Task 5: Complete Accessibility and Localization Gates

**Files:**
- Create: `tests/e2e/accessibility.spec.ts`
- Create: `tests/unit/i18n/no-hardcoded-ui-strings.test.ts`
- Modify: `scripts/check-theme-colors.mjs`
- Modify: catalogs and affected UI files

**Interfaces:**
- Produces catalog parity, hard-coded string allowlist, keyboard-flow, accessible-name, reduced-motion, and semantic-color checks.

- [ ] **Step 1: Add UI string scan**

Scan renderer/main menu code for quoted Chinese or user-visible English strings outside catalogs. Allow only technical literals, test fixtures, CSS class names, and provider/tool protocol strings through a reviewed allowlist.

- [ ] **Step 2: Add keyboard-only journeys**

Open workspace, edit, open dock, select model, send, stop, approve/deny delete, inspect Diff, undo, settings, locale change, and close using keyboard only.

- [ ] **Step 3: Add accessibility snapshot checks**

Require names/roles/states for all buttons, tabs, dialogs, log, separator, status, Diff lines, and approval controls. Verify red/green removal does not erase Diff meaning.

- [ ] **Step 4: Verify both locales and reduced motion**

At 800×600, assert no clipped critical controls in Chinese/English and no nonessential animations under reduced motion.

- [ ] **Step 5: Commit when authorized**

```bash
git add tests/e2e/accessibility.spec.ts tests/unit/i18n scripts/check-theme-colors.mjs src

git commit -m "test: complete accessibility and localization gates"
```

---

### Task 6: Prepare macOS Universal Build and Release Workflow

**Files:**
- Modify: `electron-builder.yml`
- Modify: `.github/workflows/release.yml`
- Modify: `resources/entitlements.mac.plist`
- Modify: `scripts/afterPack.js`
- Create: `docs/release-checklist.md`
- Create: `docs/privacy.md`
- Create: `docs/provider-compatibility.md`
- Modify: `README.md`
- Modify: `README_CN.md`

**Interfaces:**
- Produces unsigned local Universal artifacts by default and signed/notarized CI artifacts when secrets exist.

- [ ] **Step 1: Verify native dependencies in Universal packaging**

Ensure better-sqlite3 and keyring binaries exist for arm64/x64 and electron-builder merges/unpacks them correctly. `afterPack.js` validates both architectures and fails with exact missing module path.

- [ ] **Step 2: Make signing conditional for local builds**

Local `npm run dist:mac` with `CSC_IDENTITY_AUTO_DISCOVERY=false` produces unsigned artifacts for testing. CI release requires signing secrets and fails closed on tag builds if absent; workflow-dispatch may build unsigned with a visible artifact label.

- [ ] **Step 3: Add full CI gates before packaging**

Order:

```text
npm ci
npm run typecheck
npm run test
npm run test:integration
npm run test:security
npm run test:e2e
npm run test:performance
npm run build
npm run check:theme-colors
git diff --check
npm run dist:mac
```

Do not publish on workflow dispatch. Tag publishing remains separately permissioned and only after all gates.

- [ ] **Step 4: Write release/privacy/compatibility docs**

Release checklist includes macOS 13, Apple Silicon, Intel, DMG, Keychain, file association, themes, Ollama, LM Studio, one Anthropic and one OpenAI manual test, large/CJK/Mermaid/LaTeX docs. Privacy doc explains local persistence and remote model content sending. Compatibility doc lists tested endpoints and “depends on service implementation” for custom endpoints.

- [ ] **Step 5: Build unsigned Universal candidate**

Run:

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:mac
file release/mac-universal/DraftMD.app/Contents/MacOS/DraftMD
```

Expected: build exits 0 and binary reports both `x86_64` and `arm64`/universal architectures. Verify `LSMinimumSystemVersion` is 13.0.

- [ ] **Step 6: Commit when authorized**

```bash
git add electron-builder.yml .github resources scripts/afterPack.js docs README.md README_CN.md

git commit -m "build: prepare DraftMD macOS release"
```

---

### Task 7: Run Manual Release Candidate Verification

**Files:**
- Update: `docs/release-checklist.md` with results only; do not store secrets.

**Interfaces:**
- Produces a dated release-candidate report with pass/fail/skipped evidence.

- [ ] **Step 1: Run free local checks without intervention**

Install unsigned DMG locally, verify launch, basic editing, Keychain using a disposable config, local mock provider, Ollama/LM Studio if present, both locales/themes, and acceptance fixtures. Record exact versions/results.

- [ ] **Step 2: Pause for paid provider authorization**

Before calling a real Anthropic/OpenAI API, report the exact minimal tests and estimated request count. If not authorized, mark them `SKIPPED — requires paid credentials`; do not claim provider release verification.

- [ ] **Step 3: Pause for signing/notarization credentials**

If credentials are unavailable, verify unsigned candidate only and mark signing/notarization skipped. If credentials are configured in CI, trigger only after explicit authorization because it is external and may publish/upload artifacts.

- [ ] **Step 4: Verify Intel and macOS 13**

Run on real/authorized Intel macOS 13 environment or CI runner capable of launching the x64 app. If unavailable, mark as a release blocker, not an inferred pass from Universal binary metadata.

- [ ] **Step 5: Run final gate and report truthfully**

Run all automated commands fresh. Summarize passed, failed, and skipped checks; no “release-ready” claim while any release-blocking item is failed or skipped.

- [ ] **Step 6: Commit checklist results when authorized**

```bash
git add docs/release-checklist.md

git commit -m "docs: record DraftMD release candidate verification"
```
