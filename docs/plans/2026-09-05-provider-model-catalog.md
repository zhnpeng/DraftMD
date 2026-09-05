# Provider Model Selection and Synchronization

Implement the requested provider-aware model picker and explicit model synchronization.

- Replace the hardcoded model default with provider-specific suggestions. Switching provider or local preset resets the old model and endpoint; loading a saved configuration preserves its model. Compatible endpoints remain editable and may return models from any vendor.
- Keep a model input with native selectable suggestions and a synchronization command. Synchronization uses the current draft, including unsaved credentials, without saving a configuration or requiring a model first.
- Add a validated IPC operation implemented in the main process using the installed OpenAI and Anthropic SDKs. Resolve saved secrets only for the same saved provider kind and endpoint. Reject redirects, apply existing endpoint policy, bound request duration and model count, and return only normalized model metadata or safe error codes.
- Discard results when the form connection changes or the dialog closes. Show loading, empty-list, unsupported-endpoint, authentication, and connection errors. Keep custom model input and draft secrets intact on failure.
- Fix settings layout so controls can scroll without being compressed or clipping the bottom actions.
- Verify with real mock HTTP services, IPC contract tests, Electron settings workflows, and packaged acceptance. Reinstall the tested local application under the existing authorization; preserve user data and earlier builds.

Reference: https://developers.openai.com/api/reference/resources/models/methods/list

Static suggestions are fallback candidates, not a claim of current account availability. Explicit synchronization is the source for models currently advertised by the configured service.

The preset list was refreshed on 2026-09-05 against the official catalogs below. OpenAI suggestions use GPT-6 Astra and GPT-5.6 Sol/Terra/Luna; Anthropic uses Claude Fable 5.1, Opus 5, Sonnet 5, and Haiku 4.5; compatible suggestions also include DeepSeek V4 Flash/Pro. The form displays the preset date until a synchronization result replaces it. New OpenAI configurations default to GPT-5.6 Terra and Anthropic configurations to Claude Sonnet 5; saved configurations keep their selected model.

- https://developers.openai.com/api/docs/models
- https://developers.openai.com/api/docs/models/gpt-6-astra
- https://developers.openai.com/api/docs/models/gpt-5.6-terra
- https://platform.claude.com/docs/en/about-claude/models/overview
- https://api-docs.deepseek.com/quick_start/pricing

## Verification

- Typecheck, theme validation, and whitespace checks passed.
- Vitest: 729 passed, 1 skipped. Security suite: 35 Vitest and 2 Electron tests passed.
- Development E2E: 47 tests passed on the full run; the remaining settings assertion was corrected, and all 5 settings tests then passed.
- Universal build and architecture verification passed in `release/local-model-catalog-20260905`.
- Packaged acceptance: all 23 tests passed. The two original settings tests now open settings through the visible model menu, avoiding startup IPC before renderer listeners are registered.
- Installed and launched `/Applications/DraftMD.app` after the user closed the previous application. Installed `app.asar` SHA256 matches the verified bundle: `261ca065674cb6de31919fd414dc530475f2081887a09dc5ca162729da2a33d2`. The previous application is preserved in `release/local-model-catalog-20260905/previous-install/DraftMD.app`; user data and Keychain were retained.

## Empty Response Follow-up

- Reproduced a compatible endpoint returning HTTP 200 HTML: the SDK stream contained no events, the capability probe advertised chat support, and chat completed without a reply.
- Reject empty unknown OpenAI streams with `EMPTY_RESPONSE`. Capability probes require text or tool evidence. Chat treats empty or whitespace-only output as failure and reports refusals separately, while preserving real partial output on interruption.
- Render safe, localized task errors in the message area with a configuration action for endpoint, authentication, and model errors. Do not expose raw response bodies. Retrying clears the previous feedback.
- Refresh built-in model candidates from the official catalogs above and display their verification date.
- Full Vitest after these changes: 734 passed, 1 skipped. Typecheck passed. Loopback tests cover HTML responses, empty replies, refusals, and capability classification; Electron tests cover visible HTML/empty/authentication errors and successful retry.
- Final Universal build and architecture verification passed in `release/local-provider-response-fix-20260905`. All 26 packaged acceptance tests passed, including the complete provider settings flow and the three chat error/retry cases. An intermittent development test timeout passed when rerun with tracing; no production behavior change was made for that timeout.
- Installed and launched the final bundle at `/Applications/DraftMD.app`. Installed `app.asar` SHA256: `1d46195a0d15fb3421be9c30c5260f12b052f7d920aa3e4a90381c32c9f2edbf`. The previous application is preserved in `release/local-provider-response-fix-20260905/previous-install/DraftMD.app`. User data and saved credentials were retained; no authenticated request to the user's provider was made during diagnosis.

## Strict Tool Schema Follow-up

The user confirmed `/v1` was already configured and supplied an upstream `invalid_function_parameters` response for `search_markdown`. The saved configuration had passed the simple echo capability probe, but full tasks failed because OpenAI strict schemas require every property in `required`. The workspace search and read tools had optional properties that violated this rule.

- Encode the existing flat workspace tool arguments as strict OpenAI schemas, making optional properties required and nullable at the provider boundary.
- Convert only declared optional null arguments back to omitted values before local validation. Preserve required and unknown fields so invalid calls remain rejected; retain the original provider transcript for continuation.
- Make the shared loopback provider enforce the upstream `required` constraint and return nullable read arguments in the full Agent flow. Regression tests cover every workspace tool, optional omission, explicit values, invalid null arguments, and unchanged local definitions.

Reference: https://developers.openai.com/api/docs/guides/function-calling#strict-mode

Verification: full Vitest passed with 740 tests and 1 skipped; the OpenAI adapter suite passed all 24 tests after correcting its SDK namespace import. Project typecheck, direct typing of the updated tests, and whitespace checks passed. Universal architecture verification and all 26 packaged acceptance tests passed against `release/local-strict-tools-fix-20260905` with the stricter mock server enabled.

Installed and launched `/Applications/DraftMD.app` with verified `app.asar` SHA256 `5af45377d744bfc115d4ae6266a630a6a0d3027130fb5f8568952e57ccf41fab`. The previous application is preserved in `release/local-strict-tools-fix-20260905/previous-install/DraftMD.app`. Existing endpoint settings, credentials, and user data were retained.
