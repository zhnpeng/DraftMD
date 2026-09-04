# DraftMD Privacy

DraftMD is a local-first Markdown editor. This document describes what is stored locally and what may leave the Mac when a model provider is used.

## Local data

DraftMD stores the following under the current macOS user account:

- Markdown documents in folders chosen by the user;
- local conversation, task, and provider metadata in SQLite;
- task snapshots used for Diff, Undo, and interrupted-task recovery;
- model credentials and secret headers in macOS Keychain;
- bounded rolling diagnostic logs containing only approved safe fields;
- interface preferences such as language, theme, and editor font.

Deleting a conversation does not delete Markdown files. Deleting a provider configuration can optionally remove its Keychain secrets. Task snapshots are local and are not part of diagnostics exports.

## Model providers

DraftMD contacts a model provider only after the user configures one and starts a capability test, chat, or task. Depending on the action, the request can include:

- the user's task or chat message;
- the current Markdown document or selected text;
- workspace-relative file names and Markdown content read by approved agent tools;
- tool results needed to continue that task.

The destination is the configured Anthropic, OpenAI, Ollama, LM Studio, or custom compatible endpoint. The provider's own retention and privacy terms apply. DraftMD does not send Keychain credentials to the Renderer, logs, SQLite, or diagnostics bundles; credentials are attached only to requests for their configured provider.

## Diagnostics exports

The Help → Export Diagnostics flow previews the included categories before showing a save dialog. Exports include application/runtime versions, safe settings, redacted provider metadata, safe logs, and database integrity status. They exclude prompts, responses, document content, credentials, secret headers, messages, and task snapshots. A second redaction pass runs before the JSON file is written.
