# Provider Compatibility

DraftMD supports model services through the official Anthropic and OpenAI SDKs plus an OpenAI-compatible adapter.

| Provider | Configuration | Expected capability |
| --- | --- | --- |
| Anthropic | API key, endpoint, Claude model | Agent when tool use is supported |
| OpenAI | API key, OpenAI model | Agent when tool use is supported |
| Ollama | Local OpenAI-compatible endpoint | Depends on the selected model and service implementation |
| LM Studio | Local OpenAI-compatible endpoint | Depends on the selected model and service implementation |
| Custom endpoint | OpenAI-compatible URL and optional secret headers | Depends on the service implementation |

DraftMD runs a capability test before labeling a configuration. A provider may be marked **Agent**, **Chat only**, or **Unavailable**. Chat-only providers receive no file tools and cannot modify Markdown. Text that resembles a tool call remains ordinary assistant text.

Compatibility depends on streaming behavior, tool-call argument fidelity, cancellation, and the selected model—not only on accepting an OpenAI-shaped request. Custom endpoints must be tested individually. Public plain-HTTP endpoints require explicit approval; loopback local HTTP endpoints are allowed for local services.

Release-candidate validation includes Ollama and LM Studio plus one real Anthropic and one real OpenAI model. Real-provider checks are manual because they use external services and may incur charges.
