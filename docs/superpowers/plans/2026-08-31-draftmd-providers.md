# DraftMD Provider Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users safely store and test multiple Anthropic, OpenAI, OpenAI-compatible, Ollama, and LM Studio configurations through one provider-neutral streaming/tool-call contract.

**Architecture:** `ProviderAdapter` exposes normalized events and does not execute tools. Official SDKs remain isolated in lazy-loaded adapters in the main process. `ProviderConfigService` stores non-secret fields in SQLite and credentials in Keychain, performs SSRF-conscious endpoint validation, and classifies configurations as `agent`, `chat-only`, or `unavailable` through deterministic probes.

**Tech Stack:** `@anthropic-ai/sdk` 0.122, `openai` 7.8, Zod 4, SQLite, Keychain, Vitest, local mock HTTP/SSE servers.

**Spec:** `docs/superpowers/specs/2026-08-31-draftmd-product-design.md`

## Global Constraints

- Use official provider SDKs; do not route Anthropic through an OpenAI-compatible shim.
- Provider SDKs are lazy-loaded after the user invokes model features; editor startup does not import them.
- API keys and sensitive header values remain in Keychain and main process.
- Remote endpoint defaults to HTTPS; HTTP is permitted for loopback and private-network hosts, or after explicit per-config warning acceptance.
- Provider capability tests never mutate files and never spend real API money in automated CI.
- Ordinary text is never parsed as a tool call.
- Configuration may degrade to chat-only; it must not pretend to support direct file edits.

---

### Task 1: Define Provider-Neutral Contracts and Error Taxonomy

**Files:**
- Create: `src/shared/contracts/provider.ts`
- Create: `src/main/providers/provider-adapter.ts`
- Create: `src/main/providers/provider-errors.ts`
- Create: `tests/unit/providers/contracts.test.ts`

**Interfaces:**
- Produces:

```ts
type ProviderEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call'; call: ToolCall }
  | { type: 'usage'; inputTokens: number; outputTokens: number; cachedInputTokens?: number }
  | { type: 'completed'; stopReason: NormalizedStopReason; assistantMessage: ProviderMessage }

type ProviderCapability = 'agent' | 'chat-only' | 'unavailable'

interface ProviderAdapter {
  stream(request: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderEvent>
}
```

- Produces error codes: `AUTHENTICATION`, `RATE_LIMIT`, `INSUFFICIENT_QUOTA`, `MODEL_NOT_FOUND`, `CONTEXT_LIMIT`, `TIMEOUT`, `CONNECTION`, `BAD_REQUEST`, `REFUSAL`, `CANCELLED`, `PROVIDER_ERROR`.
- Agent Runtime consumes only normalized contracts.

- [ ] **Step 1: Write strict schema tests**

Test rejection of unknown config fields, invalid provider kind, negative token usage, duplicate tool call IDs, and non-JSON tool arguments. Ensure config serialization cannot contain `apiKey` or raw sensitive headers.

- [ ] **Step 2: Implement schemas and messages**

Define `ProviderConfigSchema` with:

```ts
{
  id, name,
  kind: 'anthropic' | 'openai' | 'openai-compatible',
  preset: 'none' | 'ollama' | 'lm-studio',
  baseUrl, model,
  credentialRef: string | null,
  headerCredentialRefs: Record<string, string>,
  timeoutMs: number,
  streamEnabled: boolean,
  toolsEnabled: boolean,
  insecureHttpApproved: boolean,
  capability, lastTestedAt, lastTestErrorCode
}
```

Do not store header values in this object.

- [ ] **Step 3: Implement typed error normalization helpers**

`ProviderError` contains code, retryable boolean, status, provider, and safe message key. It never carries request bodies or response content in renderer-facing serialization.

- [ ] **Step 4: Verify**

Run unit tests and typecheck.

- [ ] **Step 5: Commit when authorized**

```bash
git add src/shared/contracts/provider.ts src/main/providers tests/unit/providers

git commit -m "feat: define provider-neutral LLM contract"
```

---

### Task 2: Implement Provider Configuration, Credentials, and Endpoint Policy

**Files:**
- Create: `src/main/providers/provider-config-service.ts`
- Create: `src/main/providers/endpoint-policy.ts`
- Modify: `src/main/persistence/provider-config-repository.ts`
- Modify: `src/main/app/ipc.ts`
- Modify: `src/preload/index.ts`
- Create: `tests/unit/providers/endpoint-policy.test.ts`
- Create: `tests/integration/providers/config-service.test.ts`

**Interfaces:**
- Produces `listConfigs()`, `saveConfig(input, secrets)`, `deleteConfig(id, deleteSecrets)`, `setDefault(id)`, `materialize(id)`.
- `materialize()` returns secrets only to an adapter factory in main process.

- [ ] **Step 1: Write endpoint-policy tests**

