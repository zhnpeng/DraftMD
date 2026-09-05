# Provider Compatibility

DraftMD supports model services through the official Anthropic and OpenAI SDKs plus an OpenAI-compatible adapter.

OpenAI and custom endpoints expose an **API mode** selector: **Responses API** or **Chat Completions**. New remote configurations default to Responses; Ollama and LM Studio presets default to Chat Completions. Existing configurations retain their previous protocol until explicitly changed. Both modes stream text and support the document Agent's file tools when the service and model support function calling.

Responses uses the official SDK stream accumulator and strict tool argument parser. DraftMD sends `store: false` and carries output items, encrypted reasoning, and function results locally between tool rounds. File edits still pass through DraftMD's workspace validation, approval rules, version checks, and undo snapshots. A failed Responses request never silently falls back to another protocol. A missing Responses endpoint is reported in the settings and task UI.

| Provider | Configuration | Expected capability |
| --- | --- | --- |
| Anthropic | API key, endpoint, Claude model | Agent when tool use is supported |
| OpenAI | API key, OpenAI model | Agent when tool use is supported |
| Ollama | Local OpenAI-compatible endpoint | Depends on the selected model and service implementation |
| LM Studio | Local OpenAI-compatible endpoint | Depends on the selected model and service implementation |
| Custom endpoint | OpenAI-compatible URL and optional secret headers | Depends on the service implementation |

DraftMD runs a capability test before labeling a configuration. A provider may be marked **Agent**, **Chat only**, or **Unavailable**. Chat-only providers receive no file tools and cannot modify Markdown. Text that resembles a tool call remains ordinary assistant text.

In the current source tree, changing the provider kind, preset, endpoint, model, transport settings, or credential references clears the previous capability and test metadata. Run the capability test again before using that configuration. Renaming a configuration or changing the default does not invalidate its result. A probe result is discarded if the configuration was deleted or its saved connection no longer matches the tested connection. Concurrent probes for the same connection retain completion-order semantics.

Compatibility depends on streaming behavior, tool-call argument fidelity, cancellation, and the selected model—not only on accepting an OpenAI-shaped request. Custom endpoints must be tested individually. Public plain-HTTP endpoints require explicit approval; loopback local HTTP endpoints are allowed for local services.

Release-candidate validation includes Ollama and LM Studio plus one real Anthropic and one real OpenAI model. Real-provider checks are manual because they use external services and may incur charges.
