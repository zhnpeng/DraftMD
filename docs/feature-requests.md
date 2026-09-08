# DraftMD Feature Requests

This list holds possible future work, not release commitments. Implemented behavior and release blockers are tracked in the [current roadmap](roadmap.md). The [product design](superpowers/specs/2026-08-31-draftmd-product-design.md) defines the MVP scope.

## Candidates

- More discoverable Markdown formatting commands, with keyboard conflicts checked against the editor and macOS menus.
- Reliable local image insertion, including a clear policy for paths and copied assets.
- Footnote previews that preserve document navigation and keyboard access.
- Snapshot storage visibility and a user-controlled retention policy for conversations that remain saved. Current automatic cleanup removes only old unreferenced snapshots; it does not cap all snapshot storage.

Each candidate needs a concrete user workflow and validation criteria before entering an implementation plan.

## Deferred Beyond MVP

- Word and shareable image export.
- Custom theme import and a broader preferences/keybinding system.
- Multiple document windows as a supported product workflow.
- Linux, Windows ARM, iOS, and Web applications. Windows x64 has moved to [candidate implementation and validation](windows.md).
- Cloud synchronization, collaborative editing, knowledge-base management, and tags.
- Shell execution, web browsing, and MCP tools for the Agent.

## Upstream History

The inherited [ColaMD feature-request archive](archive/colamd-feature-requests.md) preserves original issue links and historical decisions. Its "Implemented On Main" section refers to upstream history and must not be used as the current DraftMD feature list. The previous rejection of persistent workspaces also does not apply to DraftMD's workspace-based Agent workflow.