Cases: HTTPS allowed; `http://localhost`, loopback IPv4/IPv6, `.local`, RFC1918 allowed with local marker; public HTTP requires explicit approval; `file:`, `ftp:`, credentials in URL, fragments, and malformed URLs rejected. Resolve DNS immediately before request and reject a hostname that changes to a forbidden address unless policy permits it.

- [ ] **Step 2: Implement policy without fetching arbitrary URLs during validation**

Validation parses and resolves host only. Connection testing sends only the provider SDK request to the configured base URL; no URL path supplied by model/user is followed.

- [ ] **Step 3: Implement transactional config save**

Save secrets to Keychain first, then SQLite refs in one logical operation. If DB save fails, delete newly created Keychain items. On update, keep old refs until DB commit succeeds, then delete replaced refs. Sensitive header names are normalized and duplicate case-insensitive names rejected.

- [ ] **Step 4: Add IPC endpoints with redacted DTOs**

Renderer can list, save, test, default, and delete configs. `list` returns `hasCredential: boolean`, never ref IDs or secret values. Delete has explicit `deleteSecrets` boolean.

- [ ] **Step 5: Verify config rollback and redaction**

Use in-memory credential store plus temp SQLite. Inject failures at each step and assert no orphaned secret or DB row. Serialize every renderer DTO and assert known secret absent.

- [ ] **Step 6: Commit when authorized**

```bash
git add src/main/providers src/main/persistence src/main/app/ipc.ts src/preload tests

git commit -m "feat: manage secure provider configurations"
```

---

### Task 3: Implement the Anthropic Adapter

**Files:**
- Create: `src/main/providers/anthropic/anthropic-adapter.ts`
- Create: `src/main/providers/anthropic/anthropic-messages.ts`
- Create: `src/main/providers/anthropic/anthropic-errors.ts`
- Create: `tests/unit/providers/anthropic-adapter.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes provider-neutral `ProviderRequest` and official Anthropic types.
- Produces normalized streaming text, tool calls, usage, stop reasons, and errors.

- [ ] **Step 1: Install the official SDK and write stream fixture tests**

Install `@anthropic-ai/sdk@^0.122.0`. Mock only the SDK client boundary, not `fetch`. Test text deltas, complete tool call parsing, multiple tool calls, cancellation, usage, end turn, max tokens, refusal, and typed errors.

- [ ] **Step 2: Implement lazy client creation**

Use dynamic import inside adapter factory:

```ts
const { default: Anthropic } = await import('@anthropic-ai/sdk')
return new Anthropic({ apiKey, baseURL, timeout: timeoutMs, maxRetries: 2 })
```

For current Claude defaults, use `model` from config, streaming, `max_tokens: 64000`, adaptive thinking when the chosen model supports it, and stable tools/system prefix. Do not hard-code Anthropic-only parameters into `ProviderRequest`; adapter capability mapping decides them.

- [ ] **Step 3: Use the official manual streaming loop surface, not Tool Runner**

The adapter performs one model turn only via `client.messages.stream()` and `finalMessage()`. Agent Runtime owns the cross-provider loop, human approval, limits, and persistence. Preserve full assistant content blocks in provider-private serialized messages so Anthropic tool results can be continued correctly.

- [ ] **Step 4: Normalize typed SDK errors**

Check `AuthenticationError`, `NotFoundError`, `RateLimitError`, `BadRequestError`, `APIConnectionTimeoutError`, `APIConnectionError`, then generic `APIError`, in that order. Handle `stop_reason === 'refusal'` explicitly. Never string-match errors.

- [ ] **Step 5: Verify**

Run adapter unit tests, typecheck, and build. Assert the main startup chunk does not eagerly contain the Anthropic SDK by inspecting `dist/main/chunks` after build.

- [ ] **Step 6: Commit when authorized**

```bash
git add package.json package-lock.json src/main/providers/anthropic tests/unit/providers/anthropic-adapter.test.ts

git commit -m "feat: add native Anthropic provider"
```

---

### Task 4: Implement OpenAI and OpenAI-Compatible Adapters

**Files:**
- Create: `src/main/providers/openai/openai-adapter.ts`
- Create: `src/main/providers/openai/openai-messages.ts`
- Create: `src/main/providers/openai/openai-errors.ts`
- Create: `src/main/providers/openai-compatible/openai-compatible-adapter.ts`
- Create: `tests/unit/providers/openai-adapter.test.ts`
- Modify: `package.json`

**Interfaces:**
- Same `ProviderAdapter` contract as Task 3.
- OpenAI-compatible adapter differs only in configured base URL/headers and conservative feature flags; it does not claim parity automatically.

- [ ] **Step 1: Install official SDK and write normalized stream tests**

Install `openai@^7.8.0`. Use recorded/mock SDK stream events for text, tool call argument deltas, parallel tool calls, finish reasons, usage, cancellation, and typed errors.

- [ ] **Step 2: Implement lazy SDK client and custom headers**

Dynamic import `openai`; create the client with API key, base URL, timeout, retries, and materialized headers. For no-key local services, provide the SDK-required non-secret sentinel value only in memory and never persist it.

- [ ] **Step 3: Buffer tool argument deltas and parse once**

Collect tool arguments by tool call ID, call `JSON.parse()` only after the call is complete, validate against the requested tool schema in Agent Runtime, and emit `ProviderError(BAD_REQUEST)` for malformed JSON. Never raw-match serialized JSON.

- [ ] **Step 4: Map finish reasons and typed errors**

Normalize `stop`, `tool_calls`, `length`, `content_filter`, and unknown values. Check official SDK classes/status fields; never expose raw response bodies.

- [ ] **Step 5: Verify native and compatible modes**

Run the same contract suite against OpenAI native and a local mock compatible server with a custom base URL and no API key.

- [ ] **Step 6: Commit when authorized**

```bash
git add package.json package-lock.json src/main/providers/openai src/main/providers/openai-compatible tests/unit/providers/openai-adapter.test.ts

