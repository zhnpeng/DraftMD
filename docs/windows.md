# Windows x64 Candidate

The 0.1.1 source includes Windows x64 candidate adaptation. Release downloads
remain macOS-only. Windows runtime and installer acceptance is still required.

## Build and Run

Use Windows x64 and Node.js 22.12 or later:

```powershell
npm ci
npm run dev
```

Build unsigned NSIS and ZIP candidates and test the unpacked application:

```powershell
npm run dist:win
$env:DRAFTMD_PACKAGED_APP = "$PWD/release/win-unpacked/DraftMD.exe"
npm run test:windows
```

The installer is `release/DraftMD-0.1.1-win-x64.exe`. Extract the entire ZIP, not
just `DraftMD.exe`. NSIS permits choosing the installation directory and registers
Markdown associations. File > Set as Default App opens Windows settings without
forcing the user's default. Builds are unsigned; SmartScreen or organizational
policy may block them. Do not disable system-wide protection to run a candidate.

The separate Windows workflow builds and tests on `windows-latest` and uploads
candidates after automated checks pass; it does not publish GitHub Releases.
Check the workflow run for the selected commit for automated results. Windows ARM
and Linux remain outside this adaptation.

## Platform Behavior

- Native titlebar, controls and menu; model settings under Edit.
- Ctrl shortcuts, including Ctrl+Shift+J for selection context.
- Explorer/command-line Markdown opening, including subsequent launches.
- SQLite and keyring Windows x64 native modules staged separately from macOS.
- Secrets use Windows Credential Manager through `@napi-rs/keyring`, without plaintext fallback.
- User data lives in Electron's user-data directory, normally `%APPDATA%/DraftMD`.
- Workspace logical paths remain forward-slash relative paths; Windows device names,
  alternate data streams, trailing aliases and external junction escapes are rejected.
- Fonts are enumerated with a fixed non-interactive PowerShell command.

## Acceptance Checklist

- [ ] NSIS install/uninstall as a normal user, paths with spaces and Chinese characters.
- [ ] Explorer `.md`/`.markdown` opening, including already-running/minimized app.
- [ ] Folder navigation, save, external changes, conflicts and unsaved close prompts.
- [ ] Ctrl shortcuts, fonts, themes and 600/960-pixel window layouts.
- [ ] Real credentials round-trip with `DRAFTMD_RUN_KEYCHAIN_TESTS=1` on Windows.
- [ ] Live model requests, approvals, cancellation, Diff and Undo.
- [ ] Local images, PDF/HTML export, diagnostics and Chinese filenames.
- [ ] Record Windows version, candidate hash and successful Windows CI run.

Cross-packaging and PE checks on macOS prove artifact structure, not Windows
runtime correctness. macOS tests do not validate Windows APIs.

## Local Candidate Evidence (2026-09-07)

- Final source: 810 Vitest tests passed, 4 skipped; TypeScript and 12-theme checks passed.
- macOS packaged regression: 22 passed, 1 Windows-only skip, including native module execution and Unicode image round-trip. The final extra Windows-only reserved-name cases were covered by Vitest.
- Security: 36 unit checks and 2 sandboxed Electron checks passed on macOS.
- Windows NSIS and ZIP cross-build succeeded; native SQLite/keyring PE headers are x64.
- ZIP CRC validation passed. Installer and application have no Authenticode certificate.
- Output: `release/windows-local-20260907/` (local, ignored, not published).
- Installer SHA-256: `e87e4b1f8124a86323d88544fc6d7e6ffd063de7c30ca8c5aeddcc431f7699b7`.
- ZIP SHA-256: `ad3d4b64f0139e664a497335b5d6af0bbe2301c39d624aa7d0535887e7346170`.

The Windows-only second-process, junction/case-spelling and credential checks were
not executed on this macOS host. The workflow is provided but no remote run was triggered.

## References

- [ColaMD packaging](https://github.com/marswaveai/ColaMD/blob/main/electron-builder.yml)
- [Electron lifecycle](https://www.electronjs.org/docs/latest/api/app)
- [Windows default-app settings](https://learn.microsoft.com/en-us/windows/apps/develop/launch/launch-default-apps-settings)
- [Windows reserved file names](https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file)
