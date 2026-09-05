# Responses API Implementation Plan

**Goal:** Use the official OpenAI Responses API for streamed document tasks and expose an explicit protocol selection for compatible services.

**Architecture:** A Responses adapter implements the existing provider event contract using the official SDK stream accumulator. Keep document execution, approvals, snapshots, and undo in the existing runtime. Replay complete output items with `store: false`; retain Chat Completions as an explicit compatibility option. Existing compatible configurations retain their protocol until switched; new remote OpenAI configurations default to Responses.

**Tech Stack:** TypeScript, OpenAI SDK 7.8, Zod, SQLite, Electron, Vitest, Playwright.

## Tasks

1. Add failing adapter tests for text streaming, strict tools, parallel calls, reasoning replay, incomplete streams, refusals, cancellation, and upstream errors. Use real SDK against loopback HTTP fixtures for protocol coverage.
2. Implement `src/main/providers/openai/responses-adapter.ts` and Responses input mapping. Let the SDK assemble final output; validate completion before emitting any executable tools. Preserve original output items and normalize optional null arguments only for local tools.
3. Add protocol persistence and selection in provider contracts, repository, service, factory, and settings. Store the mode in existing `settings_json`; invalidate capability tests when the protocol changes without replacing credentials.
4. Exercise both protocols through integration tests and packaged settings/document-edit workflows. Verify protocol selection survives reload and failed Responses requests never silently retry via Chat Completions.
5. Run full unit/integration tests and typecheck, build an unsigned local universal app, run packaged acceptance, and reinstall the verified candidate. Keep GitHub publication disabled.

## Sources

- https://developers.openai.com/api/docs/guides/migrate-to-responses
- https://developers.openai.com/api/docs/guides/function-calling#strict-mode

## Authorization

The user requested Responses API mode after the API architecture discussion. Continue implementation locally under existing autonomous work and reinstall authorization. No release publication is authorized.

## Verification

- Full Vitest suite: 758 passed, 1 skipped. Project typecheck and direct typecheck of new protocol fixtures/E2E passed. `git diff --check` passed.
- Packaged acceptance: 27 passed. Both protocols read and modify two real Markdown fixtures, create a third file, and undo exactly. Responses also edits again within the same conversation after undo.
- Official SDK loopback tests cover typed text events, fragmented function arguments, reasoning replay, SDK-only field removal, strict nullable arguments, failed/incomplete/empty output, refusal, HTTP errors, and cancellation before and during streaming.
- Review found an unpaired historical tool-call replay risk. Fixed by respecting text-only historical messages (`provider: null`); added adapter regression and second-task E2E, with mock validation requiring paired function results.
- Old configurations preserve Chat Completions until explicitly switched. New native configurations default to Responses; protocol changes clear capability metadata and retain existing credentials.
- Universal local bundle: `release/local-responses-api-20260905/mac-universal/DraftMD.app`; both x86_64 and arm64 verified. Packaging validated native modules for both architectures and universal output.
- Installed `/Applications/DraftMD.app` asar SHA256: `e76ccad70c5ea72f826bc7a6fa72bdffcb8a86ea8d0e0b31188c8615b9d30fdf`. Previous app retained under the candidate directory; the user's database was backed up under its existing application-support directory before changing the default configuration to Responses.
- The installed app's real default compatible service (`gpt-6-astra`) passed a Responses capability probe in 5379 ms: `agent`, no error or warning. The probe sent only synthetic echo instructions, without user document content. Actual document edit/undo acceptance used isolated loopback fixtures.
- Settings screenshots checked at normal size and 800 x 600. Fixed the test helper's initial onboarding readiness race; packaged settings tests passed without retries.
- No GitHub release was published or publishing workflow re-enabled.