git commit -m "feat: add OpenAI-compatible providers"
```

---

### Task 5: Add Deterministic Capability Probes

**Files:**
- Create: `src/main/providers/capability-test.ts`
- Create: `src/main/providers/provider-factory.ts`
- Create: `tests/helpers/mock-provider-server.ts`
- Create: `tests/integration/providers/capability-test.test.ts`

**Interfaces:**
- Produces `testProvider(configId, signal): Promise<CapabilityTestResult>` with connection, authentication, stream, tool-use, latency, model, and final capability.
- Provider settings UI in Phase 5 consumes this result.

- [ ] **Step 1: Build a local mock provider server**

Support Anthropic-style and OpenAI-style endpoints, streaming success, auth error, rate limit, timeout, malformed tool call, and a deterministic `draftmd_capability_echo` tool request. It binds loopback only and records request shapes with secrets redacted.

- [ ] **Step 2: Write classification tests**

- streaming + valid tool call → `agent`;
- streaming text only → `chat-only`;
- malformed tool call → `chat-only` plus warning;
- auth/connection/model error → `unavailable`;
- cancellation → previous capability unchanged and result cancelled.

- [ ] **Step 3: Implement a no-file-mutation probe**

The probe offers only:

```ts
{
  name: 'draftmd_capability_echo',
  description: 'Return the supplied nonce unchanged to verify structured tool calling.',
  inputSchema: { type: 'object', properties: { nonce: { type: 'string' } }, required: ['nonce'], additionalProperties: false }
}
```

It asks the model to call that tool once. No workspace/file tools exist in this request.

- [ ] **Step 4: Persist capability and safe error code**

Store tested time, capability, model, latency, and safe error code. Do not store probe prompt/output.

- [ ] **Step 5: Verify**

Run integration tests and build. No real network or provider key is required.

- [ ] **Step 6: Commit when authorized**

```bash
git add src/main/providers tests/helpers/mock-provider-server.ts tests/integration/providers

git commit -m "feat: detect provider Agent capability"
```

---

### Task 6: Build Bilingual Provider Settings UI

**Files:**
- Create: `src/renderer/settings/provider-settings.ts`
- Create: `src/renderer/settings/provider-form.ts`
- Create: `src/renderer/settings/provider-settings.css`
- Modify: `src/renderer/index.html`
- Modify: `src/renderer/app/bootstrap.ts`
- Modify: `src/shared/i18n/messages.ts`
- Create: `tests/e2e/provider-settings.spec.ts`

**Interfaces:**
- Consumes redacted provider IPC DTOs.
- Produces accessible configuration list/form with presets, default selection, test status, `agent/chat-only/unavailable` badges, and secret replacement controls.

- [ ] **Step 1: Write E2E settings flow against mock provider**

Open settings, create an OpenAI-compatible config using mock URL, leave key blank, choose model, test, observe Agent badge, set default, close/reopen settings, and verify persistence. Switch locale and verify labels.

- [ ] **Step 2: Implement settings surface**

Use a modal/sheet opened from native DraftMD menu and task dock model control. Fields change by provider kind. Ollama preset defaults to `http://127.0.0.1:11434/v1`; LM Studio defaults to `http://127.0.0.1:1234/v1`; both remain editable.

- [ ] **Step 3: Make secrets write-only**

Existing secret fields display “Saved in Keychain,” never masked real length. Leaving blank retains existing secret; “Replace” opens an empty input; “Remove” is explicit.

- [ ] **Step 4: Implement privacy and HTTP warnings**

First remote use/test shows localized content-sending disclosure. Public HTTP requires a separate checkbox with exact endpoint host. Local endpoints show “Local connection” but no guarantee about service data handling.

- [ ] **Step 5: Verify**

Run provider unit/integration tests, E2E settings test, typecheck, build, and `git diff --check`.

- [ ] **Step 6: Commit when authorized**

```bash
git add src/renderer/settings src/renderer/index.html src/renderer/app src/shared/i18n tests/e2e/provider-settings.spec.ts

git commit -m "feat: add secure model configuration UI"
```
