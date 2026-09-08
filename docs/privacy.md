# DraftMD Privacy

DraftMD is a local-first Markdown editor. This document describes what is stored locally and what may leave the computer when a model provider is used.

## Local data

DraftMD stores the following under the current OS user account:

- Markdown documents in folders chosen by the user;
- local conversation, task, and provider metadata in SQLite;
- task snapshots used for Diff, Undo, and interrupted-task recovery;
- model credentials and secret headers in macOS Keychain or Windows Credential Manager (Windows candidate);
- bounded rolling diagnostic logs containing only approved safe fields;
- interface preferences such as language, theme, and editor font.

Deleting a conversation does not delete Markdown files. Deleting a provider configuration can optionally remove its Keychain secrets. Task snapshots are local and are not part of diagnostics exports.

### Snapshot retention

In the current source tree, after interrupted-task recovery succeeds at startup, DraftMD runs background cleanup of snapshot directories. It removes a directory only when no task in the local database references it and its last modification time is more than 30 days ago. Every persisted task is protected, across all workspaces and statuses, including completed and undone tasks.

Deleting a conversation removes its task references, making those snapshots eligible at a later startup once their directory age exceeds 30 days. The 30 days are measured from the snapshot directory's modification time, not from conversation deletion. Saved conversations can therefore retain snapshots indefinitely; this policy does not impose a total storage limit. Cleanup never removes the original workspace documents.

Cleanup is skipped if task recovery fails, the database reports recovery or an in-memory fallback, or a quarantined `draftmd.corrupt.<timestamp>.sqlite` backup remains in the app data directory. Keeping that backup also protects snapshots on later launches. Resolve database recovery and determine whether its history is needed before removing a quarantined backup. Cleanup errors produce safe diagnostic codes when logging is available and do not block startup.

See the [roadmap](roadmap.md) for the release status of this maintenance behavior.

## Model providers

DraftMD contacts a model provider only after the user configures one and starts a capability test, chat, or task. Depending on the action, the request can include:

- the user's task or chat message;
- the current Markdown document or selected text;
- workspace-relative file names and Markdown content read by approved agent tools;
- tool results needed to continue that task.

The destination is the configured Anthropic, OpenAI, Ollama, LM Studio, or custom compatible endpoint. The provider's own retention and privacy terms apply. DraftMD does not send Keychain credentials to the Renderer, logs, SQLite, or diagnostics bundles; credentials are attached only to requests for their configured provider.

## Diagnostics exports

The Help → Export Diagnostics flow previews the included categories before showing a save dialog. Exports include application/runtime versions, safe settings, redacted provider metadata, safe logs, and database integrity status. They exclude prompts, responses, document content, credentials, secret headers, messages, and task snapshots. A second redaction pass runs before the JSON file is written.
