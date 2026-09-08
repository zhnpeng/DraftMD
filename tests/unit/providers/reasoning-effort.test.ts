import { expect, it } from 'vitest'
import { ProviderConfigInputSchema } from '../../../src/shared/contracts/provider'
import { reasoningEffortOptions, supportsReasoningEffort } from '../../../src/shared/reasoning-effort'

it('matches effort levels to the protocol and known model, including dated snapshots', () => {
  expect(reasoningEffortOptions({ kind: 'openai', model: 'gpt-6-astra' })).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
  expect(reasoningEffortOptions({ kind: 'openai-compatible', model: 'gpt-5.6-sol-2026-08-01' })).toEqual(['none', 'low', 'medium', 'high', 'xhigh', 'max'])
  expect(reasoningEffortOptions({ kind: 'openai', model: 'gpt-5.5' })).not.toContain('max')
  expect(reasoningEffortOptions({ kind: 'anthropic', model: 'claude-opus-4-6' })).toEqual(['low', 'medium', 'high', 'max'])
  expect(reasoningEffortOptions({ kind: 'anthropic', model: 'claude-sonnet-5' })).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
  expect(reasoningEffortOptions({ kind: 'anthropic', model: 'claude-opus-4-5-20251101' })).toEqual(['low', 'medium', 'high'])
  expect(reasoningEffortOptions({ kind: 'openai-compatible', model: 'deepseek-v4-pro', apiMode: 'chat-completions' })).toEqual(['low', 'high', 'max'])
  expect(reasoningEffortOptions({ kind: 'openai-compatible', model: 'deepseek-v4-pro', apiMode: 'responses' })).toEqual(['none', 'low', 'high', 'max'])
})

it.each([
  { kind: 'anthropic', model: 'claude-haiku-4-5-20251001' },
  { kind: 'openai-compatible', model: 'custom-model' },
  { kind: 'openai-compatible', model: 'claude-sonnet-5' },
  { kind: 'anthropic', model: 'gpt-6-astra' },
  { kind: 'openai', model: 'gpt-6-astra-custom' },
] as const)('does not guess effort support for %j', config => {
  expect(reasoningEffortOptions(config)).toEqual([])
  expect(supportsReasoningEffort(config, 'default')).toBe(true)
  expect(supportsReasoningEffort(config, 'high')).toBe(false)
})

it('validates effort on the IPC input contract', () => {
  const schema = ProviderConfigInputSchema.pick({ reasoningEffort: true })
  expect(schema.parse({})).toEqual({})
  expect(schema.parse({ reasoningEffort: 'default' })).toEqual({ reasoningEffort: 'default' })
  expect(schema.safeParse({ reasoningEffort: 'adaptive' }).success).toBe(false)
  expect(schema.safeParse({ reasoningEffort: 123 }).success).toBe(false)
})
