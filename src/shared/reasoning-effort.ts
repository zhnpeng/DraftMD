import { z } from 'zod'
import type { ProviderApiMode, ProviderKind } from './contracts/provider'

export const ReasoningEffortSchema = z.enum(['default', 'none', 'low', 'medium', 'high', 'xhigh', 'max'])
export type ReasoningEffort = z.infer<typeof ReasoningEffortSchema>
type ExplicitEffort = Exclude<ReasoningEffort, 'default'>

interface ReasoningModel {
  kind: ProviderKind
  model: string
  apiMode?: ProviderApiMode
}

// Keep the allowlist aligned with the model support table in provider-compatibility.md.
export function reasoningEffortOptions(config: ReasoningModel): readonly ExplicitEffort[] {
  const model = config.model.trim().replace(/-(?:\d{4}-\d{2}-\d{2}|\d{8})$/, '')
  if (config.kind === 'anthropic') {
    if (/^claude-(?:opus-(?:5|4-[78])|sonnet-5|(?:fable|mythos)-5(?:-1)?)$/.test(model)) {
      return ['low', 'medium', 'high', 'xhigh', 'max']
    }
    if (/^claude-(?:opus-4-6|sonnet-4-6|mythos-preview)$/.test(model)) return ['low', 'medium', 'high', 'max']
    if (model === 'claude-opus-4-5') return ['low', 'medium', 'high']
    return []
  }
  if (model === 'gpt-6-astra') return ['low', 'medium', 'high', 'xhigh', 'max']
  if (/^gpt-5\.6(?:-(?:sol|terra|luna))?$/.test(model)) return ['none', 'low', 'medium', 'high', 'xhigh', 'max']
  if (/^gpt-5\.[245]$/.test(model)) return ['none', 'low', 'medium', 'high', 'xhigh']
  if (config.kind === 'openai-compatible' && /^deepseek-v4-(?:flash|pro)$/.test(model)) {
    return config.apiMode === 'responses' ? ['none', 'low', 'high', 'max'] : ['low', 'high', 'max']
  }
  return []
}

export function supportsReasoningEffort(config: ReasoningModel, effort: ReasoningEffort): boolean {
  return effort === 'default' || reasoningEffortOptions(config).includes(effort)
}

export function explicitReasoningEffort(effort?: ReasoningEffort): ExplicitEffort | undefined {
  return effort && effort !== 'default' ? effort : undefined
}
