# Agent Sidebar and Workspace File Switching

## Goal

Open workspace-list files in the current editor window. Move the Agent interface to a resizable right sidebar as requested by the user.

## Design

- Workspace clicks use the current-window loader after the renderer save guard. Failed loads return false.
- The sidebar starts expanded at 360px, with horizontal resizing between 300px and the smaller of 640px and half the window width. Persist width separately from the old dock height.
- A collapsed 44px rail exposes an accessible expand button. Preserve draft/approval collapse guards and active tasks.
- Keep the titlebar full width and both editor modes full height. Left file panel and right Agent sidebar reserve separate horizontal space.
- A scrolling task region contains messages, activity, diffs, and recovery. Approval controls and the composer remain reachable.
- Update separator orientation, left/right keyboard resizing, pointer axis, focus behavior, and localized accessible labels.

## Verification

1. Workspace switching reproduced against old installed candidate. Targeted IPC/window/navigation/security tests (49) and editor E2E (4) pass after the handler fix.
2. Add failing state/layout regressions for resizing, full-height editing, collapse/reopen, menu bounds, and 800x600/1280x800 windows.
3. Verify screenshots and packaged workflows, including direct Responses document editing, undo, and approvals.
4. Install the combined local candidate with previous app retained. Preserve model configuration and user data. No GitHub release publication is authorized.

## Completed Validation

- Full Vitest suite: 758 passed, 1 skipped. Project and edited-test TypeScript checks passed.
- Sidebar, task lifecycle, and diff/undo desktop tests: 12 passed. Remaining accessibility, session, approval, document, and diff workflows passed; added save-protection and export regressions also passed.
- Review caught two additional regressions: conflict-file navigation needed the save guard, and HTML/PDF export needed to clear sidebar layout space. Both were reproduced with failing regressions before the fixes and passed afterward. Final independent review found no remaining blockers.
- Packaged acceptance: all 33 scenarios passed (30 on the initial run, 3 after correcting tests to compare window identities across navigation, allowing the initial changelog window). The same bundle passed both 1280x800 and 800x600 sidebar checks, with screenshots visually inspected.
- Export coverage verifies rendered geometry for HTML and the PDF export stylesheet across expanded/collapsed states with the file panel enabled. It does not inspect final PDF pagination.
- Universal executable contains x86_64 and arm64; packaged native dependencies validated for both architectures.

## Local Installation

- Candidate: `release/local-agent-sidebar-20260905/mac-universal/DraftMD.app`.
- Installed and launched: `/Applications/DraftMD.app`.
- Verified candidate and installed `app.asar` SHA-256: `c9a150d710be0f2ba793423fa19449ca65eaa35d7fbe6260b03e0c137f3d09cb`.
- Previous application retained at `release/local-agent-sidebar-20260905/previous-install/DraftMD.app`.
- Installation did not modify provider settings, credentials, database contents, or user documents. No GitHub release was published.
