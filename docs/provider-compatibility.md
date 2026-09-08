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

In the current source tree, changing the provider kind, preset, endpoint, model, reasoning effort, transport settings, or credential references clears the previous capability and test metadata. Run the capability test again before using that configuration. Renaming a configuration or changing the default does not invalidate its result. A probe result is discarded if the configuration was deleted or its saved connection no longer matches the tested connection. Concurrent probes for the same connection retain completion-order semantics.

## Reasoning Effort (Current Source)

Model settings offer a per-configuration **Reasoning effort** selector for known supporting models. **Provider default** omits the effort parameter and preserves existing behavior, including automatic adaptive thinking on previously supported Claude models. Older saved configurations load with this default. Selecting **None**, where available, explicitly disables reasoning; it is different from the provider default.

| Model | Available explicit levels |
| --- | --- |
| GPT-6 Astra | low, medium, high, xhigh, max |
| GPT-5.6 / Sol / Terra / Luna | none, low, medium, high, xhigh, max |
| GPT-5.2, GPT-5.4, GPT-5.5 | none, low, medium, high, xhigh |
| Claude Opus 5 / 4.8 / 4.7, Sonnet 5, Fable 5 / 5.1, Mythos 5 / 5.1 | low, medium, high, xhigh, max |
| Claude Opus 4.6, Sonnet 4.6, Mythos Preview | low, medium, high, max |
| Claude Opus 4.5 | low, medium, high |
| DeepSeek V4 Flash / Pro (OpenAI-compatible) | low, high, max; Responses also offers none |

Dated OpenAI and Claude snapshots inherit the listed levels. Unknown model IDs, custom aliases, and unsupported provider/model combinations keep the control hidden; DraftMD does not infer support from an arbitrary model name. Claude effort is available through the Anthropic protocol. A compatible endpoint may reject levels accepted by the original provider, so the selected setting is exercised by the capability test before use.

Responses sends `reasoning.effort`, Chat Completions sends `reasoning_effort`, and Anthropic sends `output_config.effort`. All task rounds use the saved setting. Explicit-effort probes use the same 64,000-token output ceiling as conversations to avoid consuming a small probe budget entirely on reasoning; the ceiling is a limit, not a target. Default probes retain their previous limit. Higher effort can increase latency and token use. No per-message overrides, numeric thinking budgets, or thinking display are included.

OpenAI-compatible Chat Completions preserves returned `reasoning_content` in provider-private conversation data and replays it with tool results, as required by DeepSeek. It is not rendered as assistant text. Provider errors remain visible after testing and reopening settings; private upstream error text is not displayed.

The support table was checked on 2026-09-06 against [OpenAI model guidance](https://developers.openai.com/api/docs/guides/latest-model), [GPT-5.6 Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol), [Claude effort](https://platform.claude.com/docs/en/build-with-claude/effort), and [DeepSeek thinking mode](https://api-docs.deepseek.com/guides/thinking_mode/). Automated tests verify request shape and local behavior with loopback fixtures; real service acceptance remains model- and endpoint-specific.

Compatibility depends on streaming behavior, tool-call argument fidelity, cancellation, and the selected model—not only on accepting an OpenAI-shaped request. Custom endpoints must be tested individually. Public plain-HTTP endpoints require explicit approval; loopback local HTTP endpoints are allowed for local services.

Release-candidate validation includes Ollama and LM Studio plus one real Anthropic and one real OpenAI model. Real-provider checks are manual because they use external services and may incur charges.
