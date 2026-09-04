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
npm run build
npm run check:theme-colors
```

Some Electron, packaging, Keychain, and platform checks require macOS or additional local setup. State clearly in the pull request which checks were run and which were unavailable.

## Pull requests

- Explain the user-facing problem and the chosen solution.
- Keep unrelated refactors out of the change.
- Do not include credentials, private documents, generated builds, or local test results.
- Retain attribution for code derived from another project.
- Update user-facing documentation when behavior changes.

## License

By submitting a contribution, you agree that it may be distributed under this repository's [MIT License](LICENSE). Only submit work you have the right to license in this way.
