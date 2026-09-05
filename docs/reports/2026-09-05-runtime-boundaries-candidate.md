# Runtime Boundary Candidate Verification

Date: 2026-09-05. This unsigned local Universal candidate contains the current uncommitted changes based on `ffc6282a84405a745ddc50b440191d6f46a8cc6b`. Its source version remains `0.1.0-preview.5`; it is not the published Preview 5 binary. The earlier local candidate and its report remain intact.

## Fixed Behavior

- Editing provider connection settings or credential references clears capability and prior probe metadata. Display-name changes and default selection preserve capability.
- Probe results are persisted only while the saved connection still matches the tested snapshot. A deleted or different connection causes the result to be discarded and returned as cancelled.
- Packaged apps ignore ELECTRON_RENDERER_URL at production composition. Development mode retains the development renderer option.
- Packaged approval layout tests resize the window associated with the document page, then assert an actual 800x600 viewport. Startup changelog windows can no longer cause that check to resize a different window.

## Artifact Evidence

Output: `release/runtime-boundaries-20260905/`.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `DraftMD-0.1.0-preview.5-universal.dmg` | 235162574 | `8e22d9a176a10db54e5c1374aed7930f9033bf08d5e1c5d5b5446588ac75be20` |
| `DraftMD-0.1.0-preview.5-universal-mac.zip` | 234089451 | `e31a3b0da3fa523bcce238d7eb7adc074548b6f3af764eeb22cbc2257dee4a5f` |

The app is `mac-universal/DraftMD.app` in that directory. Its app.asar SHA-256 is `c115643014f74d1c8698d597f7a8a363e5eb6c6fcc4317848eefdebac236f6fd`. The ZIP and read-only mounted DMG contain the same payload. ZIP CRC validation passed, and the DMG was detached after inspection.

Universal architecture, native package layout, runtime symlink, and legal notice checks passed. The packaged Keychain module loaded and SQLite queries succeeded both on the host and under Rosetta x64.

## Regression Evidence

- Application typecheck and strict checks of the changed tests passed.
- Full Vitest: 713 passed, one real Keychain test skipped by default. The actual Keychain round trip was verified in the preceding candidate increment.
- Development Electron E2E: 42 passed.
- Final packaged acceptance: 15 passed, including both provider revalidation journeys and a direct binary launch with an injected development URL.
- Security: 35 Vitest tests and two Electron tests passed.
- Performance: three Vitest tests and two Electron tests passed. Local development-build startup median was 201 ms; the 5 MiB document edit was approximately 202 ms, with a maximum recorded renderer long task of 852 ms.
- Production builds, twelve-theme checks, workflow gate validation, and whitespace checks passed.
- The 800x600 packaged approval screenshot was inspected; the document and approval controls render without overlap and both approval actions remain visible.

Before the fixes, fifteen provider regression cases failed. The earlier local package also loaded the injected development URL when launched directly; the new package ignores it without contacting the loopback server. A newly added viewport assertion exposed the incorrect window target (960px instead of 800px) before that test was corrected.

Independent review found no blocking issue. The connection comparison is not a latest-probe ordering policy: overlapping probes for the same connection retain completion-order semantics. A connection changed from A to B and back to A can accept a matching A result.

## Remaining Release Work

Live cloud/local model verification, physical Intel/macOS 13 testing, Developer ID signing, notarization, stapling, and normal Gatekeeper acceptance remain open. Rosetta does not replace physical Intel verification. No commits, pushes, remote CI runs, uploads, or publication occurred in this increment.

See the [execution plan](../plans/2026-09-05-runtime-boundaries.md), [provider rules](../provider-compatibility.md), and [current roadmap](../roadmap.md).
