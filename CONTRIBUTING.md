# Contributing to DraftMD

Thank you for helping improve DraftMD.

DraftMD is derived from [ColaMD](https://github.com/marswaveai/ColaMD). Preserve applicable copyright, license, and third-party notices when moving or modifying upstream or bundled code. See [NOTICE.md](NOTICE.md) for provenance details.

## Development setup

DraftMD requires macOS and Node.js 22.12 or newer.

```bash
npm install
npm run dev
```

## Before submitting a pull request

Keep changes focused and follow the existing TypeScript and UI conventions described in [AGENT.md](AGENT.md) and [design.md](design.md). Add or update tests for behavior changes.

Run the relevant checks, including the standard gates:

```bash
npm run typecheck
npm run test
npm run test:integration
npm run test:security
npm run test:e2e
npm run test:performance
npm run build
npm run check:theme-colors
```

Some Electron, packaging, Keychain, and platform checks require macOS or additional local setup. State clearly in the pull request which checks were run and which were unavailable.

The `CI / macOS checks` job runs these gates on ordinary branch pushes and pull requests using macOS and Node.js 24. It cancels superseded runs for the same PR or ref and retains failed-run diagnostics for seven days. It does not package, sign, or publish the app. Release jobs remain in the separate release workflow. Repository administrators can select this check for branch protection after it has run; adding the workflow alone does not configure protection rules.

Real Keychain integration is opt-in with `DRAFTMD_RUN_KEYCHAIN_TESTS=1`. Live provider checks and physical Intel/macOS 13 validation remain manual; automated fixtures do not establish compatibility with every model or machine. Current implementation and remaining release work are tracked in the [roadmap](docs/roadmap.md), with future candidates in [feature requests](docs/feature-requests.md).

## Packaged acceptance

After building a Universal candidate, test the actual application bundle:

```bash
npm run dist:mac
npm run verify:universal
DRAFTMD_PACKAGED_APP="$PWD/release/mac-universal/DraftMD.app" npm run test:packaged
```

The packaged suite reuses editor, Diff/Undo, task lifecycle, provider revalidation, and snapshot retention journeys. It launches the supplied `.app` without rebuilding source, asserts packaged mode and an isolated temporary user-data directory, and uses loopback model fixtures without API keys. It rejects profiles outside the canonical temporary directory before preparing files, clears development renderer URLs, and verifies matched pages are loaded from the selected app bundle. A separate direct-launch regression also confirms that the production app ignores development renderer URLs without relying on the helper's sanitization. It does not enable production test-mode bypasses or use your normal DraftMD profile. Release CI runs it after Universal verification and before uploading distributables.

Run build-producing test commands serially. The full Vitest suite and the Electron/security/performance setup can each rebuild `dist`, so running those commands concurrently can invalidate their results.

To preserve an existing candidate, choose another output directory with `npm run dist:mac -- --config.directories.output=/absolute/path/to/candidate`. Set `DRAFTMD_ARTIFACTS_DIR` to that directory for `npm run verify:universal`, and point `DRAFTMD_PACKAGED_APP` at its `mac-universal/DraftMD.app`. The source version is unchanged; keep unreleased candidates separate from published artifacts.

## Pull requests

- Explain the user-facing problem and the chosen solution.
- Keep unrelated refactors out of the change.
- Do not include credentials, private documents, generated builds, or local test results.
- Retain attribution for code derived from another project.
- Update user-facing documentation when behavior changes.

## License

By submitting a contribution, you agree that it may be distributed under this repository's [MIT License](LICENSE). Only submit work you have the right to license in this way.
